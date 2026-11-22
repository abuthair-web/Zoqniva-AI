import { supabase } from '@/lib/supabase';
import { normalizePhoneE164 } from '@/lib/phone';
import type { Campaign, CampaignStatus, Contact, Tag } from '@/types/crm';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type ManagedTableName = 'contacts' | 'campaigns';

// Cached schema columns discovered from real rows or PostgREST OpenAPI metadata
const knownTableColumns = new Map<ManagedTableName, Set<string>>();
const missingTableColumns = new Map<ManagedTableName, Set<string>>([
  ['contacts', new Set<string>(['city'])], // Confirmed missing in live public.contacts unless discovered present
  ['campaigns', new Set<string>()],
]);
let openApiDiscoveryAttempted = false;

export function resetSchemaDiscoveryCache(): void {
  knownTableColumns.clear();
  missingTableColumns.set('contacts', new Set<string>(['city']));
  missingTableColumns.set('campaigns', new Set<string>());
  openApiDiscoveryAttempted = false;
}

export function seedTableColumnsFromRows(
  table: ManagedTableName,
  rows: Array<Record<string, unknown>> | null | undefined
): void {
  if (!rows || rows.length === 0) return;
  const cols = knownTableColumns.get(table) ?? new Set<string>();
  const missing = missingTableColumns.get(table) ?? new Set<string>();
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    for (const key of Object.keys(row)) {
      cols.add(key);
      missing.delete(key);
    }
  }
  if (cols.size > 0) {
    knownTableColumns.set(table, cols);
    missingTableColumns.set(table, missing);
  }
}

export function getKnownTableColumns(table: ManagedTableName): Set<string> | null {
  const cols = knownTableColumns.get(table);
  return cols && cols.size > 0 ? new Set(cols) : null;
}

export function getMissingTableColumns(table: ManagedTableName): Set<string> {
  return new Set(missingTableColumns.get(table) ?? []);
}

export function tableHasConfirmedColumn(table: ManagedTableName, column: string): boolean {
  const cols = knownTableColumns.get(table);
  return Boolean(cols && cols.has(column));
}

function recordMissingColumn(table: ManagedTableName, column: string): void {
  const missing = missingTableColumns.get(table) ?? new Set<string>();
  missing.add(column);
  missingTableColumns.set(table, missing);
  const cols = knownTableColumns.get(table);
  if (cols) {
    cols.delete(column);
  }
}

/**
 * Inspects PostgREST OpenAPI definitions once using only the publishable key + user JWT
 * (never a service-role key). Works even when tables are empty and avoids 400 column-probe spam.
 */
export async function discoverTableColumns(
  table: ManagedTableName
): Promise<Set<string> | null> {
  const existing = knownTableColumns.get(table);
  if (existing && existing.size > 0) {
    return existing;
  }

  if (!supabase || openApiDiscoveryAttempted) {
    return knownTableColumns.get(table) ?? null;
  }

  const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
  const publishableKey = (
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined
  )?.trim();

  if (!supabaseUrl || !publishableKey) {
    return null;
  }

  openApiDiscoveryAttempted = true;

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
      return knownTableColumns.get(table) ?? null;
    }

    const spec = (await res.json()) as {
      definitions?: Record<string, { properties?: Record<string, unknown> }>;
    };

    const managedTables: ManagedTableName[] = ['contacts', 'campaigns'];
    for (const tbl of managedTables) {
      const props = spec.definitions?.[tbl]?.properties;
      if (props && typeof props === 'object') {
        const colSet = new Set<string>(Object.keys(props));
        if (colSet.size > 0) {
          knownTableColumns.set(tbl, colSet);
          const missing = missingTableColumns.get(tbl) ?? new Set<string>();
          for (const c of colSet) missing.delete(c);
          missingTableColumns.set(tbl, missing);
        }
      }
    }
  } catch {
    // Gracefully fall back to conservative payload + PGRST204 handling
  }

  return knownTableColumns.get(table) ?? null;
}

export interface SupabaseLikeError {
  code?: string;
  message?: string;
  details?: string | null;
  hint?: string | null;
}

/**
 * Extracts the missing column name from PostgREST PGRST204 errors such as:
 * "Could not find the 'city' column of 'contacts' in the schema cache"
 */
export function parsePgrst204MissingColumn(error: SupabaseLikeError | null | undefined): string | null {
  if (!error) return null;
  const msg = String(error.message ?? '');
  if (error.code !== 'PGRST204' && !/schema cache/i.test(msg)) {
    return null;
  }
  const match = msg.match(/Could not find the '([a-zA-Z0-9_]+)' column/i);
  return match?.[1] ?? null;
}

export function formatPersistenceError(
  entity: 'contact' | 'campaign' | 'tag',
  error: SupabaseLikeError | null | undefined,
  context?: { phoneE164?: string }
): string {
  if (!error) {
    return `Could not save ${entity} in Supabase.`;
  }

  const code = String(error.code ?? '');
  const rawMsg = String(error.message ?? '').trim();
  const details = String(error.details ?? '').trim();

  if (code === '23505') {
    if (entity === 'contact') {
      return context?.phoneE164
        ? `A contact with phone number ${context.phoneE164} already exists in this workspace.`
        : 'A contact with this phone number already exists in this workspace.';
    }
    if (entity === 'tag') {
      return 'A tag with this name already exists in this workspace.';
    }
    return `A duplicate ${entity} record already exists in this workspace.`;
  }

  if (code === '42501' || /row-level security|permission denied/i.test(rawMsg)) {
    if (entity === 'campaign') {
      return 'Permission denied by database Row-Level Security (RLS) on public.campaigns. Ensure your account is an active workspace administrator and campaigns INSERT/SELECT RLS policies are enabled.';
    }
    return `Permission denied by database Row-Level Security (RLS) on public.${entity}s. Ensure your account is an active member of this workspace and RLS INSERT/SELECT policies are enabled.`;
  }

  if (code === '23514') {
    if (entity === 'contact' && /phone/i.test(rawMsg)) {
      return 'Phone number failed database E.164 format validation. Use international format such as +15551234567.';
    }
    if (entity === 'contact' && /name/i.test(rawMsg)) {
      return 'Contact full name cannot be empty.';
    }
    if (entity === 'campaign' && /name/i.test(rawMsg)) {
      return 'Campaign name must be at least 2 characters long.';
    }
    if (entity === 'campaign' && /status/i.test(rawMsg)) {
      return `Campaign status failed database validation (${rawMsg}).`;
    }
    return `Validation constraint rejected this ${entity}: ${rawMsg}`;
  }

  if (code === '23503') {
    if (entity === 'campaign' && /template/i.test(`${rawMsg} ${details}`)) {
      return 'The selected WhatsApp template could not be found in Supabase. Sync templates and try again.';
    }
    return `Related workspace record could not be found in Supabase (${rawMsg}).`;
  }

  if (code === '23502') {
    return `A required database field was missing while saving ${entity}: ${rawMsg}`;
  }

  if (code === 'PGRST204') {
    return `Database schema mismatch while saving ${entity}: ${rawMsg}`;
  }

  return rawMsg || `Could not save ${entity} in Supabase.`;
}

