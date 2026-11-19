import { supabase } from '@/lib/supabase';
import {
  parsePgrst204MissingColumn,
  type SupabaseLikeError,
} from '@/services/crmPersistenceService';
import type { Conversation, ConversationStatus, StaffRole } from '@/types/crm';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CONVERSATION_CORE_PROTECTED_COLS = new Set(['business_id', 'contact_id']);
const ALLOWED_CONVERSATION_STATUSES = new Set<ConversationStatus>(['open', 'pending', 'resolved']);

let knownConversationColumns: Set<string> | null = null;
const missingConversationColumns = new Set<string>();
let conversationOpenApiAttempted = false;

// Coalesce concurrent open-or-create requests for the same (businessId, contactId)
const inFlightOpenOrCreate = new Map<string, Promise<OpenOrCreateConversationResult>>();

export function resetConversationSchemaCache(): void {
  knownConversationColumns = null;
  missingConversationColumns.clear();
  conversationOpenApiAttempted = false;
  inFlightOpenOrCreate.clear();
}

export function seedConversationColumnsFromRows(
  rows: Array<Record<string, unknown>> | null | undefined
): void {
  if (!rows || rows.length === 0) return;
  const cols = knownConversationColumns ?? new Set<string>();
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    for (const key of Object.keys(row)) {
      cols.add(key);
      missingConversationColumns.delete(key);
    }
  }
  if (cols.size > 0) {
    knownConversationColumns = cols;
  }
}

export function getKnownConversationColumns(): Set<string> | null {
  return knownConversationColumns && knownConversationColumns.size > 0
    ? new Set(knownConversationColumns)
    : null;
}

function recordMissingConversationColumn(column: string): void {
  missingConversationColumns.add(column);
  if (knownConversationColumns) {
    knownConversationColumns.delete(column);
  }
}

function canWriteConversationColumn(
  column: string,
  knownCols: Set<string> | null,
  missingCols: Set<string>,
  requireExplicitPresence = false
): boolean {
  if (missingCols.has(column)) return false;
  if (knownCols && knownCols.size > 0) {
    return knownCols.has(column);
  }
  return !requireExplicitPresence;
}

/**
 * Inspects PostgREST OpenAPI definitions once for public.conversations using only
 * the publishable key + user JWT (never a service-role key).
 */
export async function discoverConversationColumns(): Promise<Set<string> | null> {
  if (knownConversationColumns && knownConversationColumns.size > 0) {
    return knownConversationColumns;
  }

  if (!supabase || conversationOpenApiAttempted) {
    return knownConversationColumns;
  }

  const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
  const publishableKey = (
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined
  )?.trim();

  if (!supabaseUrl || !publishableKey) {
    return null;
  }

  conversationOpenApiAttempted = true;

  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    const headers: Record<string, string> = {
      apikey: publishableKey,
      Accept: 'application/openapi+json',
    };
    if (accessToken) {
      headers.Authorization = `Bearer ${accessToken}`;
    }

    const res = await fetch(`${supabaseUrl.replace(/\/$/, '')}/rest/v1/`, {
      method: 'GET',
      headers,
    });

    if (!res.ok) {
      return knownConversationColumns;
    }

    const spec = (await res.json()) as {
      definitions?: Record<string, { properties?: Record<string, unknown> }>;
    };

    const props = spec.definitions?.conversations?.properties;
    if (props && typeof props === 'object') {
      const colSet = new Set<string>(Object.keys(props));
      if (colSet.size > 0) {
        knownConversationColumns = colSet;
        for (const c of colSet) missingConversationColumns.delete(c);
      }
    }
  } catch {
    // Fall back to verified core schema + PGRST204 handling
  }

  return knownConversationColumns;
}

export function normalizeConversationStatus(raw: unknown): ConversationStatus {
  const val = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (val === 'pending') return 'pending';
  if (val === 'resolved') return 'resolved';
  return 'open';
}

