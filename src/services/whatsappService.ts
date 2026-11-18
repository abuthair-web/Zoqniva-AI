import { supabase } from '@/lib/supabase';
import type {
  DeliveryStatus,
  Message,
  MessageType,
  MessagingMode,
  MetaConnectionState,
  TeamMember,
  WebhookEventSummary,
} from '@/types/crm';

export function getWebhookCallbackUrl(): string | null {
  const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
  if (!url) return null;
  const match = url.match(/^https:\/\/([a-z0-9-]+)\.supabase\.co/i);
  if (match) {
    return `https://${match[1]}.supabase.co/functions/v1/whatsapp-webhook`;
  }
  return `${url.replace(/\/$/, '')}/functions/v1/whatsapp-webhook`;
}

async function extractFunctionErrorPayload(
  error: unknown
): Promise<Record<string, unknown> | null> {
  if (!error || typeof error !== 'object') return null;
  const ctx = (error as { context?: { json?: () => Promise<unknown> } }).context;
  if (ctx && typeof ctx.json === 'function') {
    try {
      const parsed = await ctx.json();
      if (parsed && typeof parsed === 'object') {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }
  return null;
}

export function mapDbMessageRow(
  row: Record<string, unknown>,
  teamMembers: TeamMember[]
): Message {
  const senderId = row.sender_profile_id ? String(row.sender_profile_id) : undefined;
  const senderMember = teamMembers.find((tm) => tm.id === senderId);
  const senderType = (row.sender_type as Message['senderType']) ?? 'contact';

  return {
    id: String(row.id),
    conversationId: String(row.conversation_id),
    senderType,
    senderName:
      senderMember?.fullName ??
      (senderType === 'contact' ? 'Customer' : senderType === 'ai' ? 'AI Assistant' : 'Team'),
    senderId,
    direction: (row.direction as Message['direction']) ?? 'inbound',
    messageType: (row.message_type as MessageType) ?? 'text',
    body: String(row.body ?? ''),
    mediaUrl: row.media_url ? String(row.media_url) : undefined,
    mediaFilename: row.media_filename ? String(row.media_filename) : undefined,
    templateName: row.template_name ? String(row.template_name) : undefined,
    clientRequestId: row.client_request_id ? String(row.client_request_id) : undefined,
    metaMessageId: row.meta_message_id ? String(row.meta_message_id) : undefined,
    deliveryStatus: (row.delivery_status as DeliveryStatus) ?? 'pending',
    errorCode: row.error_code ? String(row.error_code) : undefined,
    errorMessage: row.error_message ? String(row.error_message) : undefined,
    submittedAt: row.submitted_at ? String(row.submitted_at) : undefined,
    sentAt: row.sent_at ? String(row.sent_at) : undefined,
    deliveredAt: row.delivered_at ? String(row.delivered_at) : undefined,
    readAt: row.read_at ? String(row.read_at) : undefined,
    failedAt: row.failed_at ? String(row.failed_at) : undefined,
    lastStatusAt: row.last_status_at ? String(row.last_status_at) : undefined,
    createdAt: String(row.created_at ?? new Date().toISOString()),
  };
}

export interface ConnectionCheckResponse {
  ok: boolean;
  connectionStatus?: MetaConnectionState;
  phoneNumberId?: string;
  wabaId?: string;
  displayPhoneNumber?: string;
  verifiedName?: string;
  qualityRating?: 'green' | 'yellow' | 'red' | 'unknown';
  messagingMode?: MessagingMode;
  testAllowlist?: string[];
  graphApiVersion?: string;
  webhookCallbackUrl?: string;
  webhookSecretsReady?: boolean;
  message?: string;
  error?: string;
  errorCode?: string;
  diagnostic?: string;
}

export async function invokeConnectionCheck(params: {
  action: 'verify' | 'save_config';
  phoneNumberId?: string;
  wabaId?: string;
  messagingMode?: MessagingMode;
  testAllowlist?: string[];
  graphApiVersion?: string;
}): Promise<ConnectionCheckResponse> {
  if (!supabase) {
    return { ok: false, error: 'Supabase client is not configured.' };
  }

  const { data, error } = await supabase.functions.invoke('whatsapp-connection-check', {
    body: params,
  });

  if (error) {
    const errBody = await extractFunctionErrorPayload(error);
    return {
      ok: false,
      connectionStatus: (errBody?.connectionStatus as MetaConnectionState) ?? 'connection_error',
      errorCode: errBody?.errorCode ? String(errBody.errorCode) : 'EDGE_FUNCTION_ERROR',
      error: errBody?.error
        ? String(errBody.error)
        : (error as Error).message || 'Could not verify WhatsApp connection.',
      diagnostic: errBody?.diagnostic ? String(errBody.diagnostic) : undefined,
      webhookCallbackUrl: errBody?.webhookCallbackUrl
        ? String(errBody.webhookCallbackUrl)
        : getWebhookCallbackUrl() ?? undefined,
      webhookSecretsReady:
        typeof errBody?.webhookSecretsReady === 'boolean'
          ? errBody.webhookSecretsReady
          : undefined,
    };
  }

  return (data ?? { ok: false, error: 'Empty response from server.' }) as ConnectionCheckResponse;
}

export interface SendMessageServiceResult {
  ok: boolean;
  idempotentReplay?: boolean;
  deliveryStatus?: DeliveryStatus;
  metaMessageId?: string;
  errorCode?: string;
  error?: string;
  diagnostic?: string;
  messageRow?: Record<string, unknown>;
}

export async function invokeSendWhatsAppMessage(params: {
  conversationId: string;
  messageType: 'text' | 'template';
  body: string;
  templateName?: string;
  language?: string;
  templateParameters?: string[];
  clientRequestId: string;
}): Promise<SendMessageServiceResult> {
  if (!supabase) {
    return { ok: false, errorCode: 'SUPABASE_NOT_CONFIGURED', error: 'Supabase is not configured.' };
  }

  const { data, error } = await supabase.functions.invoke('whatsapp-send-message', {
    body: params,
  });

  if (error) {
    const errBody = await extractFunctionErrorPayload(error);
    return {
      ok: false,
      errorCode: errBody?.code ? String(errBody.code) : 'EDGE_FUNCTION_ERROR',
      error: errBody?.error
        ? String(errBody.error)
        : (error as Error).message || 'Failed to send message via WhatsApp Cloud API.',
      diagnostic: errBody?.diagnostic ? String(errBody.diagnostic) : undefined,
      messageRow:
        errBody?.message && typeof errBody.message === 'object'
          ? (errBody.message as Record<string, unknown>)
          : undefined,
    };
  }

  const payload = (data ?? {}) as Record<string, unknown>;
  return {
    ok: Boolean(payload.ok),
    idempotentReplay: Boolean(payload.idempotentReplay),
    deliveryStatus: payload.deliveryStatus as DeliveryStatus | undefined,
    metaMessageId: payload.metaMessageId ? String(payload.metaMessageId) : undefined,
    errorCode: payload.code ? String(payload.code) : undefined,
    error: payload.error ? String(payload.error) : undefined,
    messageRow:
      payload.message && typeof payload.message === 'object'
        ? (payload.message as Record<string, unknown>)
        : undefined,
  };
}

export async function fetchOlderMessagesPage(params: {
  businessId: string;
  conversationId: string;
  beforeIso: string;
  limit?: number;
  teamMembers: TeamMember[];
}): Promise<{ messages: Message[]; hasMore: boolean }> {
  if (!supabase) return { messages: [], hasMore: false };
  const limit = params.limit ?? 50;

  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('business_id', params.businessId)
    .eq('conversation_id', params.conversationId)
    .lt('created_at', params.beforeIso)
    .order('created_at', { ascending: false })
    .limit(limit + 1);

  if (error || !data) {
    return { messages: [], hasMore: false };
  }

  const hasMore = data.length > limit;
  const sliced = hasMore ? data.slice(0, limit) : data;
  const mapped = sliced
    .reverse()
    .map((row) => mapDbMessageRow(row as Record<string, unknown>, params.teamMembers));

  return { messages: mapped, hasMore };
}

export async function fetchRecentWebhookEvents(
  businessId: string,
  limit = 10
): Promise<WebhookEventSummary[]> {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('webhook_events')
    .select('id, event_type, signature_valid, processed, processing_error, received_at')
    .eq('business_id', businessId)
    .order('received_at', { ascending: false })
    .limit(limit);

  if (error || !data) return [];

  return (data as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    eventType: String(row.event_type ?? 'whatsapp_webhook'),
    signatureValid: Boolean(row.signature_valid),
    processed: Boolean(row.processed),
    processingError: row.processing_error ? String(row.processing_error) : undefined,
    receivedAt: String(row.received_at ?? new Date().toISOString()),
  }));
}