// ============================================================================
// CONTACTS — MAPPING, VALIDATION & SCHEMA-SAFE PAYLOAD BUILDERS
// ============================================================================

export function mapDbContactRow(
  row: Record<string, unknown>,
  tagIds: string[] = []
): Contact {
  const fullName = String(row.full_name ?? row.name ?? '').trim();
  const phoneE164 = String(row.phone_e164 ?? row.phone ?? '').trim();
  const rawOptInStatus = typeof row.opt_in_status === 'string' ? row.opt_in_status.trim().toLowerCase() : '';
  const marketingOptIn =
    row.marketing_opt_in !== undefined
      ? Boolean(row.marketing_opt_in)
      : row.opt_in !== undefined
      ? Boolean(row.opt_in)
      : rawOptInStatus === 'opted_in' || rawOptInStatus === 'subscribed' || rawOptInStatus === 'active';

  return {
    id: String(row.id),
    fullName,
    phoneE164,
    waId: row.wa_id ? String(row.wa_id) : undefined,
    email: String(row.email ?? ''),
    company: String(row.company ?? ''),
    city: String(row.city ?? ''),
    country: String(row.country ?? ''),
    marketingOptIn,
    optedOutAt: row.opted_out_at ? String(row.opted_out_at) : undefined,
    tagIds,
    notes: String(row.notes ?? ''),
    lastContactedAt: row.last_contacted_at ? String(row.last_contacted_at) : undefined,
    createdAt: String(row.created_at ?? new Date().toISOString()),
  };
}

export interface ContactCreateInput {
  businessId: string;
  fullName: string;
  phone: string;
  email?: string;
  company?: string;
  city?: string;
  country?: string;
  marketingOptIn: boolean;
  tagIds?: string[];
  notes?: string;
  createdBy?: string | null;
}

export function validateContactInput(input: {
  businessId?: string;
  fullName: string;
  phone: string;
  email?: string;
  requireBusinessId?: boolean;
}): { ok: boolean; normalizedPhone?: string; cleanName?: string; cleanEmail?: string; error?: string } {
  const cleanName = input.fullName.trim();
  if (cleanName.length < 1) {
    return { ok: false, error: 'Please enter the contact full name.' };
  }

  const normalizedPhone = normalizePhoneE164(input.phone);
  if (!normalizedPhone) {
    return {
      ok: false,
      error: 'Enter a valid international phone number in E.164 format (e.g., +15551234567).',
    };
  }

  const cleanEmail = (input.email ?? '').trim();
  if (cleanEmail && !EMAIL_REGEX.test(cleanEmail)) {
    return { ok: false, error: 'Enter a valid email address or leave the Email field blank.' };
  }

  if (input.requireBusinessId && (!input.businessId || !UUID_REGEX.test(input.businessId))) {
    return {
      ok: false,
      error: 'Active business workspace could not be verified. Refresh the page and sign in again.',
    };
  }

  return { ok: true, normalizedPhone, cleanName, cleanEmail };
}

function canWriteColumn(
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
 * Builds a schema-safe INSERT payload for public.contacts.
 * Never includes `city` unless the live database schema explicitly has a `city` column.
 */
export function buildContactInsertPayload(
  input: {
    businessId: string;
    fullName: string;
    phoneE164: string;
    email?: string;
    company?: string;
    city?: string;
    country?: string;
    marketingOptIn: boolean;
    notes?: string;
    createdBy?: string | null;
  },
  knownCols: Set<string> | null,
  missingCols: Set<string> = new Set(['city'])
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    business_id: input.businessId,
  };

  // Name column (full_name is standard; adapt only if live schema uses `name`)
  if (knownCols && !knownCols.has('full_name') && knownCols.has('name')) {
    payload.name = input.fullName;
  } else {
    payload.full_name = input.fullName;
  }

  // Phone column (phone_e164 is standard; adapt only if live schema uses `phone`)
  if (knownCols && !knownCols.has('phone_e164') && knownCols.has('phone')) {
    payload.phone = input.phoneE164;
  } else {
    payload.phone_e164 = input.phoneE164;
  }

  // Consent column(s)
  if (knownCols && !knownCols.has('marketing_opt_in') && knownCols.has('opt_in')) {
    payload.opt_in = Boolean(input.marketingOptIn);
  } else if (canWriteColumn('marketing_opt_in', knownCols, missingCols)) {
    payload.marketing_opt_in = Boolean(input.marketingOptIn);
  }
  if (canWriteColumn('opt_in_status', knownCols, missingCols, true)) {
    payload.opt_in_status = input.marketingOptIn ? 'opted_in' : 'opted_out';
  }

  // Optional columns — only include when supported by the real live table
  const cleanEmail = (input.email ?? '').trim();
  const cleanCompany = (input.company ?? '').trim();
  const cleanCity = (input.city ?? '').trim();
  const cleanCountry = (input.country ?? '').trim();
  const cleanNotes = (input.notes ?? '').trim();
  const waId = input.phoneE164.replace(/^\+/, '');

  if (canWriteColumn('wa_id', knownCols, missingCols)) {
    payload.wa_id = waId;
  }
  if (cleanEmail && canWriteColumn('email', knownCols, missingCols)) {
    payload.email = cleanEmail;
  }
  if (cleanCompany && canWriteColumn('company', knownCols, missingCols)) {
    payload.company = cleanCompany;
  }
  // Explicitly NEVER write `city` unless confirmed present in live public.contacts
  if (cleanCity && canWriteColumn('city', knownCols, missingCols, true)) {
    payload.city = cleanCity;
  }
  if (cleanCountry && canWriteColumn('country', knownCols, missingCols, true)) {
    payload.country = cleanCountry;
  }
  if (cleanNotes && canWriteColumn('notes', knownCols, missingCols)) {
    payload.notes = cleanNotes;
  }
  if (
    input.createdBy &&
    UUID_REGEX.test(input.createdBy) &&
    canWriteColumn('created_by', knownCols, missingCols, true)
  ) {
    payload.created_by = input.createdBy;
  }

  return payload;
}