export function mapDbConversationRow(row: Record<string, unknown>): Conversation {
  return {
    id: String(row.id),
    contactId: String(row.contact_id),
    assignedToId: row.assigned_to ? String(row.assigned_to) : null,
    status: normalizeConversationStatus(row.status),
    unreadCount: Math.max(0, Number(row.unread_count ?? 0)),
    humanHandoffRequested: Boolean(row.human_handoff_requested),
    lastCustomerMessageAt: String(
      row.last_customer_message_at ?? row.created_at ?? new Date(0).toISOString()
    ),
    windowExpiresAt: String(row.window_expires_at ?? new Date(0).toISOString()),
    lastMessagePreview: String(row.last_message_preview ?? ''),
    lastMessageAt: String(row.last_message_at ?? row.created_at ?? new Date().toISOString()),
  };
}

/**
 * Mirrors Supabase RLS helper `zoqniva_can_access_conversation`:
 * - Active business admins can access all conversations in their business.
 * - Active business agents can only access unassigned conversations or conversations assigned to themselves.
 */
export function canUserAccessConversation(
  conv: { assignedToId: string | null },
  user: { id: string; role: StaffRole }
): boolean {
  if (user.role === 'admin') return true;
  return conv.assignedToId === null || conv.assignedToId === user.id;
}

export function formatConversationPersistenceError(
  action: 'create' | 'load' | 'update' | 'verify',
  error: SupabaseLikeError | null | undefined
): string {
  if (!error) {
    return `Could not ${action} conversation in Supabase.`;
  }

  const code = String(error.code ?? '');
  const rawMsg = String(error.message ?? '').trim();
  const details = String(error.details ?? '').trim();

  if (code === '42501' || /row-level security|permission denied/i.test(rawMsg)) {
    if (action === 'create') {
      return 'Permission denied by database Row-Level Security (RLS) when creating this conversation. Ensure your account is an active workspace member and the contact belongs to this workspace.';
    }
    if (action === 'update') {
      return 'Permission denied by database Row-Level Security (RLS). You can only modify conversations you are authorized to access.';
    }
    return 'Permission denied by database Row-Level Security (RLS) on public.conversations.';
  }

  if (code === '23505') {
    return 'A conversation with this contact already exists in this workspace.';
  }

  if (code === '23503') {
    if (/contact/i.test(`${rawMsg} ${details}`)) {
      return 'The selected contact could not be found in Supabase. Refresh Contacts and try again.';
    }
    if (/assigned_to|profiles/i.test(`${rawMsg} ${details}`)) {
      return 'The selected team member does not have a valid profile record in Supabase.';
    }
    if (/whatsapp_account/i.test(`${rawMsg} ${details}`)) {
      return 'The workspace WhatsApp account record could not be referenced in Supabase.';
    }
    return `Related workspace record could not be found in Supabase (${rawMsg}).`;
  }

  if (code === '23514') {
    return `Conversation data failed a database validation constraint: ${rawMsg}`;
  }

  if (code === '23502') {
    return `A required database column was missing while saving the conversation: ${rawMsg}`;
  }

  if (code === 'PGRST204') {
    return `Database schema mismatch on public.conversations: ${rawMsg}`;
  }

  return rawMsg || `Could not ${action} conversation in Supabase.`;
}

export interface VerifiedWorkspaceMember {
  userId: string;
  businessId: string;
  role: StaffRole;
}

/**
 * Verifies the caller has a live Supabase Auth session and an active membership
 * (`is_active === true`, role `admin` or `agent`) in `public.business_members`.
 */