export async function invokeSyncTemplates(): Promise<{
  ok: boolean;
  templatesCount: number;
  error?: string;
}> {
  if (!supabase) {
    return { ok: false, templatesCount: 0, error: 'Supabase client is not configured.' };
  }

  const { data, error } = await supabase.functions.invoke('sync-templates', {
    method: 'POST',
  });

  if (error) {
    const errBody = await extractFunctionErrorPayload(error);
    return {
      ok: false,
      templatesCount: 0,
      error: errBody?.error
        ? String(errBody.error)
        : (error as Error).message || 'Could not sync WhatsApp templates from Meta.',
    };
  }

  const payload = (data ?? {}) as Record<string, unknown>;
  return {
    ok: Boolean(payload.ok),
    templatesCount: Number(payload.templatesCount ?? 0),
    error: payload.error ? String(payload.error) : undefined,
  };
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PHONE_ID_COLUMN_CANDIDATES = ['phone_number_id', 'meta_phone_number_id'] as const;
const WABA_ID_COLUMN_CANDIDATES = [
  'waba_id',
  'meta_waba_id',
  'whatsapp_business_account_id',
  'business_account_id',
] as const;

const METADATA_COLUMN_CANDIDATES = [
  'id',
  'business_id',
  'display_name',
  'phone_number_e164',
  'phone_number',
  'connection_status',
  'status',
  'messaging_mode',
  'test_allowlist',
  'graph_api_version',
  'verified_name',
  'quality_rating',
  'webhook_verified_at',
  'last_sync_at',
  'last_error_message',
  'app_id',
  'created_at',
  'updated_at',
] as const;

let cachedWhatsAppColumns: Set<string> | null = null;

function cleanCredentialString(raw: unknown): string {
  if (typeof raw !== 'string' && typeof raw !== 'number') return '';
  const trimmed = String(raw).trim();
  if (!trimmed || trimmed === 'unconfigured') return '';
  return trimmed;
}

export function extractWhatsAppPhoneNumberId(row?: Record<string, unknown> | null): string {
  if (!row) return '';
  for (const col of PHONE_ID_COLUMN_CANDIDATES) {
    const val = cleanCredentialString(row[col]);
    if (val) return val;
  }
  return '';
}

export function extractWhatsAppWabaId(row?: Record<string, unknown> | null): string {
  if (!row) return '';
  for (const col of WABA_ID_COLUMN_CANDIDATES) {
    const val = cleanCredentialString(row[col]);
    if (val) return val;
  }
  return '';
}

export async function detectWhatsAppAccountColumns(
  seedRow?: Record<string, unknown> | null
): Promise<Set<string>> {
  if (cachedWhatsAppColumns && cachedWhatsAppColumns.size > 0) {
    if (seedRow) {
      for (const k of Object.keys(seedRow)) cachedWhatsAppColumns.add(k);
    }
    return cachedWhatsAppColumns;
  }

  const detected = new Set<string>();
  if (seedRow) {
    for (const k of Object.keys(seedRow)) detected.add(k);
  }

  if (!supabase) return detected;
  const client = supabase;

  const probeList = [
    ...PHONE_ID_COLUMN_CANDIDATES,
    ...WABA_ID_COLUMN_CANDIDATES,
    ...METADATA_COLUMN_CANDIDATES,
  ].filter((col) => !detected.has(col));

  await Promise.all(
    probeList.map(async (col) => {
      try {
        const { error } = await client.from('whatsapp_accounts').select(col).limit(0);
        if (!error) {
          detected.add(col);
        }
      } catch {
        // Ignore probe network errors cleanly
      }
    })
  );

  if (detected.size > 0) {
    cachedWhatsAppColumns = detected;
  }
  return detected;
}

export async function fetchBusinessWhatsAppAccount(businessId: string): Promise<{
  ok: boolean;
  row: Record<string, unknown> | null;
  error?: string;
}> {
  if (!supabase || !UUID_REGEX.test(businessId)) {
    return { ok: false, row: null, error: 'Supabase workspace is not configured.' };
  }

  const { data, error } = await supabase
    .from('whatsapp_accounts')
    .select('*')
    .eq('business_id', businessId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    return { ok: false, row: null, error: error.message };
  }

  const row = (data as Record<string, unknown> | null) ?? null;
  if (row) {
    if (!cachedWhatsAppColumns) cachedWhatsAppColumns = new Set<string>();
    for (const k of Object.keys(row)) cachedWhatsAppColumns.add(k);
  }

  return { ok: true, row };
}

export interface SaveWhatsAppConfigurationResult {
  ok: boolean;
  message: string;
  phoneNumberId?: string;
  wabaId?: string;
  messagingMode?: MessagingMode;
  testAllowlist?: string[];
  graphApiVersion?: string;
  row?: Record<string, unknown>;
}

export async function saveBusinessWhatsAppConfiguration(params: {
  businessId: string;
  phoneNumberId: string;
  wabaId: string;
  messagingMode: MessagingMode;
  testAllowlist: string[];
  graphApiVersion?: string;
}): Promise<SaveWhatsAppConfigurationResult> {
  if (!supabase) {
    return { ok: false, message: 'Supabase client is not configured.' };
  }

  const cleanBusinessId = params.businessId.trim();
  const cleanPhoneId = params.phoneNumberId.trim();
  const cleanWabaId = params.wabaId.trim();
  const cleanGraphVersion = params.graphApiVersion?.trim() || 'v21.0';

  if (!UUID_REGEX.test(cleanBusinessId)) {
    return { ok: false, message: 'Active business workspace could not be resolved.' };
  }

  if (!cleanPhoneId || !cleanWabaId) {
    return {
      ok: false,
      message: 'Both Meta Phone Number ID and WhatsApp Business Account (WABA) ID are required.',
    };
  }

  // 1. Verify authenticated user & active admin role for this exact business (RLS compliant)
  const { data: userRes, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userRes.user) {
    return { ok: false, message: 'Your session has expired. Sign in again and retry.' };
  }

  const { data: memberRow, error: memberErr } = await supabase
    .from('business_members')
    .select('role, status')
    .eq('business_id', cleanBusinessId)
    .eq('user_id', userRes.user.id)
    .maybeSingle();

  if (memberErr) {
    return { ok: false, message: `Unable to verify administrator permissions: ${memberErr.message}` };
  }

  const memberStatus = memberRow?.status ? String(memberRow.status) : 'active';
  if (!memberRow || memberStatus !== 'active' || memberRow.role !== 'admin') {
    return {
      ok: false,
      message: 'Only active business administrators can save WhatsApp configuration.',
    };
  }

  // 2. Load existing row for this business (prevents duplicate records)
  const existingRes = await fetchBusinessWhatsAppAccount(cleanBusinessId);
  if (!existingRes.ok) {
    return { ok: false, message: existingRes.error || 'Failed to read existing WhatsApp settings.' };
  }

  const existingRow = existingRes.row;
  const cols = await detectWhatsAppAccountColumns(existingRow);

  const phoneCols = PHONE_ID_COLUMN_CANDIDATES.filter((c) => cols.has(c));
  const wabaCols = WABA_ID_COLUMN_CANDIDATES.filter((c) => cols.has(c));

  if (phoneCols.length === 0 || wabaCols.length === 0) {
    return {
      ok: false,
      message:
        'Could not locate Phone Number ID or WABA ID columns in public.whatsapp_accounts. Check database schema permissions.',
    };
  }

  const writePayload: Record<string, unknown> = {};
  for (const c of phoneCols) writePayload[c] = cleanPhoneId;
  for (const c of wabaCols) writePayload[c] = cleanWabaId;

  if (cols.has('messaging_mode')) writePayload.messaging_mode = params.messagingMode;
  if (cols.has('test_allowlist')) writePayload.test_allowlist = params.testAllowlist;
  if (cols.has('graph_api_version')) writePayload.graph_api_version = cleanGraphVersion;

  let savedRowId: string | null = existingRow?.id ? String(existingRow.id) : null;

  if (existingRow && savedRowId) {
    const { error: updErr } = await supabase
      .from('whatsapp_accounts')
      .update(writePayload)
      .eq('id', savedRowId)
      .eq('business_id', cleanBusinessId);

    if (updErr) {
      cachedWhatsAppColumns = null;
      return { ok: false, message: `Failed to save WhatsApp configuration: ${updErr.message}` };
    }
  } else {
    const insertPayload: Record<string, unknown> = {
      business_id: cleanBusinessId,
      ...writePayload,
    };
    if (cols.has('display_name')) insertPayload.display_name = 'WhatsApp Business';
    if (cols.has('phone_number_e164')) insertPayload.phone_number_e164 = '+10000000000';
    if (cols.has('phone_number')) insertPayload.phone_number = '+10000000000';
    if (cols.has('connection_status')) insertPayload.connection_status = 'configuration_required';
    if (cols.has('status') && !cols.has('connection_status')) {
      insertPayload.status = 'configuration_required';
    }

    const { data: insertedRow, error: insErr } = await supabase
      .from('whatsapp_accounts')
      .insert(insertPayload)
      .select('*')
      .maybeSingle();

    if (insErr) {
      cachedWhatsAppColumns = null;
      return { ok: false, message: `Failed to create WhatsApp configuration: ${insErr.message}` };
    }
    savedRowId = insertedRow?.id ? String((insertedRow as Record<string, unknown>).id) : null;
  }

  // 3. Re-fetch directly from Supabase and verify values persisted accurately
  const verifyQuery = savedRowId
    ? supabase
        .from('whatsapp_accounts')
        .select('*')
        .eq('id', savedRowId)
        .eq('business_id', cleanBusinessId)
        .maybeSingle()
    : supabase
        .from('whatsapp_accounts')
        .select('*')
        .eq('business_id', cleanBusinessId)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

  const { data: verifiedData, error: verifyErr } = await verifyQuery;
  if (verifyErr || !verifiedData) {
    return {
      ok: false,
      message: verifyErr
        ? `Saved record could not be verified: ${verifyErr.message}`
        : 'Saved record could not be read back from Supabase to confirm persistence.',
    };
  }

  const verifiedRow = verifiedData as Record<string, unknown>;
  const persistedPhoneId = extractWhatsAppPhoneNumberId(verifiedRow);
  const persistedWabaId = extractWhatsAppWabaId(verifiedRow);

  if (persistedPhoneId !== cleanPhoneId || persistedWabaId !== cleanWabaId) {
    return {
      ok: false,
      message: 'Supabase read-back check failed: saved IDs did not match entered values.',
    };
  }

  // Best-effort audit log (non-blocking)
  void supabase.from('audit_logs').insert({
    business_id: cleanBusinessId,
    actor_id: userRes.user.id,
    action: 'Saved WhatsApp Configuration',
    entity_type: 'whatsapp_account',
    details: {
      summary: `Saved Phone ID ${cleanPhoneId} and WABA ID ${cleanWabaId} (${params.messagingMode} mode)`,
    },
  });

  return {
    ok: true,
    message: 'WhatsApp configuration saved and verified in Supabase.',
    phoneNumberId: persistedPhoneId,
    wabaId: persistedWabaId,
    messagingMode:
      verifiedRow.messaging_mode === 'live'
        ? 'live'
        : verifiedRow.messaging_mode === 'test'
        ? 'test'
        : params.messagingMode,
    testAllowlist: Array.isArray(verifiedRow.test_allowlist)
      ? verifiedRow.test_allowlist.map(String)
      : params.testAllowlist,
    graphApiVersion: verifiedRow.graph_api_version
      ? String(verifiedRow.graph_api_version)
      : cleanGraphVersion,
    row: verifiedRow,
  };
}