export function buildContactUpdatePayload(
  updates: Omit<Partial<Contact>, 'optedOutAt'> & { optedOutAt?: string | null },
  knownCols: Set<string> | null,
  missingCols: Set<string> = new Set(['city'])
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};

  if (updates.fullName !== undefined) {
    if (knownCols && !knownCols.has('full_name') && knownCols.has('name')) {
      patch.name = updates.fullName.trim();
    } else {
      patch.full_name = updates.fullName.trim();
    }
  }

  if (updates.phoneE164 !== undefined) {
    if (knownCols && !knownCols.has('phone_e164') && knownCols.has('phone')) {
      patch.phone = updates.phoneE164;
    } else {
      patch.phone_e164 = updates.phoneE164;
    }
    if (canWriteColumn('wa_id', knownCols, missingCols)) {
      patch.wa_id = updates.phoneE164.replace(/^\+/, '');
    }
  }

  if (updates.email !== undefined && canWriteColumn('email', knownCols, missingCols)) {
    patch.email = updates.email.trim() || null;
  }

  if (updates.company !== undefined && canWriteColumn('company', knownCols, missingCols)) {
    patch.company = updates.company.trim() || null;
  }

  // Explicitly NEVER write `city` unless confirmed present in live public.contacts
  if (updates.city !== undefined && canWriteColumn('city', knownCols, missingCols, true)) {
    patch.city = updates.city.trim() || null;
  }

  if (updates.country !== undefined && canWriteColumn('country', knownCols, missingCols, true)) {
    patch.country = updates.country.trim() || null;
  }

  if (updates.notes !== undefined && canWriteColumn('notes', knownCols, missingCols)) {
    patch.notes = updates.notes;
  }

  if (updates.marketingOptIn !== undefined) {
    if (knownCols && !knownCols.has('marketing_opt_in') && knownCols.has('opt_in')) {
      patch.opt_in = Boolean(updates.marketingOptIn);
    } else if (canWriteColumn('marketing_opt_in', knownCols, missingCols)) {
      patch.marketing_opt_in = Boolean(updates.marketingOptIn);
    }
    if (canWriteColumn('opt_in_status', knownCols, missingCols, true)) {
      patch.opt_in_status = updates.marketingOptIn ? 'opted_in' : 'opted_out';
    }
    if (canWriteColumn('opted_out_at', knownCols, missingCols, true)) {
      patch.opted_out_at = updates.optedOutAt ?? null;
    }
  }

  return patch;
}

const CONTACT_CORE_PROTECTED_COLS = new Set(['business_id', 'full_name', 'name', 'phone_e164', 'phone']);

export async function createContactInDb(
  input: ContactCreateInput
): Promise<{ ok: boolean; contact?: Contact; warning?: string; error?: string }> {
  if (!supabase) {
    return { ok: false, error: 'Supabase client is not configured.' };
  }

  const validation = validateContactInput({
    businessId: input.businessId,
    fullName: input.fullName,
    phone: input.phone,
    email: input.email,
    requireBusinessId: true,
  });

  if (!validation.ok || !validation.normalizedPhone || !validation.cleanName) {
    return { ok: false, error: validation.error || 'Invalid contact details.' };
  }

  const normalizedPhone = validation.normalizedPhone;
  const cleanName = validation.cleanName;
  const cleanEmail = validation.cleanEmail ?? '';

  // Verify active authenticated session
  const { data: userRes, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userRes.user) {
    return { ok: false, error: 'Your session has expired. Sign in again and retry.' };
  }

  const knownCols = await discoverTableColumns('contacts');
  const phoneCol =
    knownCols && !knownCols.has('phone_e164') && knownCols.has('phone') ? 'phone' : 'phone_e164';

  // Duplicate check against live database in active workspace
  const { data: existingMatch } = await supabase
    .from('contacts')
    .select('id')
    .eq('business_id', input.businessId)
    .eq(phoneCol, normalizedPhone)
    .limit(1)
    .maybeSingle();

  if (existingMatch?.id) {
    return {
      ok: false,
      error: `A contact with phone number ${normalizedPhone} already exists in this workspace.`,
    };
  }

  const payload = buildContactInsertPayload(
    {
      businessId: input.businessId,
      fullName: cleanName,
      phoneE164: normalizedPhone,
      email: cleanEmail,
      company: input.company,
      city: input.city,
      country: input.country,
      marketingOptIn: input.marketingOptIn,
      notes: input.notes,
      createdBy: input.createdBy ?? userRes.user.id,
    },
    knownCols,
    getMissingTableColumns('contacts')
  );

  // Real INSERT with .select('*').single() + PGRST204 safety net for any unsupported optional column
  let insertedRow: Record<string, unknown> | null = null;
  let lastError: SupabaseLikeError | null = null;

  for (let attempt = 0; attempt < 8; attempt++) {
    const { data, error } = await supabase
      .from('contacts')
      .insert(payload)
      .select('*')
      .single();

    if (!error && data) {
      insertedRow = data as Record<string, unknown>;
      seedTableColumnsFromRows('contacts', [insertedRow]);
      lastError = null;
      break;
    }

    lastError = error;
    const missingCol = parsePgrst204MissingColumn(error);
    if (
      missingCol &&
      missingCol in payload &&
      !CONTACT_CORE_PROTECTED_COLS.has(missingCol)
    ) {
      recordMissingColumn('contacts', missingCol);
      delete payload[missingCol];
      continue;
    }
    break;
  }

  if (lastError || !insertedRow) {
    return {
      ok: false,
      error: formatPersistenceError('contact', lastError, { phoneE164: normalizedPhone }),
    };
  }

  const persistedId = String(insertedRow.id);

  // Re-fetch persisted contact from Supabase to verify read-back & persistence across refresh
  const { data: verifiedRow, error: verifyErr } = await supabase
    .from('contacts')
    .select('*')
    .eq('id', persistedId)
    .eq('business_id', input.businessId)
    .single();

  if (verifyErr || !verifiedRow) {
    return {
      ok: false,
      error: verifyErr
        ? `Contact was written but could not be read back from Supabase: ${formatPersistenceError('contact', verifyErr)}`
        : 'Contact could not be verified in Supabase after creation.',
    };
  }

  // Persist tag links if selected
  const validTagIds = (input.tagIds ?? []).filter((tid) => UUID_REGEX.test(tid));
  let persistedTagIds: string[] = [];
  let warning: string | undefined;

  if (validTagIds.length > 0) {
    const { error: tagErr } = await supabase
      .from('contact_tags')
      .insert(validTagIds.map((tid) => ({ contact_id: persistedId, tag_id: tid })));

    if (tagErr) {
      warning = `Contact saved, but tags could not be attached (${tagErr.message}).`;
    } else {
      persistedTagIds = validTagIds;
    }
  }

  return {
    ok: true,
    contact: mapDbContactRow(verifiedRow as Record<string, unknown>, persistedTagIds),
    warning,
  };
}