export async function verifyActiveWorkspaceMembership(
  businessId: string
): Promise<{ ok: true; member: VerifiedWorkspaceMember } | { ok: false; code: string; error: string }> {
  if (!supabase) {
    return {
      ok: false,
      code: 'SUPABASE_NOT_CONFIGURED',
      error: 'Supabase client is not configured.',
    };
  }

  if (!UUID_REGEX.test(businessId)) {
    return {
      ok: false,
      code: 'INVALID_BUSINESS_ID',
      error: 'Active business workspace could not be verified. Refresh and sign in again.',
    };
  }

  const { data: userRes, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userRes.user) {
    return {
      ok: false,
      code: 'UNAUTHENTICATED',
      error: 'Your session has expired. Sign in again and retry.',
    };
  }

  const { data: memberRow, error: memberErr } = await supabase
    .from('business_members')
    .select('business_id, user_id, role, is_active')
    .eq('business_id', businessId)
    .eq('user_id', userRes.user.id)
    .eq('is_active', true)
    .maybeSingle();

  if (memberErr) {
    return {
      ok: false,
      code: 'MEMBERSHIP_CHECK_FAILED',
      error: `Unable to verify workspace membership: ${memberErr.message}`,
    };
  }

  const row = (memberRow as Record<string, unknown> | null) ?? null;
  const roleVal = String(row?.role ?? '');
  if (!row || row.is_active !== true || (roleVal !== 'admin' && roleVal !== 'agent')) {
    return {
      ok: false,
      code: 'FORBIDDEN',
      error: 'You do not have an active workspace membership for this business.',
    };
  }

  return {
    ok: true,
    member: {
      userId: userRes.user.id,
      businessId,
      role: roleVal as StaffRole,
    },
  };
}

/**
 * Builds a schema-verified INSERT payload for `public.conversations`.
 * - NEVER includes a client-generated `id` (PostgreSQL generates the authoritative UUID).
 * - NEVER writes protected 24h window columns (`last_customer_message_at`, `window_expires_at`).
 */
export function buildConversationInsertPayload(
  input: {
    businessId: string;
    contactId: string;
    whatsappAccountId?: string | null;
    assignedToId?: string | null;
    status?: ConversationStatus;
    lastMessagePreview?: string;
    lastMessageAt?: string;
  },
  knownCols: Set<string> | null,
  missingCols: Set<string> = new Set()
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    business_id: input.businessId,
    contact_id: input.contactId,
  };

  if (
    input.whatsappAccountId &&
    UUID_REGEX.test(input.whatsappAccountId) &&
    canWriteConversationColumn('whatsapp_account_id', knownCols, missingCols)
  ) {
    payload.whatsapp_account_id = input.whatsappAccountId;
  }

  if (canWriteConversationColumn('assigned_to', knownCols, missingCols)) {
    payload.assigned_to =
      input.assignedToId && UUID_REGEX.test(input.assignedToId) ? input.assignedToId : null;
  }

  if (canWriteConversationColumn('status', knownCols, missingCols)) {
    payload.status = input.status ?? 'open';
  }

  if (canWriteConversationColumn('unread_count', knownCols, missingCols)) {
    payload.unread_count = 0;
  }

  if (canWriteConversationColumn('human_handoff_requested', knownCols, missingCols)) {
    payload.human_handoff_requested = false;
  }

  if (
    input.lastMessagePreview !== undefined &&
    canWriteConversationColumn('last_message_preview', knownCols, missingCols)
  ) {
    payload.last_message_preview = input.lastMessagePreview;
  }

  if (
    input.lastMessageAt &&
    canWriteConversationColumn('last_message_at', knownCols, missingCols)
  ) {
    payload.last_message_at = input.lastMessageAt;
  }

  return payload;
}

export async function fetchAuthorizedConversationsFromDb(params: {
  businessId: string;
  userId: string;
  role: StaffRole;
}): Promise<{ ok: boolean; conversations: Conversation[]; error?: string }> {
  if (!supabase) {
    return { ok: false, conversations: [], error: 'Supabase client is not configured.' };
  }
  if (!UUID_REGEX.test(params.businessId)) {
    return { ok: false, conversations: [], error: 'Invalid workspace identifier.' };
  }

  const { data, error } = await supabase
    .from('conversations')
    .select('*')
    .eq('business_id', params.businessId)
    .order('last_message_at', { ascending: false });

  if (error) {
    return {
      ok: false,
      conversations: [],
      error: formatConversationPersistenceError('load', error),
    };
  }

  const rawRows = (data ?? []) as Array<Record<string, unknown>>;
  seedConversationColumnsFromRows(rawRows);

  const authorized = rawRows
    .map((row) => mapDbConversationRow(row))
    .filter((conv) =>
      canUserAccessConversation(conv, { id: params.userId, role: params.role })
    );

  return { ok: true, conversations: authorized };
}

export async function verifyConversationInDb(params: {
  businessId: string;
  conversationId: string;
  userId?: string;
  role?: StaffRole;
}): Promise<{
  ok: boolean;
  exists: boolean;
  conversation?: Conversation;
  code?: string;
  error?: string;
}> {
  if (!supabase) {
    return {
      ok: false,
      exists: false,
      code: 'SUPABASE_NOT_CONFIGURED',
      error: 'Supabase client is not configured.',
    };
  }

  if (!UUID_REGEX.test(params.businessId)) {
    return {
      ok: false,
      exists: false,
      code: 'INVALID_BUSINESS_ID',
      error: 'Active business workspace could not be verified.',
    };
  }

  if (!UUID_REGEX.test(params.conversationId)) {
    return {
      ok: false,
      exists: false,
      code: 'INVALID_CONVERSATION_ID',
      error:
        'Selected conversation ID is invalid. Start or reopen the conversation from Team Inbox before sending.',
    };
  }

  const { data, error } = await supabase
    .from('conversations')
    .select('*')
    .eq('id', params.conversationId)
    .eq('business_id', params.businessId)
    .maybeSingle();

  if (error) {
    return {
      ok: false,
      exists: false,
      code: 'CONVERSATION_VERIFICATION_FAILED',
      error: formatConversationPersistenceError('verify', error),
    };
  }

  if (!data) {
    return {
      ok: false,
      exists: false,
      code: 'CONVERSATION_NOT_FOUND',
      error:
        'This conversation does not exist in Supabase or is no longer accessible. Reopen or start a new conversation with this contact before sending a WhatsApp message.',
    };
  }

  const row = data as Record<string, unknown>;
  seedConversationColumnsFromRows([row]);
  const mapped = mapDbConversationRow(row);

  if (
    params.userId &&
    params.role &&
    !canUserAccessConversation(mapped, { id: params.userId, role: params.role })
  ) {
    return {
      ok: false,
      exists: true,
      code: 'CONVERSATION_ASSIGNED_TO_OTHER',
      error: 'This conversation is assigned to another team member.',
    };
  }

  return {
    ok: true,
    exists: true,
    conversation: mapped,
  };
}

export interface OpenOrCreateConversationResult {
  ok: boolean;
  conversation?: Conversation;
  created?: boolean;
  code?: string;
  error?: string;
}

function pickReusableConversation(
  rows: Array<Record<string, unknown>>,
  member: VerifiedWorkspaceMember
): Conversation | null {
  const accessible = rows
    .map((r) => mapDbConversationRow(r))
    .filter((conv) => canUserAccessConversation(conv, { id: member.userId, role: member.role }));

  if (accessible.length === 0) return null;

  const active = accessible.find((c) => c.status === 'open' || c.status === 'pending');
  return active ?? accessible[0];
}