export async function updateContactInDb(params: {
  businessId: string;
  contactId: string;
  updates: Omit<Partial<Contact>, 'optedOutAt'> & { optedOutAt?: string | null };
  existingTagIds: string[];
}): Promise<{ ok: boolean; contact?: Contact; error?: string }> {
  if (!supabase) {
    return { ok: false, error: 'Supabase client is not configured.' };
  }
  if (!UUID_REGEX.test(params.businessId) || !UUID_REGEX.test(params.contactId)) {
    return { ok: false, error: 'Invalid workspace or contact identifier.' };
  }

  if (params.updates.fullName !== undefined && params.updates.fullName.trim().length < 1) {
    return { ok: false, error: 'Contact full name cannot be empty.' };
  }
  if (params.updates.email !== undefined) {
    const trimmedEmail = params.updates.email.trim();
    if (trimmedEmail && !EMAIL_REGEX.test(trimmedEmail)) {
      return { ok: false, error: 'Enter a valid email address or leave Email blank.' };
    }
  }

  let normalizedPhone: string | undefined;
  if (params.updates.phoneE164 !== undefined) {
    const parsed = normalizePhoneE164(params.updates.phoneE164);
    if (!parsed) {
      return {
        ok: false,
        error: 'Enter a valid international phone number in E.164 format (e.g., +15551234567).',
      };
    }
    normalizedPhone = parsed;
  }

  const { data: userRes, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userRes.user) {
    return { ok: false, error: 'Your session has expired. Sign in again and retry.' };
  }

  const knownCols = await discoverTableColumns('contacts');
  const patch = buildContactUpdatePayload(
    {
      ...params.updates,
      ...(normalizedPhone ? { phoneE164: normalizedPhone } : {}),
    },
    knownCols,
    getMissingTableColumns('contacts')
  );

  let updatedRow: Record<string, unknown> | null = null;
  let lastError: SupabaseLikeError | null = null;

  if (Object.keys(patch).length > 0) {
    for (let attempt = 0; attempt < 8; attempt++) {
      if (Object.keys(patch).length === 0) {
        lastError = null;
        break;
      }

      const { data, error } = await supabase
        .from('contacts')
        .update(patch)
        .eq('id', params.contactId)
        .eq('business_id', params.businessId)
        .select('*')
        .single();

      if (!error && data) {
        updatedRow = data as Record<string, unknown>;
        seedTableColumnsFromRows('contacts', [updatedRow]);
        lastError = null;
        break;
      }

      lastError = error;
      const missingCol = parsePgrst204MissingColumn(error);
      if (
        missingCol &&
        missingCol in patch &&
        !CONTACT_CORE_PROTECTED_COLS.has(missingCol)
      ) {
        recordMissingColumn('contacts', missingCol);
        delete patch[missingCol];
        continue;
      }
      break;
    }

    if (lastError) {
      return {
        ok: false,
        error: formatPersistenceError('contact', lastError, { phoneE164: normalizedPhone }),
      };
    }
  }

  let nextTagIds = params.existingTagIds;
  if (params.updates.tagIds !== undefined) {
    const validTagIds = params.updates.tagIds.filter((tid) => UUID_REGEX.test(tid));
    const { error: delTagErr } = await supabase
      .from('contact_tags')
      .delete()
      .eq('contact_id', params.contactId);

    if (delTagErr) {
      return {
        ok: false,
        error: `Failed to update contact tags: ${delTagErr.message}`,
      };
    }

    if (validTagIds.length > 0) {
      const { error: insTagErr } = await supabase
        .from('contact_tags')
        .insert(validTagIds.map((tid) => ({ contact_id: params.contactId, tag_id: tid })));

      if (insTagErr) {
        return {
          ok: false,
          error: `Failed to save contact tags: ${insTagErr.message}`,
        };
      }
    }
    nextTagIds = validTagIds;
  }

  if (!updatedRow) {
    const { data: fetchedRow, error: fetchErr } = await supabase
      .from('contacts')
      .select('*')
      .eq('id', params.contactId)
      .eq('business_id', params.businessId)
      .single();

    if (fetchErr || !fetchedRow) {
      return {
        ok: false,
        error: formatPersistenceError('contact', fetchErr),
      };
    }
    updatedRow = fetchedRow as Record<string, unknown>;
  }

  return {
    ok: true,
    contact: mapDbContactRow(updatedRow, nextTagIds),
  };
}

export async function deleteContactInDb(params: {
  businessId: string;
  contactId: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) {
    return { ok: false, error: 'Supabase client is not configured.' };
  }
  if (!UUID_REGEX.test(params.businessId) || !UUID_REGEX.test(params.contactId)) {
    return { ok: false, error: 'Invalid workspace or contact identifier.' };
  }

  const { data, error } = await supabase
    .from('contacts')
    .delete()
    .eq('id', params.contactId)
    .eq('business_id', params.businessId)
    .select('id');

  if (error) {
    return { ok: false, error: formatPersistenceError('contact', error) };
  }

  if (!data || data.length === 0) {
    return {
      ok: false,
      error:
        'Contact could not be deleted. Only workspace administrators can delete contacts under Row-Level Security.',
    };
  }

  return { ok: true };
}

export async function importContactsBatchInDb(params: {
  businessId: string;
  rows: Array<{
    fullName: string;
    phoneE164: string;
    email: string;
    company: string;
    city: string;
    country: string;
    marketingOptIn: boolean;
  }>;
  createdBy?: string | null;
}): Promise<{ ok: boolean; contacts: Contact[]; error?: string }> {
  if (!supabase) {
    return { ok: false, contacts: [], error: 'Supabase client is not configured.' };
  }
  if (!UUID_REGEX.test(params.businessId)) {
    return { ok: false, contacts: [], error: 'Active workspace could not be verified.' };
  }
  if (params.rows.length === 0) {
    return { ok: true, contacts: [] };
  }

  const { data: userRes, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userRes.user) {
    return { ok: false, contacts: [], error: 'Your session has expired. Sign in again and retry.' };
  }

  const knownCols = await discoverTableColumns('contacts');
  const missingCols = getMissingTableColumns('contacts');

  let payloads = params.rows.map((row) =>
    buildContactInsertPayload(
      {
        businessId: params.businessId,
        fullName: row.fullName.trim(),
        phoneE164: row.phoneE164,
        email: row.email,
        company: row.company,
        city: row.city,
        country: row.country,
        marketingOptIn: row.marketingOptIn,
        notes: 'Imported via CSV',
        createdBy: params.createdBy ?? userRes.user.id,
      },
      knownCols,
      missingCols
    )
  );

  let insertedRows: Array<Record<string, unknown>> | null = null;
  let lastError: SupabaseLikeError | null = null;

  for (let attempt = 0; attempt < 8; attempt++) {
    const { data, error } = await supabase.from('contacts').insert(payloads).select('*');

    if (!error && data) {
      insertedRows = data as Array<Record<string, unknown>>;
      seedTableColumnsFromRows('contacts', insertedRows);
      lastError = null;
      break;
    }

    lastError = error;
    const missingCol = parsePgrst204MissingColumn(error);
    if (missingCol && !CONTACT_CORE_PROTECTED_COLS.has(missingCol)) {
      recordMissingColumn('contacts', missingCol);
      payloads = payloads.map((p) => {
        const clone = { ...p };
        delete clone[missingCol];
        return clone;
      });
      continue;
    }
    break;
  }

  if (lastError || !insertedRows) {
    return {
      ok: false,
      contacts: [],
      error: formatPersistenceError('contact', lastError),
    };
  }

  return {
    ok: true,
    contacts: insertedRows.map((row) => mapDbContactRow(row, [])),
  };
}

export async function createTagInDb(params: {
  businessId: string;
  name: string;
  color: string;
}): Promise<{ ok: boolean; tag?: Tag; error?: string }> {
  if (!supabase) {
    return { ok: false, error: 'Supabase client is not configured.' };
  }
  const cleanName = params.name.trim();
  if (!cleanName) {
    return { ok: false, error: 'Tag name cannot be empty.' };
  }
  if (!UUID_REGEX.test(params.businessId)) {
    return { ok: false, error: 'Active workspace could not be verified.' };
  }

  const { data, error } = await supabase
    .from('tags')
    .insert({
      business_id: params.businessId,
      name: cleanName,
      color: params.color || '#2563EB',
    })
    .select('*')
    .single();

  if (error || !data) {
    return { ok: false, error: formatPersistenceError('tag', error) };
  }

  const row = data as Record<string, unknown>;
  return {
    ok: true,
    tag: {
      id: String(row.id),
      name: String(row.name),
      color: String(row.color ?? '#2563EB'),
    },
  };
}

export async function bulkTagContactsInDb(params: {
  contactIds: string[];
  tagId: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) {
    return { ok: false, error: 'Supabase client is not configured.' };
  }
  if (!UUID_REGEX.test(params.tagId)) {
    return { ok: false, error: 'Selected tag is not persisted in Supabase.' };
  }

  const pairs = params.contactIds
    .filter((cid) => UUID_REGEX.test(cid))
    .map((cid) => ({ contact_id: cid, tag_id: params.tagId }));

  if (pairs.length === 0) {
    return { ok: true };
  }

  const { error } = await supabase
    .from('contact_tags')
    .upsert(pairs, { onConflict: 'contact_id,tag_id' });

  if (error) {
    return { ok: false, error: formatPersistenceError('tag', error) };
  }

  return { ok: true };
}

// ============================================================================
// CAMPAIGNS — MAPPING, VALIDATION & GENUINE SUPABASE DRAFT PERSISTENCE
// ============================================================================

export function normalizeCampaignStatus(raw: unknown): CampaignStatus {
  const val = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (val === 'scheduled') return 'scheduled';
  if (val === 'running') return 'running';
  if (val === 'paused') return 'paused';
  if (val === 'completed') return 'completed';
  return 'draft';
}