async function executeOpenOrCreateConversationInDb(params: {
  businessId: string;
  contactId: string;
  whatsappAccountId?: string | null;
  assignToUserId?: string | null;
}): Promise<OpenOrCreateConversationResult> {
  if (!supabase) {
    return {
      ok: false,
      code: 'SUPABASE_NOT_CONFIGURED',
      error: 'Supabase configuration is required to open or create conversations.',
    };
  }

  if (!UUID_REGEX.test(params.businessId)) {
    return {
      ok: false,
      code: 'INVALID_BUSINESS_ID',
      error: 'Active business workspace could not be verified. Refresh and sign in again.',
    };
  }

  if (!UUID_REGEX.test(params.contactId)) {
    return {
      ok: false,
      code: 'INVALID_CONTACT_ID',
      error: 'Selected contact is not a valid persisted record in Supabase.',
    };
  }

  // 1. Validate authenticated user and active workspace membership (`is_active === true`)
  const memberCheck = await verifyActiveWorkspaceMembership(params.businessId);
  if (!memberCheck.ok) {
    return { ok: false, code: memberCheck.code, error: memberCheck.error };
  }
  const member = memberCheck.member;

  // 2. Ensure the target contact genuinely exists and belongs to the active business
  const { data: contactRow, error: contactErr } = await supabase
    .from('contacts')
    .select('id, business_id')
    .eq('id', params.contactId)
    .eq('business_id', params.businessId)
    .maybeSingle();

  if (contactErr) {
    return {
      ok: false,
      code: 'CONTACT_LOOKUP_FAILED',
      error: `Could not verify contact ownership in Supabase: ${contactErr.message}`,
    };
  }

  if (!contactRow) {
    return {
      ok: false,
      code: 'CONTACT_NOT_FOUND',
      error:
        'This contact does not exist in your active workspace. Refresh Contacts or select another contact.',
    };
  }

  // 3. Check whether an accessible conversation already exists in Supabase for (business_id, contact_id)
  const { data: existingRows, error: existingErr } = await supabase
    .from('conversations')
    .select('*')
    .eq('business_id', params.businessId)
    .eq('contact_id', params.contactId)
    .order('last_message_at', { ascending: false })
    .limit(10);

  if (existingErr) {
    return {
      ok: false,
      code: 'CONVERSATION_LOOKUP_FAILED',
      error: formatConversationPersistenceError('load', existingErr),
    };
  }

  const rawExisting = (existingRows ?? []) as Array<Record<string, unknown>>;
  if (rawExisting.length > 0) {
    seedConversationColumnsFromRows(rawExisting);
    const reusable = pickReusableConversation(rawExisting, member);
    if (reusable) {
      return { ok: true, conversation: reusable, created: false };
    }
    return {
      ok: false,
      code: 'CONVERSATION_ASSIGNED_TO_OTHER',
      error:
        'An existing conversation for this contact is assigned to another team member. Ask a workspace administrator to reassign it.',
    };
  }

  // 4. Insert a real conversation row using only verified database columns (no client-invented UUID)
  const knownCols = await discoverConversationColumns();
  const initialAssignee =
    member.role === 'agent'
      ? member.userId
      : params.assignToUserId !== undefined
      ? params.assignToUserId
      : member.userId;

  const nowIso = new Date().toISOString();
  const payload = buildConversationInsertPayload(
    {
      businessId: params.businessId,
      contactId: params.contactId,
      whatsappAccountId: params.whatsappAccountId ?? null,
      assignedToId: initialAssignee,
      status: 'open',
      lastMessagePreview: 'Conversation started — send an approved template to initiate.',
      lastMessageAt: nowIso,
    },
    knownCols,
    new Set(missingConversationColumns)
  );

  let insertedRow: Record<string, unknown> | null = null;
  let lastError: SupabaseLikeError | null = null;

  for (let attempt = 0; attempt < 8; attempt++) {
    const { data, error } = await supabase
      .from('conversations')
      .insert(payload)
      .select('*')
      .single();

    if (!error && data) {
      insertedRow = data as Record<string, unknown>;
      seedConversationColumnsFromRows([insertedRow]);
      lastError = null;
      break;
    }

    lastError = error;

    // Concurrency fallback: another tab/user inserted a conversation for this contact simultaneously
    if (error?.code === '23505') {
      const { data: raceRows, error: raceErr } = await supabase
        .from('conversations')
        .select('*')
        .eq('business_id', params.businessId)
        .eq('contact_id', params.contactId)
        .order('last_message_at', { ascending: false })
        .limit(5);

      if (!raceErr && Array.isArray(raceRows) && raceRows.length > 0) {
        const raceReusable = pickReusableConversation(
          raceRows as Array<Record<string, unknown>>,
          member
        );
        if (raceReusable) {
          return { ok: true, conversation: raceReusable, created: false };
        }
      }

      return {
        ok: false,
        code: 'CONVERSATION_RESTRICTED',
        error:
          'A conversation with this contact already exists in this workspace and is restricted to another team member.',
      };
    }

    const missingCol = parsePgrst204MissingColumn(error);
    if (
      missingCol &&
      missingCol in payload &&
      !CONVERSATION_CORE_PROTECTED_COLS.has(missingCol)
    ) {
      recordMissingConversationColumn(missingCol);
      delete payload[missingCol];
      continue;
    }

    break;
  }

  if (lastError || !insertedRow || !insertedRow.id) {
    return {
      ok: false,
      code: lastError?.code || 'CONVERSATION_CREATE_FAILED',
      error: formatConversationPersistenceError('create', lastError),
    };
  }

  const persistedId = String(insertedRow.id);
  if (!UUID_REGEX.test(persistedId)) {
    return {
      ok: false,
      code: 'INVALID_CONVERSATION_ID',
      error: 'Supabase returned an invalid conversation UUID.',
    };
  }

  // 5. Explicit read-back verification to confirm persistence & RLS SELECT visibility
  const { data: verifiedRow, error: verifyErr } = await supabase
    .from('conversations')
    .select('*')
    .eq('id', persistedId)
    .eq('business_id', params.businessId)
    .single();

  if (verifyErr || !verifiedRow) {
    return {
      ok: false,
      code: 'CONVERSATION_READBACK_FAILED',
      error: verifyErr
        ? `Conversation was created but could not be verified in Supabase: ${formatConversationPersistenceError('verify', verifyErr)}`
        : 'Conversation could not be read back from Supabase after creation.',
    };
  }

  return {
    ok: true,
    conversation: mapDbConversationRow(verifiedRow as Record<string, unknown>),
    created: true,
  };
}