export function mapDbCampaignRow(row: Record<string, unknown>): Campaign {
  const audienceFilter =
    row.audience_filter && typeof row.audience_filter === 'object' && !Array.isArray(row.audience_filter)
      ? (row.audience_filter as Record<string, unknown>)
      : null;

  const rawVars =
    row.variable_mapping && typeof row.variable_mapping === 'object' && !Array.isArray(row.variable_mapping)
      ? (row.variable_mapping as Record<string, unknown>)
      : audienceFilter?.variable_mapping &&
        typeof audienceFilter.variable_mapping === 'object' &&
        !Array.isArray(audienceFilter.variable_mapping)
      ? (audienceFilter.variable_mapping as Record<string, unknown>)
      : {};
  const variableMapping: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawVars)) {
    if (typeof v === 'string' || typeof v === 'number') {
      variableMapping[k] = String(v);
    }
  }

  const targetTagIds = Array.isArray(row.target_tag_ids)
    ? row.target_tag_ids.map(String)
    : Array.isArray(audienceFilter?.tagIds)
    ? audienceFilter.tagIds.map(String)
    : Array.isArray(audienceFilter?.tag_ids)
    ? audienceFilter.tag_ids.map(String)
    : [];
  const targetContactIds = Array.isArray(row.target_contact_ids)
    ? row.target_contact_ids.map(String)
    : Array.isArray(audienceFilter?.contactIds)
    ? audienceFilter.contactIds.map(String)
    : Array.isArray(audienceFilter?.contact_ids)
    ? audienceFilter.contact_ids.map(String)
    : undefined;

  const eligible = Number(row.eligible_count ?? row.total_recipients ?? 0);
  const selected = Number(row.selected_count ?? eligible);

  const filterMode = audienceFilter?.mode;
  const resolvedAudienceMode =
    row.audience_mode === 'all' || row.audience_mode === 'groups' || row.audience_mode === 'specific'
      ? row.audience_mode
      : filterMode === 'all' || filterMode === 'groups' || filterMode === 'specific'
      ? filterMode
      : targetTagIds.length > 0
      ? 'groups'
      : 'all';

  return {
    id: String(row.id),
    name: String(row.name ?? 'Untitled Campaign'),
    templateId: String(row.template_id ?? ''),
    status: normalizeCampaignStatus(row.status),
    audienceMode: resolvedAudienceMode,
    targetTagIds,
    targetContactIds,
    variableMapping,
    scheduledFor: row.scheduled_for
      ? String(row.scheduled_for)
      : row.scheduled_at
      ? String(row.scheduled_at)
      : undefined,
    createdAt: String(row.created_at ?? new Date().toISOString()),
    metrics: {
      selected,
      eligible,
      submitted: Number(row.submitted_count ?? 0),
      sent: Number(row.sent_count ?? 0),
      delivered: Number(row.delivered_count ?? 0),
      read: Number(row.read_count ?? 0),
      failed: Number(row.failed_count ?? 0),
      skipped: Number(row.skipped_count ?? 0),
    },
  };
}

export interface CampaignCreateInput {
  businessId: string;
  name: string;
  templateId: string;
  status: CampaignStatus;
  audienceMode?: 'all' | 'groups' | 'specific';
  targetTagIds: string[];
  targetContactIds?: string[];
  variableMapping: Record<string, string>;
  scheduledFor?: string;
  selectedCount: number;
  eligibleCount: number;
  skippedCount: number;
  createdBy?: string | null;
}

export function validateCampaignInput(input: {
  businessId?: string;
  name: string;
  templateId: string;
  scheduledFor?: string;
  status: CampaignStatus;
  requireBusinessId?: boolean;
}): { ok: boolean; cleanName?: string; scheduledIso?: string | null; error?: string } {
  const cleanName = input.name.trim();
  if (cleanName.length < 2) {
    return { ok: false, error: 'Campaign name must be at least 2 characters long.' };
  }

  if (!input.templateId || !UUID_REGEX.test(input.templateId)) {
    return {
      ok: false,
      error: 'Please select a valid synchronized WhatsApp template before saving the campaign.',
    };
  }

  if (input.requireBusinessId && (!input.businessId || !UUID_REGEX.test(input.businessId))) {
    return {
      ok: false,
      error: 'Active business workspace could not be verified. Refresh and sign in again.',
    };
  }

  let scheduledIso: string | null = null;
  if (input.status === 'scheduled' && input.scheduledFor) {
    const dt = new Date(input.scheduledFor);
    if (Number.isNaN(dt.getTime())) {
      return { ok: false, error: 'Please select a valid scheduled date and time.' };
    }
    scheduledIso = dt.toISOString();
  }

  return { ok: true, cleanName, scheduledIso };
}

// Verified live public.campaigns columns (never assume nonexistent legacy columns)
const DEFAULT_LIVE_CAMPAIGN_COLUMNS = new Set<string>([
  'business_id',
  'name',
  'template_id',
  'audience_filter',
  'status',
  'scheduled_at',
  'created_by',
]);

export function buildCampaignInsertPayload(
  input: CampaignCreateInput & { scheduledIso: string | null },
  knownCols: Set<string> | null,
  missingCols: Set<string> = new Set()
): Record<string, unknown> {
  const effectiveCols = knownCols && knownCols.size > 0 ? knownCols : DEFAULT_LIVE_CAMPAIGN_COLUMNS;
  const payload: Record<string, unknown> = {
    business_id: input.businessId,
    name: input.name.trim(),
    template_id: input.templateId,
    status: input.status,
  };

  const validTagIds = input.targetTagIds.filter((tid) => UUID_REGEX.test(tid));
  const validContactIds = (input.targetContactIds ?? []).filter((cid) => UUID_REGEX.test(cid));

  if (canWriteColumn('target_tag_ids', effectiveCols, missingCols)) {
    payload.target_tag_ids = validTagIds;
  }
  if (canWriteColumn('variable_mapping', effectiveCols, missingCols)) {
    payload.variable_mapping = input.variableMapping ?? {};
  }

  // Handle either `scheduled_at` (verified live schema) or `scheduled_for` (legacy 001 schema)
  if (effectiveCols.has('scheduled_at') && !missingCols.has('scheduled_at')) {
    payload.scheduled_at = input.scheduledIso;
  } else if (canWriteColumn('scheduled_for', effectiveCols, missingCols)) {
    payload.scheduled_for = input.scheduledIso;
  }

  if (canWriteColumn('selected_count', effectiveCols, missingCols)) {
    payload.selected_count = Math.max(0, Math.floor(input.selectedCount));
  }
  if (canWriteColumn('eligible_count', effectiveCols, missingCols)) {
    payload.eligible_count = Math.max(0, Math.floor(input.eligibleCount));
  }
  if (canWriteColumn('total_recipients', effectiveCols, missingCols, true)) {
    payload.total_recipients = Math.max(0, Math.floor(input.eligibleCount));
  }
  if (canWriteColumn('submitted_count', effectiveCols, missingCols)) {
    payload.submitted_count = 0;
  }
  if (canWriteColumn('sent_count', effectiveCols, missingCols)) {
    payload.sent_count = 0;
  }
  if (canWriteColumn('delivered_count', effectiveCols, missingCols)) {
    payload.delivered_count = 0;
  }
  if (canWriteColumn('read_count', effectiveCols, missingCols)) {
    payload.read_count = 0;
  }
  if (canWriteColumn('failed_count', effectiveCols, missingCols)) {
    payload.failed_count = 0;
  }
  if (canWriteColumn('skipped_count', effectiveCols, missingCols)) {
    payload.skipped_count = Math.max(0, Math.floor(input.skippedCount));
  }

  // Store audience_filter JSONB (including variable_mapping) in the exact format campaign-preflight expects
  if (canWriteColumn('audience_filter', effectiveCols, missingCols, true)) {
    const cleanVarMap: Record<string, string> = {};
    for (const [k, v] of Object.entries(input.variableMapping ?? {})) {
      if (typeof v === 'string' && v.trim().length > 0) {
        cleanVarMap[k] = v.trim();
      }
    }
    payload.audience_filter = {
      mode: input.audienceMode ?? (validTagIds.length > 0 ? 'groups' : 'all'),
      tag_ids: validTagIds,
      contact_ids: validContactIds,
      ...(Object.keys(cleanVarMap).length > 0 ? { variable_mapping: cleanVarMap } : {}),
    };
  }
  if (input.audienceMode && canWriteColumn('audience_mode', effectiveCols, missingCols, true)) {
    payload.audience_mode = input.audienceMode;
  }
  if (validContactIds.length > 0 && canWriteColumn('target_contact_ids', effectiveCols, missingCols, true)) {
    payload.target_contact_ids = validContactIds;
  }
  if (
    input.createdBy &&
    UUID_REGEX.test(input.createdBy) &&
    canWriteColumn('created_by', effectiveCols, missingCols, true)
  ) {
    payload.created_by = input.createdBy;
  }

  return payload;
}

const CAMPAIGN_CORE_PROTECTED_COLS = new Set(['business_id', 'name', 'template_id', 'status']);

/**
 * Persists a real campaign draft/record into public.campaigns.
 * NEVER triggers WhatsApp message delivery.
 */
export async function createCampaignInDb(
  input: CampaignCreateInput
): Promise<{ ok: boolean; campaign?: Campaign; error?: string }> {
  if (!supabase) {
    return { ok: false, error: 'Supabase client is not configured.' };
  }

  const validation = validateCampaignInput({
    businessId: input.businessId,
    name: input.name,
    templateId: input.templateId,
    scheduledFor: input.scheduledFor,
    status: input.status,
    requireBusinessId: true,
  });

  if (!validation.ok || !validation.cleanName) {
    return { ok: false, error: validation.error || 'Invalid campaign details.' };
  }

  const { data: userRes, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userRes.user) {
    return { ok: false, error: 'Your session has expired. Sign in again and retry.' };
  }

  const knownCols = await discoverTableColumns('campaigns');
  const payload = buildCampaignInsertPayload(
    {
      ...input,
      name: validation.cleanName,
      scheduledIso: validation.scheduledIso ?? null,
      createdBy: input.createdBy ?? userRes.user.id,
    },
    knownCols,
    getMissingTableColumns('campaigns')
  );

  let insertedRow: Record<string, unknown> | null = null;
  let lastError: SupabaseLikeError | null = null;

  for (let attempt = 0; attempt < 12; attempt++) {
    const { data, error } = await supabase
      .from('campaigns')
      .insert(payload)
      .select('*')
      .single();

    if (!error && data) {
      insertedRow = data as Record<string, unknown>;
      seedTableColumnsFromRows('campaigns', [insertedRow]);
      lastError = null;
      break;
    }

    lastError = error;
    const missingCol = parsePgrst204MissingColumn(error);
    if (
      missingCol &&
      missingCol in payload &&
      !CAMPAIGN_CORE_PROTECTED_COLS.has(missingCol)
    ) {
      recordMissingColumn('campaigns', missingCol);
      delete payload[missingCol];
      continue;
    }

    // Handle rare uppercase status check constraint if present
    if (
      error?.code === '23514' &&
      /status/i.test(error.message ?? '') &&
      typeof payload.status === 'string' &&
      payload.status === payload.status.toLowerCase()
    ) {
      payload.status = payload.status.toUpperCase();
      continue;
    }

    break;
  }

  if (lastError || !insertedRow) {
    return {
      ok: false,
      error: formatPersistenceError('campaign', lastError),
    };
  }

  const persistedId = String(insertedRow.id ?? '');
  if (!UUID_REGEX.test(persistedId)) {
    return {
      ok: false,
      error: 'Campaign insert did not return a valid persisted campaign ID from Supabase.',
    };
  }

  // Re-fetch persisted campaign from Supabase to verify read-back & persistence across refresh
  const { data: verifiedRow, error: verifyErr } = await supabase
    .from('campaigns')
    .select('*')
    .eq('id', persistedId)
    .eq('business_id', input.businessId)
    .single();

  if (verifyErr || !verifiedRow || String((verifiedRow as Record<string, unknown>).id ?? '') !== persistedId) {
    return {
      ok: false,
      error: verifyErr
        ? `Campaign draft was written but could not be read back from Supabase: ${formatPersistenceError('campaign', verifyErr)}`
        : 'Campaign draft could not be verified in Supabase after saving.',
    };
  }

  const mapped = mapDbCampaignRow(verifiedRow as Record<string, unknown>);
  // Preserve client audience counts/metadata cleanly if the live table lacks count columns
  return {
    ok: true,
    campaign: {
      ...mapped,
      audienceMode: input.audienceMode ?? mapped.audienceMode,
      targetContactIds: input.targetContactIds ?? mapped.targetContactIds,
      metrics: {
        ...mapped.metrics,
        selected: mapped.metrics.selected || input.selectedCount,
        eligible: mapped.metrics.eligible || input.eligibleCount,
        skipped: mapped.metrics.skipped || input.skippedCount,
      },
    },
  };
}