export function openOrCreateConversationInDb(params: {
  businessId: string;
  contactId: string;
  whatsappAccountId?: string | null;
  assignToUserId?: string | null;
}): Promise<OpenOrCreateConversationResult> {
  const dedupeKey = `${params.businessId}:${params.contactId}`;
  const existing = inFlightOpenOrCreate.get(dedupeKey);
  if (existing) {
    return existing;
  }

  const task = executeOpenOrCreateConversationInDb(params).finally(() => {
    if (inFlightOpenOrCreate.get(dedupeKey) === task) {
      inFlightOpenOrCreate.delete(dedupeKey);
    }
  });

  inFlightOpenOrCreate.set(dedupeKey, task);
  return task;
}

export interface UpdateConversationResult {
  ok: boolean;
  conversation?: Conversation;
  notFound?: boolean;
  code?: string;
  error?: string;
}

export async function updateConversationInDb(params: {
  businessId: string;
  conversationId: string;
  action: 'assign' | 'status' | 'mark_read' | 'handoff';
  assignedToId?: string | null;
  status?: ConversationStatus;
  humanHandoffRequested?: boolean;
}): Promise<UpdateConversationResult> {
  if (!supabase) {
    return {
      ok: false,
      code: 'SUPABASE_NOT_CONFIGURED',
      error: 'Supabase client is not configured.',
    };
  }

  if (!UUID_REGEX.test(params.businessId) || !UUID_REGEX.test(params.conversationId)) {
    return {
      ok: false,
      code: 'INVALID_IDENTIFIER',
      error: 'Active workspace or conversation identifier is invalid.',
    };
  }

  // 1. Verify authenticated session & active business membership
  const memberCheck = await verifyActiveWorkspaceMembership(params.businessId);
  if (!memberCheck.ok) {
    return { ok: false, code: memberCheck.code, error: memberCheck.error };
  }
  const member = memberCheck.member;

  // 2. Verify conversation exists in this business and caller is authorized to access it
  const { data: currentRow, error: currentErr } = await supabase
    .from('conversations')
    .select('*')
    .eq('id', params.conversationId)
    .eq('business_id', params.businessId)
    .maybeSingle();

  if (currentErr) {
    return {
      ok: false,
      code: 'CONVERSATION_LOOKUP_FAILED',
      error: formatConversationPersistenceError('verify', currentErr),
    };
  }

  if (!currentRow) {
    return {
      ok: false,
      notFound: true,
      code: 'CONVERSATION_NOT_FOUND',
      error:
        'This conversation does not exist in Supabase or you no longer have access to it. Refresh Team Inbox.',
    };
  }

  const currentConv = mapDbConversationRow(currentRow as Record<string, unknown>);
  if (!canUserAccessConversation(currentConv, { id: member.userId, role: member.role })) {
    return {
      ok: false,
      code: 'FORBIDDEN',
      error: 'You are not authorized to modify a conversation assigned to another team member.',
    };
  }

  // 3. Build validated update patch + enforce least-privilege role rules
  const patch: Record<string, unknown> = {};

  if (params.action === 'assign') {
    const nextAssignee = params.assignedToId ?? null;

    if (nextAssignee !== null && !UUID_REGEX.test(nextAssignee)) {
      return {
        ok: false,
        code: 'INVALID_ASSIGNEE',
        error: 'Selected team member ID is not a valid user UUID.',
      };
    }

    // Least privilege: agents cannot arbitrarily assign/reassign conversations to other staff members
    if (member.role === 'agent') {
      const claimingUnassigned =
        currentConv.assignedToId === null && nextAssignee === member.userId;
      const releasingOwn =
        currentConv.assignedToId === member.userId && nextAssignee === null;
      const keepingOwn =
        currentConv.assignedToId === member.userId && nextAssignee === member.userId;
      const keepingUnassigned =
        currentConv.assignedToId === null && nextAssignee === null;

      if (!claimingUnassigned && !releasingOwn && !keepingOwn && !keepingUnassigned) {
        return {
          ok: false,
          code: 'ADMIN_REQUIRED',
          error:
            'Only workspace administrators can assign or reassign conversations to other team members.',
        };
      }
    }

    if (nextAssignee !== null) {
      const { data: targetMember, error: targetErr } = await supabase
        .from('business_members')
        .select('user_id, role, is_active')
        .eq('business_id', params.businessId)
        .eq('user_id', nextAssignee)
        .eq('is_active', true)
        .maybeSingle();

      if (targetErr) {
        return {
          ok: false,
          code: 'ASSIGNEE_CHECK_FAILED',
          error: `Could not verify target team member: ${targetErr.message}`,
        };
      }
      if (!targetMember || (targetMember as Record<string, unknown>).is_active !== true) {
        return {
          ok: false,
          code: 'ASSIGNEE_NOT_ACTIVE',
          error: 'Selected assignee is not an active member of this workspace.',
        };
      }
    }

    patch.assigned_to = nextAssignee;
  } else if (params.action === 'status') {
    if (!params.status || !ALLOWED_CONVERSATION_STATUSES.has(params.status)) {
      return {
        ok: false,
        code: 'INVALID_STATUS',
        error: 'Invalid conversation status. Allowed values are open, pending, and resolved.',
      };
    }
    patch.status = params.status;
  } else if (params.action === 'mark_read') {
    patch.unread_count = 0;
  } else if (params.action === 'handoff') {
    patch.human_handoff_requested = Boolean(params.humanHandoffRequested);
  }

  // 4. Execute awaited UPDATE with business_id scope and .select('*').maybeSingle()
  const { data: updatedRow, error: updateErr } = await supabase
    .from('conversations')
    .update(patch)
    .eq('id', params.conversationId)
    .eq('business_id', params.businessId)
    .select('*')
    .maybeSingle();

  if (updateErr) {
    return {
      ok: false,
      code: updateErr.code || 'CONVERSATION_UPDATE_FAILED',
      error: formatConversationPersistenceError('update', updateErr),
    };
  }

  if (!updatedRow) {
    return {
      ok: false,
      code: 'CONVERSATION_UPDATE_DENIED',
      error:
        'Conversation update was not applied in Supabase. Verify workspace permissions or refresh Team Inbox.',
    };
  }

  const mapped = mapDbConversationRow(updatedRow as Record<string, unknown>);
  seedConversationColumnsFromRows([updatedRow as Record<string, unknown>]);

  return {
    ok: true,
    conversation: mapped,
  };
}