/**
 * Updates an existing persisted campaign draft in public.campaigns with awaited read-back verification.
 * NEVER creates phantom rows or triggers WhatsApp message delivery.
 */
export async function updateCampaignInDb(
  input: CampaignCreateInput & { campaignId: string }
): Promise<{ ok: boolean; campaign?: Campaign; error?: string }> {
  if (!supabase) {
    return { ok: false, error: 'Supabase client is not configured.' };
  }
  if (!UUID_REGEX.test(input.campaignId)) {
    return { ok: false, error: 'Invalid campaign ID for update.' };
  }

  const validation = validateCampaignInput({
    businessId: input.businessId,
    name: input.name,
    templateId: input.templateId,
    scheduledFor: input.scheduledFor,
    status: input.status,
    requireBusinessId: true,
  });

  if (!validation.ok || !validation.cleanName) {
    return { ok: false, error: validation.error || 'Invalid campaign details.' };
  }

  const { data: userRes, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userRes.user) {
    return { ok: false, error: 'Your session has expired. Sign in again and retry.' };
  }

  const knownCols = await discoverTableColumns('campaigns');
  const payload = buildCampaignInsertPayload(
    {
      ...input,
      name: validation.cleanName,
      scheduledIso: validation.scheduledIso ?? null,
      createdBy: undefined,
    },
    knownCols,
    getMissingTableColumns('campaigns')
  );
  delete payload.business_id;
  delete payload.created_by;

  let updatedRow: Record<string, unknown> | null = null;
  let lastError: SupabaseLikeError | null = null;

  for (let attempt = 0; attempt < 12; attempt++) {
    const { data, error } = await supabase
      .from('campaigns')
      .update(payload)
      .eq('id', input.campaignId)
      .eq('business_id', input.businessId)
      .select('*')
      .single();

    if (!error && data) {
      updatedRow = data as Record<string, unknown>;
      seedTableColumnsFromRows('campaigns', [updatedRow]);
      lastError = null;
      break;
    }

    lastError = error;
    const missingCol = parsePgrst204MissingColumn(error);
    if (
      missingCol &&
      missingCol in payload &&
      !CAMPAIGN_CORE_PROTECTED_COLS.has(missingCol)
    ) {
      recordMissingColumn('campaigns', missingCol);
      delete payload[missingCol];
      continue;
    }

    break;
  }

  if (lastError || !updatedRow) {
    return {
      ok: false,
      error: formatPersistenceError('campaign', lastError),
    };
  }

  const persistedId = String(updatedRow.id ?? '');
  if (persistedId !== input.campaignId) {
    return {
      ok: false,
      error: 'Campaign update did not return the expected persisted campaign ID from Supabase.',
    };
  }

  // Re-fetch persisted campaign from Supabase to verify durable read-back
  const { data: verifiedRow, error: verifyErr } = await supabase
    .from('campaigns')
    .select('*')
    .eq('id', persistedId)
    .eq('business_id', input.businessId)
    .single();

  if (verifyErr || !verifiedRow || String((verifiedRow as Record<string, unknown>).id ?? '') !== persistedId) {
    return {
      ok: false,
      error: verifyErr
        ? `Campaign update could not be verified on read-back: ${formatPersistenceError('campaign', verifyErr)}`
        : 'Campaign update could not be verified in Supabase after saving.',
    };
  }

  const mapped = mapDbCampaignRow(verifiedRow as Record<string, unknown>);
  return {
    ok: true,
    campaign: {
      ...mapped,
      audienceMode: input.audienceMode ?? mapped.audienceMode,
      targetContactIds: input.targetContactIds ?? mapped.targetContactIds,
      metrics: {
        ...mapped.metrics,
        selected: mapped.metrics.selected || input.selectedCount,
        eligible: mapped.metrics.eligible || input.eligibleCount,
        skipped: mapped.metrics.skipped || input.skippedCount,
      },
    },
  };
}

export async function updateCampaignStatusInDb(params: {
  businessId: string;
  campaignId: string;
  status: CampaignStatus;
}): Promise<{ ok: boolean; campaign?: Campaign; error?: string }> {
  if (!supabase) {
    return { ok: false, error: 'Supabase client is not configured.' };
  }
  if (!UUID_REGEX.test(params.businessId) || !UUID_REGEX.test(params.campaignId)) {
    return { ok: false, error: 'Invalid workspace or campaign identifier.' };
  }

  const { data, error } = await supabase
    .from('campaigns')
    .update({ status: params.status })
    .eq('id', params.campaignId)
    .eq('business_id', params.businessId)
    .select('*')
    .single();

  if (error || !data) {
    return { ok: false, error: formatPersistenceError('campaign', error) };
  }

  return {
    ok: true,
    campaign: mapDbCampaignRow(data as Record<string, unknown>),
  };
}
