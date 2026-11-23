import { supabase } from '@/lib/supabase';
import { normalizePhoneE164 } from '@/lib/phone';
import { coerceComponentsArray, findTemplateComponent } from '@/lib/templates';
import type { TemplateComponent } from '@/types/crm';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const E164_STRICT_REGEX = /^\+[1-9][0-9]{6,14}$/;
const OPTED_OUT_STATUSES = new Set(['opted_out', 'unsubscribed', 'revoked', 'blocked', 'do_not_contact']);
const OPTED_IN_STATUSES = new Set(['opted_in', 'subscribed', 'consented']);

const CONTACT_PAGE_SIZE = 1000;
const IN_BATCH_SIZE = 250;
const MAX_AUDIENCE_ROWS = 25000;

export type CampaignAudienceMode = 'all' | 'groups' | 'specific';

export type CampaignExclusionReason =
  | 'contact_not_in_business'
  | 'invalid_phone'
  | 'duplicate_phone'
  | 'opted_out'
  | 'no_explicit_consent';

export interface CampaignAudienceFilterInput {
  mode: CampaignAudienceMode;
  tagIds?: string[];
  contactIds?: string[];
}

export interface CampaignRecipientCandidate {
  contactId: string;
  fullName: string;
  phoneE164: string;
  marketingOptIn: boolean;
  optInStatus?: string | null;
  optedOutAt?: string | null;
}

export interface CampaignExcludedRecipient {
  contactId: string | null;
  fullName: string;
  rawPhone: string;
  normalizedPhone: string | null;
  reason: CampaignExclusionReason;
  detail: string;
}

export interface CampaignAudienceValidationResult {
  ok: boolean;
  mode: CampaignAudienceMode;
  totalMatched: number;
  eligibleCount: number;
  excludedCount: number;
  eligibleRecipients: CampaignRecipientCandidate[];
  excludedRecipients: CampaignExcludedRecipient[];
  groupedExclusions: Record<CampaignExclusionReason, number>;
  invalidTagIds: string[];
  invalidContactIds: string[];
  validatedAt: string;
  source: 'supabase_db' | 'edge_function';
  errorCode?: string;
  error?: string;
}

export type GuardianCheckStatus = 'pass' | 'warn' | 'fail';

export interface GuardianCheckItem {
  code: string;
  label: string;
  status: GuardianCheckStatus;
  message: string;
}

export interface TemplateParameterValidation {
  ok: boolean;
  supported: boolean;
  requiredBodyVariables: string[];
  requiredHeaderVariables: string[];
  missingVariables: string[];
  unsupportedReasons: string[];
}

export type Phase1PreflightScheduleMode = 'draft' | 'scheduled';

export interface CampaignGuardianPreflightInput {
  businessId: string;
  campaignId?: string | null;
  templateId: string;
  audienceFilter: CampaignAudienceFilterInput;
  variableMapping?: Record<string, string>;
  scheduleMode?: 'draft' | 'immediate' | 'scheduled';
  scheduledAt?: string | null;
}

/**
 * Normalizes UI schedule selection into the exact Phase 1 `campaign-preflight` Edge Function contract:
 * - UI `'immediate'` (and `'draft'` / omitted) -> `{ scheduleMode: 'draft', scheduledAt: undefined }`
 * - UI `'scheduled'` -> `{ scheduleMode: 'scheduled', scheduledAt: <valid ISO 8601 string or undefined> }`
 */
export function normalizePhase1PreflightSchedule(
  uiScheduleMode?: 'draft' | 'immediate' | 'scheduled',
  scheduledAt?: string | null
): { scheduleMode: Phase1PreflightScheduleMode; scheduledAt?: string } {
  if (uiScheduleMode === 'scheduled') {
    const raw = typeof scheduledAt === 'string' ? scheduledAt.trim() : '';
    if (raw) {
      const dt = new Date(raw);
      if (!Number.isNaN(dt.getTime())) {
        return { scheduleMode: 'scheduled', scheduledAt: dt.toISOString() };
      }
    }
    return { scheduleMode: 'scheduled', scheduledAt: undefined };
  }
  return { scheduleMode: 'draft', scheduledAt: undefined };
}

export interface CampaignGuardianReport {
  ok: boolean;
  serverVerified: boolean;
  migrationReady: boolean;
  migrationPending: boolean;
  canSaveDraft: boolean;
  canLaunchBulk: boolean;
  phase1DispatchBlocked: boolean;
  messagingMode: 'test' | 'live';
  whatsappConnected: boolean;
  whatsappAccountId: string | null;
  testAllowlistCount: number;
  eligibleInTestAllowlist: number;
  eligibleOutsideTestAllowlist: number;
  checks: GuardianCheckItem[];
  blockingReasons: string[];
  warnings: string[];
  templateSummary: {
    id: string;
    name: string;
    language: string;
    category: string;
    status: string;
    metaTemplateId: string | null;
    requiredVariables: string[];
  } | null;
  audience: CampaignAudienceValidationResult;
  validatedAt: string;
  source: 'supabase_db' | 'edge_function';
  httpStatus?: number;
  errorCode?: string;
  error?: string;
}

export interface CampaignSnapshotRequest {
  businessId: string;
  campaignId: string;
  idempotencyKey: string;
}

export interface CampaignSnapshotResult {
  ok: boolean;
  replayed?: boolean;
  runId?: string;
  runNumber?: number;
  status?: string;
  eligibleCount?: number;
  excludedCount?: number;
  httpStatus?: number;
  code?: string;
  error?: string;
  migrationPending?: boolean;
  guardian?: CampaignGuardianReport;
}

export interface ParsedEdgeError {
  httpStatus?: number;
  code: string;
  message: string;
  body: Record<string, unknown> | null;
  migrationPending: boolean;
}

export function createEmptyGroupedExclusions(): Record<CampaignExclusionReason, number> {
  return {
    contact_not_in_business: 0,
    invalid_phone: 0,
    duplicate_phone: 0,
    opted_out: 0,
    no_explicit_consent: 0,
  };
}

export const EXCLUSION_REASON_LABELS: Record<CampaignExclusionReason, string> = {
  opted_out: 'Explicitly opted out',
  no_explicit_consent: 'No explicit marketing consent',
  invalid_phone: 'Invalid E.164 WhatsApp number',
  duplicate_phone: 'Duplicate phone number',
  contact_not_in_business: 'Contact not in active workspace',
};

function isMissingSchemaDbError(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  const code = String(err.code ?? '');
  const msg = String(err.message ?? '').toLowerCase();
  return (
    code === '42P01' ||
    code === '42883' ||
    code === 'PGRST202' ||
    code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('could not find the function') ||
    msg.includes('could not find the table')
  );
}

function isColumnMismatchDbError(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  const code = String(err.code ?? '');
  const msg = String(err.message ?? '').toLowerCase();
  return code === '42703' || code === 'PGRST204' || msg.includes('schema cache');
}

function extractWhatsAppPhoneId(wa: Record<string, unknown> | null): string {
  if (!wa) return '';
  const candidates = [
    wa.meta_phone_number_id,
    wa.phone_number_id,
    wa.whatsapp_phone_number_id,
    wa.meta_phone_id,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim().length > 0) return c.trim();
    if (typeof c === 'number' && Number.isFinite(c)) return String(c);
  }
  return '';
}

function extractWhatsAppDisplayPhone(wa: Record<string, unknown> | null): string {
  if (!wa) return '';
  const candidates = [wa.phone_number_e164, wa.display_phone_number, wa.phone_number];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim().length > 0) return c.trim();
  }
  return extractWhatsAppPhoneId(wa);
}

/**
 * Extracts structured HTTP status, JSON body, and public error code from Supabase
 * FunctionsHttpError / FunctionsFetchError / Response context objects.
 */
export async function parseEdgeFunctionError(error: unknown): Promise<ParsedEdgeError> {
  const errObj = (error && typeof error === 'object' ? error : {}) as Record<string, unknown>;
  const ctx = errObj.context as
    | (Response & { status?: number; json?: () => Promise<unknown>; text?: () => Promise<string>; clone?: () => Response })
    | Record<string, unknown>
    | undefined;

  let httpStatus: number | undefined;
  if (ctx && typeof ctx === 'object' && typeof ctx.status === 'number') {
    httpStatus = ctx.status;
  } else if (typeof errObj.status === 'number') {
    httpStatus = errObj.status;
  }

  let body: Record<string, unknown> | null = null;
  let rawText = '';

  if (ctx && typeof ctx === 'object') {
    try {
      const target = typeof ctx.clone === 'function' ? ctx.clone() : ctx;
      if (typeof (target as Response).json === 'function') {
        const parsed = await (target as Response).json();
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          body = parsed as Record<string, unknown>;
        }
      }
    } catch {
      try {
        if (typeof (ctx as Response).text === 'function') {
          rawText = await (ctx as Response).text();
          if (rawText.trim().startsWith('{')) {
            const parsed = JSON.parse(rawText);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
              body = parsed as Record<string, unknown>;
            }
          }
        }
      } catch {
        // ignore unreadable response body
      }
    }
  }

  const fallbackMsg = String(errObj.message ?? '').trim();
  const bodyCode = body?.code ? String(body.code).trim() : '';
  const bodyErr = body?.error
    ? String(body.error).trim()
    : body?.message
    ? String(body.message).trim()
    : '';
  const combinedText = `${bodyCode} ${bodyErr} ${rawText} ${fallbackMsg}`.toLowerCase();

  const looksLikeMigrationPending =
    bodyCode === 'MIGRATION_NOT_APPLIED' ||
    bodyCode === 'PGRST202' ||
    bodyCode === 'PGRST205' ||
    combinedText.includes('migration_not_applied') ||
    combinedText.includes('pgrst202') ||
    combinedText.includes('pgrst205') ||
    combinedText.includes('create_campaign_run_snapshot') ||
    combinedText.includes('campaign_runs') && combinedText.includes('does not exist') ||
    combinedText.includes('42p01') ||
    combinedText.includes('42883');

  const looksLikeSchemaMismatch =
    bodyCode === 'SCHEMA_MISMATCH' ||
    bodyCode === 'PGRST204' ||
    combinedText.includes('pgrst204') ||
    combinedText.includes('schema cache') ||
    combinedText.includes('42703');

  const looksLikeCorsOrNetwork =
    errObj.name === 'FunctionsFetchError' ||
    combinedText.includes('failed to send a request to the edge function') ||
    combinedText.includes('failed to fetch') ||
    combinedText.includes('networkerror') ||
    combinedText.includes('cors');

  let code = bodyCode;
  if (!code) {
    if (looksLikeMigrationPending) code = 'MIGRATION_NOT_APPLIED';
    else if (looksLikeSchemaMismatch) code = 'PGRST204';
    else if (httpStatus === 401) code = 'UNAUTHENTICATED';
    else if (httpStatus === 403) code = 'ADMIN_REQUIRED';
    else if (httpStatus === 422) code = 'PREFLIGHT_FAILED';
    else if (httpStatus === 404 || looksLikeCorsOrNetwork) code = 'EDGE_FUNCTION_UNAVAILABLE';
    else if (httpStatus && httpStatus >= 500) code = 'EDGE_SERVER_ERROR';
    else code = 'EDGE_INVOKE_FAILED';
  }

  let message = bodyErr;
  if (!message) {
    if (code === 'UNAUTHENTICATED' || httpStatus === 401) {
      message = 'Your session token has expired or is invalid (HTTP 401). Sign in again and retry.';
    } else if (code === 'ADMIN_REQUIRED' || httpStatus === 403) {
      message =
        'Active workspace administrator permission is required to validate campaigns or create snapshots (HTTP 403).';
    } else if (code === 'MIGRATION_NOT_APPLIED' || looksLikeMigrationPending) {
      message =
        'Phase 1 Campaign Engine SQL installation is still pending in Supabase (missing campaign_runs or snapshot RPC). Apply the reviewed Phase 1 SQL first.';
    } else if (code === 'PGRST204' || code === 'SCHEMA_MISMATCH') {
      message =
        'A database column schema mismatch (PGRST204) occurred while validating campaign data.';
    } else if (code === 'EDGE_FUNCTION_UNAVAILABLE') {
      message =
        'The `campaign-preflight` Edge Function is unreachable (not deployed or CORS preflight failed). Deploy `campaign-preflight` in Supabase Dashboard before server-verified validation.';
    } else if (code === 'PREFLIGHT_FAILED' || httpStatus === 422) {
      message = 'Campaign preflight validation failed (HTTP 422). Fix blocking checks before continuing.';
    } else {
      message = fallbackMsg || `campaign-preflight request failed${httpStatus ? ` (HTTP ${httpStatus})` : ''}.`;
    }
  }

  return {
    httpStatus,
    code,
    message,
    body,
    migrationPending: looksLikeMigrationPending,
  };
}

/**
 * Evaluates explicit contact consent strictly.
 * Merely saving a phone number NEVER proves consent.
 */
export function evaluateContactConsent(row: {
  marketing_opt_in?: unknown;
  opt_in_status?: unknown;
  opted_out_at?: unknown;
}): { eligible: true } | { eligible: false; reason: 'opted_out' | 'no_explicit_consent'; detail: string } {
  const optedOutAt =
    row.opted_out_at !== undefined && row.opted_out_at !== null && String(row.opted_out_at).trim() !== ''
      ? String(row.opted_out_at).trim()
      : null;

  if (optedOutAt) {
    return {
      eligible: false,
      reason: 'opted_out',
      detail: `Contact opted out on ${optedOutAt}.`,
    };
  }

  const rawStatus =
    typeof row.opt_in_status === 'string' ? row.opt_in_status.trim().toLowerCase() : '';

  if (rawStatus && OPTED_OUT_STATUSES.has(rawStatus)) {
    return {
      eligible: false,
      reason: 'opted_out',
      detail: `Contact opt_in_status is "${rawStatus}".`,
    };
  }

  if (typeof row.marketing_opt_in === 'boolean') {
    if (!row.marketing_opt_in) {
      return {
        eligible: false,
        reason: 'no_explicit_consent',
        detail: 'Contact does not have explicit marketing opt-in consent.',
      };
    }
    return { eligible: true };
  }

  if (rawStatus && OPTED_IN_STATUSES.has(rawStatus)) {
    return { eligible: true };
  }

  return {
    eligible: false,
    reason: 'no_explicit_consent',
    detail: 'No verified opt-in consent record found for this contact.',
  };
}

/**
 * Pure deterministic audience evaluator operating on real database contact rows.
 * Enforces E.164 phone validity, normalized phone deduplication, consent & opt-out rules.
 */
export function evaluateAudienceRows(params: {
  mode: CampaignAudienceMode;
  matchedContacts: Array<Record<string, unknown>>;
  missingContactIds?: string[];
  invalidTagIds?: string[];
  source?: 'supabase_db' | 'edge_function';
}): CampaignAudienceValidationResult {
  const groupedExclusions = createEmptyGroupedExclusions();
  const eligibleRecipients: CampaignRecipientCandidate[] = [];
  const excludedRecipients: CampaignExcludedRecipient[] = [];
  const seenNormalizedPhones = new Set<string>();
  const invalidContactIds = [...(params.missingContactIds ?? [])];
  const invalidTagIds = [...(params.invalidTagIds ?? [])];

  for (const missingId of invalidContactIds) {
    groupedExclusions.contact_not_in_business += 1;
    excludedRecipients.push({
      contactId: missingId,
      fullName: 'Unknown / Outside Workspace',
      rawPhone: '',
      normalizedPhone: null,
      reason: 'contact_not_in_business',
      detail: 'Selected contact does not exist in this active business workspace.',
    });
  }

  const ordered = [...params.matchedContacts].sort((a, b) => {
    const aTime = String(a.created_at ?? '');
    const bTime = String(b.created_at ?? '');
    if (aTime !== bTime) return aTime.localeCompare(bTime);
    return String(a.id ?? '').localeCompare(String(b.id ?? ''));
  });

  for (const row of ordered) {
    const contactId = String(row.id ?? '');
    const fullName = String(row.full_name ?? row.name ?? 'Unnamed Contact').trim() || 'Unnamed Contact';
    const rawPhone = String(row.phone_e164 ?? row.phone ?? '').trim();

    const normalized = normalizePhoneE164(rawPhone);
    if (!normalized || !E164_STRICT_REGEX.test(normalized)) {
      groupedExclusions.invalid_phone += 1;
      excludedRecipients.push({
        contactId: contactId || null,
        fullName,
        rawPhone,
        normalizedPhone: null,
        reason: 'invalid_phone',
        detail: rawPhone
          ? `Phone "${rawPhone}" is not a valid international E.164 number.`
          : 'Contact has no WhatsApp phone number.',
      });
      continue;
    }

    const consent = evaluateContactConsent(row);
    if (!consent.eligible) {
      groupedExclusions[consent.reason] += 1;
      excludedRecipients.push({
        contactId: contactId || null,
        fullName,
        rawPhone,
        normalizedPhone: normalized,
        reason: consent.reason,
        detail: consent.detail,
      });
      continue;
    }

    if (seenNormalizedPhones.has(normalized)) {
      groupedExclusions.duplicate_phone += 1;
      excludedRecipients.push({
        contactId: contactId || null,
        fullName,
        rawPhone,
        normalizedPhone: normalized,
        reason: 'duplicate_phone',
        detail: `Duplicate normalized WhatsApp number (${normalized}) already included in this audience.`,
      });
      continue;
    }

    seenNormalizedPhones.add(normalized);
    eligibleRecipients.push({
      contactId,
      fullName,
      phoneE164: normalized,
      marketingOptIn: true,
      optInStatus: typeof row.opt_in_status === 'string' ? row.opt_in_status : null,
      optedOutAt: row.opted_out_at ? String(row.opted_out_at) : null,
    });
  }

  return {
    ok: true,
    mode: params.mode,
    totalMatched: ordered.length + invalidContactIds.length,
    eligibleCount: eligibleRecipients.length,
    excludedCount: excludedRecipients.length,
    eligibleRecipients,
    excludedRecipients,
    groupedExclusions,
    invalidTagIds,
    invalidContactIds,
    validatedAt: new Date().toISOString(),
    source: params.source ?? 'supabase_db',
  };
}

/**
 * Validates template components JSONB and checks required positional placeholders against variableMapping.
 */
export function validateTemplateComponentsForCampaign(
  rawComponents: unknown,
  variableMapping: Record<string, string> = {}
): TemplateParameterValidation {
  const components: TemplateComponent[] = coerceComponentsArray(rawComponents);
  const headerComp = findTemplateComponent(components, 'HEADER');
  const bodyComp = findTemplateComponent(components, 'BODY');

  const unsupportedReasons: string[] = [];
  const requiredHeaderVariables: string[] = [];
  const requiredBodyVariables: string[] = [];
  const missingVariables: string[] = [];

  if (!bodyComp || typeof bodyComp.text !== 'string' || !bodyComp.text.trim()) {
    unsupportedReasons.push('Template is missing a valid BODY component text in components JSONB.');
  }

  if (headerComp) {
    const fmt = String(headerComp.format ?? (headerComp.text ? 'TEXT' : 'NONE'))
      .trim()
      .toUpperCase();
    if (fmt === 'IMAGE' || fmt === 'VIDEO' || fmt === 'DOCUMENT' || fmt === 'LOCATION') {
      unsupportedReasons.push(
        `Template uses a ${fmt} header, which is not yet supported for Phase 1 campaign parameters.`
      );
    } else if (fmt === 'TEXT' && typeof headerComp.text === 'string') {
      const headerMatches = headerComp.text.match(/\{\{([^}]+)\}\}/g) ?? [];
      for (const m of headerMatches) {
        const token = m.slice(2, -2).trim();
        if (!/^\d+$/.test(token)) {
          unsupportedReasons.push(`Unsupported named header variable "{{${token}}}".`);
        } else if (!requiredHeaderVariables.includes(token)) {
          requiredHeaderVariables.push(token);
        }
      }
      if (requiredHeaderVariables.length > 0) {
        unsupportedReasons.push(
          'Dynamic HEADER text variables are not yet supported in Campaign Engine Phase 1.'
        );
      }
    }
  }

  if (bodyComp && typeof bodyComp.text === 'string') {
    const bodyMatches = bodyComp.text.match(/\{\{([^}]+)\}\}/g) ?? [];
    for (const m of bodyMatches) {
      const token = m.slice(2, -2).trim();
      if (!/^\d+$/.test(token)) {
        unsupportedReasons.push(
          `Unsupported named body parameter "{{${token}}}". Only sequential numeric parameters ({{1}}, {{2}}, ...) are supported.`
        );
      } else if (!requiredBodyVariables.includes(token)) {
        requiredBodyVariables.push(token);
      }
    }
    requiredBodyVariables.sort((a, b) => Number(a) - Number(b));

    for (const varKey of requiredBodyVariables) {
      const val = variableMapping[varKey];
      if (typeof val !== 'string' || val.trim().length === 0) {
        missingVariables.push(varKey);
      }
    }
  }

  return {
    ok: unsupportedReasons.length === 0 && missingVariables.length === 0,
    supported: unsupportedReasons.length === 0,
    requiredBodyVariables,
    requiredHeaderVariables,
    missingVariables,
    unsupportedReasons,
  };
}

/**
 * Verifies live Supabase Auth session and active administrator membership
 * using verified `business_members.is_active === true` and `role === 'admin'`.
 */
export async function verifyActiveBusinessAdmin(
  businessId: string
): Promise<
  | { ok: true; userId: string; businessId: string }
  | { ok: false; code: string; error: string }
> {
  if (!supabase) {
    return { ok: false, code: 'SUPABASE_NOT_CONFIGURED', error: 'Supabase client is not configured.' };
  }
  if (!UUID_REGEX.test(businessId)) {
    return {
      ok: false,
      code: 'INVALID_BUSINESS_ID',
      error: 'Active business workspace ID could not be verified.',
    };
  }

  const { data: userRes, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userRes.user) {
    return {
      ok: false,
      code: 'UNAUTHENTICATED',
      error: 'Your session has expired. Sign in again to validate campaigns.',
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
      error: `Could not verify workspace membership: ${memberErr.message}`,
    };
  }

  const row = (memberRow as Record<string, unknown> | null) ?? null;
  if (!row || row.is_active !== true) {
    return {
      ok: false,
      code: 'INACTIVE_MEMBER',
      error: 'Your workspace membership is not active.',
    };
  }

  if (String(row.role ?? '') !== 'admin') {
    return {
      ok: false,
      code: 'ADMIN_REQUIRED',
      error: 'Only active workspace administrators can validate or manage campaigns.',
    };
  }

  return { ok: true, userId: userRes.user.id, businessId };
}

async function fetchPaginatedContactsForBusiness(businessId: string): Promise<
  | { ok: true; rows: Array<Record<string, unknown>> }
  | { ok: false; code: string; error: string }
> {
  if (!supabase) {
    return { ok: false, code: 'SUPABASE_NOT_CONFIGURED', error: 'Supabase client is not configured.' };
  }

  const rows: Array<Record<string, unknown>> = [];
  let offset = 0;

  while (true) {
    const query = supabase
      .from('contacts')
      .select('id, business_id, full_name, phone_e164, marketing_opt_in, opt_in_status, opted_out_at, created_at')
      .eq('business_id', businessId);

    const orderedQuery =
      typeof (query as unknown as Record<string, unknown>).order === 'function' &&
      typeof (query as unknown as Record<string, unknown>).range === 'function'
        ? query
            .order('created_at', { ascending: true })
            .order('id', { ascending: true })
            .range(offset, offset + CONTACT_PAGE_SIZE - 1)
        : query;

    const { data, error } = await orderedQuery;

    if (error) {
      if (isMissingSchemaDbError(error)) {
        return { ok: false, code: 'MIGRATION_NOT_APPLIED', error: `Contacts table unavailable: ${error.message}` };
      }
      if (isColumnMismatchDbError(error)) {
        return { ok: false, code: 'PGRST204', error: `Contacts schema mismatch: ${error.message}` };
      }
      return { ok: false, code: 'AUDIENCE_QUERY_FAILED', error: `Could not load workspace contacts: ${error.message}` };
    }

    const batch = (data ?? []) as Array<Record<string, unknown>>;
    rows.push(...batch);

    if (rows.length > MAX_AUDIENCE_ROWS) {
      return {
        ok: false,
        code: 'AUDIENCE_LIMIT_EXCEEDED',
        error: `Workspace exceeds the ${MAX_AUDIENCE_ROWS.toLocaleString()}-contact Phase 1 validation cap. Narrow your audience by tags.`,
      };
    }

    if (batch.length < CONTACT_PAGE_SIZE) {
      break;
    }
    offset += CONTACT_PAGE_SIZE;
  }

  return { ok: true, rows };
}

async function fetchContactsByIdsBatched(businessId: string, contactIds: string[]): Promise<
  | { ok: true; rows: Array<Record<string, unknown>> }
  | { ok: false; code: string; error: string }
> {
  if (!supabase) {
    return { ok: false, code: 'SUPABASE_NOT_CONFIGURED', error: 'Supabase client is not configured.' };
  }
  if (contactIds.length > MAX_AUDIENCE_ROWS) {
    return {
      ok: false,
      code: 'AUDIENCE_LIMIT_EXCEEDED',
      error: `Selected audience exceeds the ${MAX_AUDIENCE_ROWS.toLocaleString()}-contact Phase 1 limit.`,
    };
  }

  const rows: Array<Record<string, unknown>> = [];
  for (let i = 0; i < contactIds.length; i += IN_BATCH_SIZE) {
    const chunk = contactIds.slice(i, i + IN_BATCH_SIZE);
    const { data, error } = await supabase
      .from('contacts')
      .select('id, business_id, full_name, phone_e164, marketing_opt_in, opt_in_status, opted_out_at, created_at')
      .eq('business_id', businessId)
      .in('id', chunk);

    if (error) {
      if (isMissingSchemaDbError(error)) {
        return { ok: false, code: 'MIGRATION_NOT_APPLIED', error: `Contacts table unavailable: ${error.message}` };
      }
      if (isColumnMismatchDbError(error)) {
        return { ok: false, code: 'PGRST204', error: `Contacts schema mismatch: ${error.message}` };
      }
      return { ok: false, code: 'AUDIENCE_QUERY_FAILED', error: `Could not load contacts from Supabase: ${error.message}` };
    }

    rows.push(...((data ?? []) as Array<Record<string, unknown>>));
  }

  return { ok: true, rows };
}

async function fetchPaginatedTagContactIds(tagIds: string[]): Promise<
  | { ok: true; contactIds: string[] }
  | { ok: false; code: string; error: string }
> {
  if (!supabase) {
    return { ok: false, code: 'SUPABASE_NOT_CONFIGURED', error: 'Supabase client is not configured.' };
  }

  const idSet = new Set<string>();
  let offset = 0;

  while (true) {
    const query = supabase
      .from('contact_tags')
      .select('contact_id, tag_id')
      .in('tag_id', tagIds);

    const pagedQuery =
      typeof (query as unknown as Record<string, unknown>).order === 'function' &&
      typeof (query as unknown as Record<string, unknown>).range === 'function'
        ? query.order('contact_id', { ascending: true }).range(offset, offset + CONTACT_PAGE_SIZE - 1)
        : query;

    const { data, error } = await pagedQuery;
    if (error) {
      if (isMissingSchemaDbError(error)) {
        return { ok: false, code: 'MIGRATION_NOT_APPLIED', error: `contact_tags table unavailable: ${error.message}` };
      }
      return { ok: false, code: 'AUDIENCE_QUERY_FAILED', error: `Could not load contact tag links: ${error.message}` };
    }

    const batch = (data ?? []) as Array<Record<string, unknown>>;
    for (const row of batch) {
      if (row.contact_id) idSet.add(String(row.contact_id));
    }

    if (idSet.size > MAX_AUDIENCE_ROWS) {
      return {
        ok: false,
        code: 'AUDIENCE_LIMIT_EXCEEDED',
        error: `Tagged audience exceeds the ${MAX_AUDIENCE_ROWS.toLocaleString()}-contact Phase 1 limit.`,
      };
    }

    if (batch.length < CONTACT_PAGE_SIZE) {
      break;
    }
    offset += CONTACT_PAGE_SIZE;
  }

  return { ok: true, contactIds: Array.from(idSet) };
}

/**
 * Resolves and validates a campaign audience from Supabase records
 * (`public.contacts`, `public.tags`, `public.contact_tags`) with pagination >1000 rows.
 * NEVER calls Meta WhatsApp API. Never masks missing schema as an empty audience.
 */
export async function resolveCampaignAudienceFromDb(params: {
  businessId: string;
  audienceFilter: CampaignAudienceFilterInput;
}): Promise<CampaignAudienceValidationResult> {
  const emptyError = (error: string, errorCode = 'AUDIENCE_QUERY_FAILED'): CampaignAudienceValidationResult => ({
    ok: false,
    mode: params.audienceFilter.mode,
    totalMatched: 0,
    eligibleCount: 0,
    excludedCount: 0,
    eligibleRecipients: [],
    excludedRecipients: [],
    groupedExclusions: createEmptyGroupedExclusions(),
    invalidTagIds: [],
    invalidContactIds: [],
    validatedAt: new Date().toISOString(),
    source: 'supabase_db',
    errorCode,
    error,
  });

  if (!supabase) {
    return emptyError('Supabase client is not configured.', 'SUPABASE_NOT_CONFIGURED');
  }
  if (!UUID_REGEX.test(params.businessId)) {
    return emptyError('Active business workspace could not be verified.', 'INVALID_BUSINESS_ID');
  }

  const mode = params.audienceFilter.mode;

  if (mode === 'groups') {
    const requestedTags = Array.from(new Set(params.audienceFilter.tagIds ?? []));
    const validUuidTags = requestedTags.filter((id) => UUID_REGEX.test(id));
    const malformedTags = requestedTags.filter((id) => !UUID_REGEX.test(id));

    if (requestedTags.length === 0) {
      return evaluateAudienceRows({ mode, matchedContacts: [], invalidTagIds: [] });
    }

    const { data: ownedTags, error: tagErr } = await supabase
      .from('tags')
      .select('id, business_id')
      .eq('business_id', params.businessId)
      .in('id', validUuidTags.length > 0 ? validUuidTags : ['00000000-0000-0000-0000-000000000000']);

    if (tagErr) {
      return emptyError(
        `Could not verify tags in Supabase: ${tagErr.message}`,
        isMissingSchemaDbError(tagErr) ? 'MIGRATION_NOT_APPLIED' : 'AUDIENCE_QUERY_FAILED'
      );
    }

    const ownedTagIds = new Set(
      ((ownedTags ?? []) as Array<Record<string, unknown>>).map((t) => String(t.id))
    );
    const invalidTagIds = [
      ...malformedTags,
      ...validUuidTags.filter((id) => !ownedTagIds.has(id)),
    ];

    if (ownedTagIds.size === 0) {
      return evaluateAudienceRows({ mode, matchedContacts: [], invalidTagIds });
    }

    const linksRes = await fetchPaginatedTagContactIds(Array.from(ownedTagIds));
    if (!linksRes.ok) {
      return emptyError(linksRes.error, linksRes.code);
    }

    if (linksRes.contactIds.length === 0) {
      return evaluateAudienceRows({ mode, matchedContacts: [], invalidTagIds });
    }

    const contactsRes = await fetchContactsByIdsBatched(params.businessId, linksRes.contactIds);
    if (!contactsRes.ok) {
      return emptyError(contactsRes.error, contactsRes.code);
    }

    return evaluateAudienceRows({
      mode,
      matchedContacts: contactsRes.rows,
      invalidTagIds,
    });
  }

  if (mode === 'specific') {
    const requestedIds = Array.from(new Set(params.audienceFilter.contactIds ?? []));
    const validUuidIds = requestedIds.filter((id) => UUID_REGEX.test(id));
    const malformedIds = requestedIds.filter((id) => !UUID_REGEX.test(id));

    if (requestedIds.length === 0) {
      return evaluateAudienceRows({ mode, matchedContacts: [] });
    }

    const contactsRes =
      validUuidIds.length > 0
        ? await fetchContactsByIdsBatched(params.businessId, validUuidIds)
        : { ok: true as const, rows: [] };

    if (!contactsRes.ok) {
      return emptyError(contactsRes.error, contactsRes.code);
    }

    const foundIds = new Set(contactsRes.rows.map((r) => String(r.id)));
    const missingContactIds = [
      ...malformedIds,
      ...validUuidIds.filter((id) => !foundIds.has(id)),
    ];

    return evaluateAudienceRows({
      mode,
      matchedContacts: contactsRes.rows,
      missingContactIds,
    });
  }

  const allRes = await fetchPaginatedContactsForBusiness(params.businessId);
  if (!allRes.ok) {
    return emptyError(allRes.error, allRes.code);
  }

  return evaluateAudienceRows({
    mode: 'all',
    matchedContacts: allRes.rows,
  });
}

function normalizeEdgeGuardianReport(
  raw: Record<string, unknown>,
  fallbackMode: CampaignAudienceMode,
  httpStatus = 200
): CampaignGuardianReport {
  const nowIso = String(raw.validatedAt ?? new Date().toISOString());
  const rawAud = (raw.audience && typeof raw.audience === 'object' ? raw.audience : {}) as Record<string, unknown>;
  const rawGrouped =
    rawAud.groupedExclusions && typeof rawAud.groupedExclusions === 'object'
      ? (rawAud.groupedExclusions as Partial<Record<CampaignExclusionReason, number>>)
      : {};

  const groupedExclusions: Record<CampaignExclusionReason, number> = {
    ...createEmptyGroupedExclusions(),
    ...rawGrouped,
  };

  const checks: GuardianCheckItem[] = Array.isArray(raw.checks)
    ? (raw.checks as GuardianCheckItem[])
    : [];
  const blockingReasons = Array.isArray(raw.blockingReasons)
    ? raw.blockingReasons.map(String)
    : [];
  const warnings = Array.isArray(raw.warnings) ? raw.warnings.map(String) : [];

  const migrationPending =
    raw.migrationReady === false ||
    checks.some((c) => c.code === 'MIGRATION_NOT_APPLIED');

  return {
    ok: Boolean(raw.ok),
    serverVerified: true,
    migrationReady: !migrationPending,
    migrationPending,
    canSaveDraft: Boolean(raw.canSaveDraft),
    // Phase 1 invariant: bulk dispatch is disabled in both Test Mode and Live Mode
    canLaunchBulk: false,
    phase1DispatchBlocked: true,
    messagingMode: String(raw.messagingMode ?? 'test').toLowerCase() === 'live' ? 'live' : 'test',
    whatsappConnected: Boolean(raw.whatsappConnected),
    whatsappAccountId: raw.whatsappAccountId ? String(raw.whatsappAccountId) : null,
    testAllowlistCount: Number(raw.testAllowlistCount ?? 0),
    eligibleInTestAllowlist: Number(raw.eligibleInTestAllowlist ?? 0),
    eligibleOutsideTestAllowlist: Number(raw.eligibleOutsideTestAllowlist ?? 0),
    checks,
    blockingReasons,
    warnings,
    templateSummary: (raw.templateSummary as CampaignGuardianReport['templateSummary']) ?? null,
    audience: {
      ok: rawAud.ok !== false,
      mode:
        rawAud.mode === 'groups' || rawAud.mode === 'specific' || rawAud.mode === 'all'
          ? rawAud.mode
          : fallbackMode,
      totalMatched: Number(rawAud.totalMatched ?? 0),
      eligibleCount: Number(rawAud.eligibleCount ?? 0),
      excludedCount: Number(rawAud.excludedCount ?? 0),
      eligibleRecipients: Array.isArray(rawAud.eligibleRecipients)
        ? (rawAud.eligibleRecipients as CampaignRecipientCandidate[])
        : [],
      excludedRecipients: Array.isArray(rawAud.excludedRecipients)
        ? (rawAud.excludedRecipients as CampaignExcludedRecipient[])
        : [],
      groupedExclusions,
      invalidTagIds: Array.isArray(rawAud.invalidTagIds) ? rawAud.invalidTagIds.map(String) : [],
      invalidContactIds: Array.isArray(rawAud.invalidContactIds)
        ? rawAud.invalidContactIds.map(String)
        : [],
      validatedAt: String(rawAud.validatedAt ?? nowIso),
      source: 'edge_function',
    },
    validatedAt: nowIso,
    source: 'edge_function',
    httpStatus,
  };
}

function buildUnverifiedErrorReport(params: {
  mode: CampaignAudienceMode;
  code: string;
  message: string;
  httpStatus?: number;
  migrationPending?: boolean;
}): CampaignGuardianReport {
  const nowIso = new Date().toISOString();
  return {
    ok: false,
    serverVerified: false,
    migrationReady: !params.migrationPending,
    migrationPending: Boolean(params.migrationPending),
    canSaveDraft: params.code !== 'UNAUTHENTICATED' && params.code !== 'ADMIN_REQUIRED',
    canLaunchBulk: false,
    phase1DispatchBlocked: true,
    messagingMode: 'test',
    whatsappConnected: false,
    whatsappAccountId: null,
    testAllowlistCount: 0,
    eligibleInTestAllowlist: 0,
    eligibleOutsideTestAllowlist: 0,
    checks: [
      {
        code: params.code,
        label: params.migrationPending
          ? 'Phase 1 SQL Installation'
          : params.code === 'UNAUTHENTICATED'
          ? 'Authentication Session'
          : params.code === 'ADMIN_REQUIRED'
          ? 'Administrator Authorization'
          : 'Server Preflight (`campaign-preflight`)',
        status: 'fail',
        message: params.message,
      },
    ],
    blockingReasons: [params.message],
    warnings: [],
    templateSummary: null,
    audience: {
      ok: false,
      mode: params.mode,
      totalMatched: 0,
      eligibleCount: 0,
      excludedCount: 0,
      eligibleRecipients: [],
      excludedRecipients: [],
      groupedExclusions: createEmptyGroupedExclusions(),
      invalidTagIds: [],
      invalidContactIds: [],
      validatedAt: nowIso,
      source: 'edge_function',
      errorCode: params.code,
      error: params.message,
    },
    validatedAt: nowIso,
    source: 'edge_function',
    httpStatus: params.httpStatus,
    errorCode: params.code,
    error: params.message,
  };
}

/**
 * Primary server-backed Campaign Guardian validator for Stage 2 and Stage 3.
 * Calls `campaign-preflight` (`action: 'validate'`) directly using the authenticated Supabase client.
 * - Marks `serverVerified: true` ONLY after a real Edge Function response.
 * - Parses `FunctionsHttpError` / `error.context` JSON preserving HTTP status and public error code.
 * - Never interprets missing schema or Edge Function errors as an empty audience.
 * - Never triggers WhatsApp sends or retries endlessly.
 */
export async function validateCampaignViaPreflightEdge(
  input: CampaignGuardianPreflightInput
): Promise<CampaignGuardianReport> {
  if (!supabase) {
    return buildUnverifiedErrorReport({
      mode: input.audienceFilter.mode,
      code: 'SUPABASE_NOT_CONFIGURED',
      message: 'Supabase client is not configured.',
    });
  }

  if (!UUID_REGEX.test(input.businessId)) {
    return buildUnverifiedErrorReport({
      mode: input.audienceFilter.mode,
      code: 'INVALID_BUSINESS_ID',
      message: 'Active business workspace ID could not be verified.',
    });
  }

  const cleanAudienceFilter = {
    mode: input.audienceFilter.mode,
    tag_ids: input.audienceFilter.tagIds ?? [],
    contact_ids: input.audienceFilter.contactIds ?? [],
    tagIds: input.audienceFilter.tagIds ?? [],
    contactIds: input.audienceFilter.contactIds ?? [],
  };

  const normalizedSchedule = normalizePhase1PreflightSchedule(
    input.scheduleMode,
    input.scheduledAt
  );

  try {
    const { data, error } = await supabase.functions.invoke('campaign-preflight', {
      body: {
        action: 'validate',
        businessId: input.businessId,
        campaignId: input.campaignId || undefined,
        templateId: input.templateId,
        audienceFilter: cleanAudienceFilter,
        variableMapping: input.variableMapping ?? {},
        scheduleMode: normalizedSchedule.scheduleMode,
        scheduledAt: normalizedSchedule.scheduledAt,
      },
    });

    if (error) {
      const parsed = await parseEdgeFunctionError(error);
      // If server returned HTTP 422 with a structured Guardian report, preserve the real server checks
      // while keeping serverVerified: false so the UI never displays "Verified" on a failed response.
      const embeddedGuardian =
        parsed.body?.guardian && typeof parsed.body.guardian === 'object'
          ? (parsed.body.guardian as Record<string, unknown>)
          : parsed.body && Array.isArray(parsed.body.checks) && parsed.body.audience
          ? parsed.body
          : null;

      if (embeddedGuardian && parsed.httpStatus === 422) {
        const normalized = normalizeEdgeGuardianReport(
          embeddedGuardian,
          input.audienceFilter.mode,
          422
        );
        return {
          ...normalized,
          ok: false,
          serverVerified: false,
          errorCode: parsed.code,
          error: parsed.message,
        };
      }

      return buildUnverifiedErrorReport({
        mode: input.audienceFilter.mode,
        code: parsed.code,
        message: parsed.message,
        httpStatus: parsed.httpStatus,
        migrationPending: parsed.migrationPending,
      });
    }

    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return buildUnverifiedErrorReport({
        mode: input.audienceFilter.mode,
        code: 'INVALID_EDGE_RESPONSE',
        message: 'campaign-preflight returned an unexpected empty response.',
      });
    }

    const payload = data as Record<string, unknown>;
    if (!Array.isArray(payload.checks) || !payload.audience) {
      return buildUnverifiedErrorReport({
        mode: input.audienceFilter.mode,
        code: String(payload.code ?? 'INVALID_EDGE_RESPONSE'),
        message: String(payload.error ?? 'campaign-preflight did not return a valid preflight report.'),
        migrationPending: String(payload.code ?? '') === 'MIGRATION_NOT_APPLIED',
      });
    }

    return normalizeEdgeGuardianReport(payload, input.audienceFilter.mode, 200);
  } catch (err) {
    const parsed = await parseEdgeFunctionError(err);
    return buildUnverifiedErrorReport({
      mode: input.audienceFilter.mode,
      code: parsed.code,
      message: parsed.message,
      httpStatus: parsed.httpStatus,
      migrationPending: parsed.migrationPending,
    });
  }
}

/**
 * Direct client-side DB preflight helper (used by unit/contract tests and diagnostics).
 * Marks `serverVerified: false` so only real `campaign-preflight` responses are labeled VERIFIED.
 * Uses `select('*')` on `whatsapp_accounts` (never hardcodes `meta_phone_number_id`) and paginates contacts >1000.
 */
export async function runCampaignGuardianPreflight(
  input: CampaignGuardianPreflightInput
): Promise<CampaignGuardianReport> {
  const nowIso = new Date().toISOString();
  const checks: GuardianCheckItem[] = [];
  const blockingReasons: string[] = [];
  const warnings: string[] = [];

  const emptyAudience: CampaignAudienceValidationResult = {
    ok: false,
    mode: input.audienceFilter.mode,
    totalMatched: 0,
    eligibleCount: 0,
    excludedCount: 0,
    eligibleRecipients: [],
    excludedRecipients: [],
    groupedExclusions: createEmptyGroupedExclusions(),
    invalidTagIds: [],
    invalidContactIds: [],
    validatedAt: nowIso,
    source: 'supabase_db',
  };

  if (!supabase) {
    return buildUnverifiedErrorReport({
      mode: input.audienceFilter.mode,
      code: 'SUPABASE_NOT_CONFIGURED',
      message: 'Supabase client is not configured.',
    });
  }

  // 1. Active administrator authorization
  const adminCheck = await verifyActiveBusinessAdmin(input.businessId);
  if (!adminCheck.ok) {
    checks.push({
      code: adminCheck.code,
      label: 'Administrator Authorization',
      status: 'fail',
      message: adminCheck.error,
    });
    blockingReasons.push(adminCheck.error);
    return {
      ok: false,
      serverVerified: false,
      migrationReady: false,
      migrationPending: false,
      canSaveDraft: false,
      canLaunchBulk: false,
      phase1DispatchBlocked: true,
      messagingMode: 'test',
      whatsappConnected: false,
      whatsappAccountId: null,
      testAllowlistCount: 0,
      eligibleInTestAllowlist: 0,
      eligibleOutsideTestAllowlist: 0,
      checks,
      blockingReasons,
      warnings,
      templateSummary: null,
      audience: { ...emptyAudience, errorCode: adminCheck.code, error: adminCheck.error },
      validatedAt: nowIso,
      source: 'supabase_db',
      errorCode: adminCheck.code,
      error: adminCheck.error,
    };
  }

  checks.push({
    code: 'ADMIN_AUTHORIZED',
    label: 'Administrator Authorization',
    status: 'pass',
    message: 'Verified active workspace administrator membership.',
  });

  // 2. Optional existing campaign business-ownership check
  let campaignOwnershipOk = true;
  if (input.campaignId) {
    if (!UUID_REGEX.test(input.campaignId)) {
      campaignOwnershipOk = false;
      const msg = 'Campaign ID is invalid.';
      checks.push({ code: 'INVALID_CAMPAIGN_ID', label: 'Campaign Ownership', status: 'fail', message: msg });
      blockingReasons.push(msg);
    } else {
      const { data: campRow, error: campErr } = await supabase
        .from('campaigns')
        .select('id, business_id')
        .eq('id', input.campaignId)
        .eq('business_id', input.businessId)
        .maybeSingle();

      if (campErr || !campRow) {
        campaignOwnershipOk = false;
        const msg = 'Campaign record does not belong to the active business workspace.';
        checks.push({ code: 'CAMPAIGN_NOT_IN_BUSINESS', label: 'Campaign Ownership', status: 'fail', message: msg });
        blockingReasons.push(msg);
      } else {
        checks.push({
          code: 'CAMPAIGN_OWNED',
          label: 'Campaign Ownership',
          status: 'pass',
          message: 'Campaign belongs to the active business workspace.',
        });
      }
    }
  }

  // 3 & 4. Approved Meta template + supported template parameters from components JSONB
  let templateOk = false;
  let templateExistsInBusiness = false;
  let templateSummary: CampaignGuardianReport['templateSummary'] = null;

  if (!input.templateId || !UUID_REGEX.test(input.templateId)) {
    const msg = 'Select a valid synchronized WhatsApp template.';
    checks.push({ code: 'TEMPLATE_REQUIRED', label: 'Approved Meta Template', status: 'fail', message: msg });
    blockingReasons.push(msg);
  } else {
    const { data: tplRow, error: tplErr } = await supabase
      .from('templates')
      .select('id, business_id, meta_template_id, name, language, category, status, components')
      .eq('id', input.templateId)
      .eq('business_id', input.businessId)
      .maybeSingle();

    if (tplErr) {
      const msg = `Could not verify template in Supabase: ${tplErr.message}`;
      checks.push({ code: 'TEMPLATE_LOOKUP_FAILED', label: 'Approved Meta Template', status: 'fail', message: msg });
      blockingReasons.push(msg);
    } else if (!tplRow) {
      const msg = 'Selected template does not exist in this workspace (cross-business or deleted).';
      checks.push({ code: 'TEMPLATE_NOT_FOUND', label: 'Approved Meta Template', status: 'fail', message: msg });
      blockingReasons.push(msg);
    } else {
      templateExistsInBusiness = true;
      const row = tplRow as Record<string, unknown>;
      const rawStatus = String(row.status ?? '').trim().toLowerCase();
      const metaTemplateId =
        row.meta_template_id && String(row.meta_template_id).trim() !== ''
          ? String(row.meta_template_id).trim()
          : null;
      const paramValidation = validateTemplateComponentsForCampaign(
        row.components,
        input.variableMapping ?? {}
      );

      templateSummary = {
        id: String(row.id),
        name: String(row.name ?? ''),
        language: String(row.language ?? 'en_US'),
        category: String(row.category ?? 'UTILITY'),
        status: rawStatus || 'draft',
        metaTemplateId,
        requiredVariables: paramValidation.requiredBodyVariables,
      };

      if (rawStatus !== 'approved' || !metaTemplateId) {
        const msg = !metaTemplateId
          ? `Template "${templateSummary.name}" is not linked to a Meta template ID (status: ${templateSummary.status}).`
          : `Template "${templateSummary.name}" has status "${templateSummary.status}" and is not approved by Meta.`;
        checks.push({ code: 'TEMPLATE_NOT_APPROVED', label: 'Approved Meta Template', status: 'fail', message: msg });
        blockingReasons.push(msg);
      } else {
        templateOk = true;
        checks.push({
          code: 'TEMPLATE_APPROVED',
          label: 'Approved Meta Template',
          status: 'pass',
          message: `Meta-approved template "${templateSummary.name}" (${templateSummary.language}) verified.`,
        });
      }

      if (!paramValidation.supported) {
        const msg = paramValidation.unsupportedReasons.join(' ');
        checks.push({ code: 'TEMPLATE_PARAMS_UNSUPPORTED', label: 'Template Parameters', status: 'fail', message: msg });
        blockingReasons.push(msg);
      } else if (paramValidation.missingVariables.length > 0) {
        const missingList = paramValidation.missingVariables.map((v) => `{{${v}}}`).join(', ');
        const msg = `Fill required template parameter(s): ${missingList}.`;
        checks.push({ code: 'TEMPLATE_PARAMS_MISSING', label: 'Template Parameters', status: 'fail', message: msg });
        blockingReasons.push(msg);
      } else {
        checks.push({
          code: 'TEMPLATE_PARAMS_VALID',
          label: 'Template Parameters',
          status: 'pass',
          message:
            paramValidation.requiredBodyVariables.length === 0
              ? 'Static template requires no variable parameters.'
              : `All ${paramValidation.requiredBodyVariables.length} required template parameter(s) provided.`,
        });
      }
    }
  }

  // 5. Connected WhatsApp account (select('*') — never hardcode phone ID column name)
  let whatsappConnected = false;
  let whatsappAccountId: string | null = null;
  let messagingMode: 'test' | 'live' = 'test';
  let normalizedAllowlist = new Set<string>();

  const { data: waRows, error: waErr } = await supabase
    .from('whatsapp_accounts')
    .select('*')
    .eq('business_id', input.businessId)
    .limit(1);

  if (waErr) {
    const msg = `Could not inspect WhatsApp account status: ${waErr.message}`;
    checks.push({ code: 'WHATSAPP_ACCOUNT_LOOKUP_FAILED', label: 'WhatsApp Cloud API Connection', status: 'fail', message: msg });
    blockingReasons.push(msg);
  } else {
    const wa = ((waRows ?? []) as Array<Record<string, unknown>>)[0] ?? null;
    if (!wa) {
      const msg = 'No WhatsApp Business Cloud API account is connected for this workspace.';
      checks.push({ code: 'WHATSAPP_NOT_CONNECTED', label: 'WhatsApp Cloud API Connection', status: 'fail', message: msg });
      blockingReasons.push(msg);
    } else {
      whatsappAccountId = String(wa.id);
      messagingMode = String(wa.messaging_mode ?? 'test').toLowerCase() === 'live' ? 'live' : 'test';
      const connStatus = String(wa.connection_status ?? 'not_connected').toLowerCase();
      const phoneNumberId = extractWhatsAppPhoneId(wa);
      const displayPhone = extractWhatsAppDisplayPhone(wa);
      whatsappConnected = connStatus === 'connected' && phoneNumberId.length > 0;

      const rawAllowlist = Array.isArray(wa.test_allowlist) ? wa.test_allowlist : [];
      normalizedAllowlist = new Set(
        rawAllowlist
          .map((item) => normalizePhoneE164(String(item ?? '')))
          .filter((v): v is string => Boolean(v))
      );

      if (!whatsappConnected) {
        const msg = `WhatsApp account connection status is "${connStatus}". Verify your account in Settings.`;
        checks.push({ code: 'WHATSAPP_NOT_CONNECTED', label: 'WhatsApp Cloud API Connection', status: 'fail', message: msg });
        blockingReasons.push(msg);
      } else {
        checks.push({
          code: 'WHATSAPP_CONNECTED',
          label: 'WhatsApp Cloud API Connection',
          status: 'pass',
          message: `Connected WhatsApp Cloud API account (${displayPhone || phoneNumberId}).`,
        });
      }
    }
  }

  // 6 & 7. Paginated DB Audience Validation
  const audience = await resolveCampaignAudienceFromDb({
    businessId: input.businessId,
    audienceFilter: input.audienceFilter,
  });

  if (!audience.ok) {
    const msg = audience.error ?? 'Could not validate campaign audience from Supabase.';
    checks.push({
      code: audience.errorCode ?? 'AUDIENCE_VALIDATION_FAILED',
      label: 'Audience & Consent Validation',
      status: 'fail',
      message: msg,
    });
    blockingReasons.push(msg);
  } else {
    if (audience.invalidTagIds.length > 0) {
      const msg = `${audience.invalidTagIds.length} selected tag(s) do not belong to this workspace.`;
      checks.push({ code: 'CROSS_BUSINESS_TAGS', label: 'Audience Tag Ownership', status: 'fail', message: msg });
      blockingReasons.push(msg);
    }

    if (audience.invalidContactIds.length > 0) {
      const msg = `${audience.invalidContactIds.length} selected contact(s) do not exist in this workspace and were excluded.`;
      checks.push({ code: 'CROSS_BUSINESS_CONTACTS', label: 'Audience Contact Ownership', status: 'warn', message: msg });
      warnings.push(msg);
    }

    if (audience.eligibleCount === 0) {
      const msg =
        audience.totalMatched === 0
          ? 'No contacts matched the selected audience filter.'
          : `All ${audience.totalMatched} matched contact(s) were excluded due to missing consent, opt-out, invalid phone, or duplicates.`;
      checks.push({ code: 'NO_ELIGIBLE_RECIPIENTS', label: 'Eligible Opted-In Audience', status: 'fail', message: msg });
      blockingReasons.push(msg);
    } else {
      checks.push({
        code: 'AUDIENCE_VALIDATED',
        label: 'Eligible Opted-In Audience',
        status: 'pass',
        message: `${audience.eligibleCount} unique opted-in recipient${audience.eligibleCount === 1 ? '' : 's'} verified (${audience.excludedCount} excluded).`,
      });
    }
  }

  // 8. Test Mode & Phase 1 Bulk Dispatch Safety
  let eligibleInTestAllowlist = 0;
  let eligibleOutsideTestAllowlist = 0;
  if (audience.ok) {
    for (const r of audience.eligibleRecipients) {
      if (normalizedAllowlist.has(r.phoneE164)) eligibleInTestAllowlist += 1;
      else eligibleOutsideTestAllowlist += 1;
    }
  }

  if (messagingMode === 'test') {
    const msg = `Test Mode is active — bulk campaign dispatch is strictly disabled (${eligibleInTestAllowlist} of ${audience.eligibleCount} eligible contacts are on the Test Allowlist).`;
    checks.push({ code: 'TEST_MODE_BULK_DISABLED', label: 'Test Mode Safety Guard', status: 'warn', message: msg });
    warnings.push(msg);
  } else {
    const msg = 'Campaign Engine Phase 1 is active — bulk dispatch remains disabled in both Test Mode and Live Mode.';
    checks.push({ code: 'PHASE_1_DISPATCH_DISABLED', label: 'Phase 1 Dispatch Guard', status: 'warn', message: msg });
    warnings.push(msg);
  }

  // 9. Schedule validity
  let scheduleValid = true;
  if (input.scheduleMode === 'scheduled') {
    const dt = input.scheduledAt ? new Date(input.scheduledAt) : null;
    const minLeadMs = 2 * 60 * 1000;
    const maxFutureMs = 365 * 24 * 60 * 60 * 1000;
    const nowMs = Date.now();

    if (!dt || Number.isNaN(dt.getTime())) {
      scheduleValid = false;
      const msg = 'Scheduled date and time is invalid.';
      checks.push({ code: 'SCHEDULE_INVALID', label: 'Schedule Validity', status: 'fail', message: msg });
      blockingReasons.push(msg);
    } else if (dt.getTime() < nowMs + minLeadMs) {
      scheduleValid = false;
      const msg = 'Scheduled time must be at least 2 minutes in the future.';
      checks.push({ code: 'SCHEDULE_IN_PAST', label: 'Schedule Validity', status: 'fail', message: msg });
      blockingReasons.push(msg);
    } else if (dt.getTime() > nowMs + maxFutureMs) {
      scheduleValid = false;
      const msg = 'Scheduled time cannot be more than 1 year in the future.';
      checks.push({ code: 'SCHEDULE_TOO_FAR', label: 'Schedule Validity', status: 'fail', message: msg });
      blockingReasons.push(msg);
    } else {
      checks.push({ code: 'SCHEDULE_VALID', label: 'Schedule Validity', status: 'pass', message: `Scheduled timestamp verified (${dt.toISOString()}).` });
    }
  } else {
    checks.push({
      code: 'SCHEDULE_DRAFT_OR_IMMEDIATE',
      label: 'Schedule Validity',
      status: 'pass',
      message: 'Draft / immediate review mode selected.',
    });
  }

  const allPreflightPassed =
    blockingReasons.length === 0 &&
    campaignOwnershipOk &&
    templateOk &&
    whatsappConnected &&
    audience.ok &&
    audience.eligibleCount > 0 &&
    scheduleValid;

  const canSaveDraft =
    adminCheck.ok && campaignOwnershipOk && templateExistsInBusiness && (input.scheduleMode !== 'scheduled' || scheduleValid);

  return {
    ok: allPreflightPassed,
    serverVerified: false,
    migrationReady: true,
    migrationPending: audience.errorCode === 'MIGRATION_NOT_APPLIED',
    canSaveDraft,
    canLaunchBulk: false,
    phase1DispatchBlocked: true,
    messagingMode,
    whatsappConnected,
    whatsappAccountId,
    testAllowlistCount: normalizedAllowlist.size,
    eligibleInTestAllowlist,
    eligibleOutsideTestAllowlist,
    checks,
    blockingReasons,
    warnings,
    templateSummary,
    audience,
    validatedAt: nowIso,
    source: 'supabase_db',
    errorCode: audience.errorCode,
    error: audience.error,
  };
}

/**
 * Creates a frozen durable snapshot (`campaign_runs` + `campaign_recipients` in `validated` state)
 * via `campaign-preflight` (`action: 'create_snapshot'`).
 * The backend intentionally re-reads the saved campaign template, audience_filter, and variable_mapping.
 * NEVER triggers WhatsApp message delivery.
 */
export async function createCampaignSnapshotViaEdge(
  req: CampaignSnapshotRequest
): Promise<CampaignSnapshotResult> {
  if (!supabase) {
    return { ok: false, code: 'SUPABASE_NOT_CONFIGURED', error: 'Supabase client is not configured.' };
  }

  if (!UUID_REGEX.test(req.businessId) || !UUID_REGEX.test(req.campaignId)) {
    return {
      ok: false,
      code: 'INVALID_IDENTIFIER',
      error: 'Save the campaign draft in Supabase first before creating a frozen snapshot.',
    };
  }

  if (!req.idempotencyKey || req.idempotencyKey.trim().length < 4) {
    return { ok: false, code: 'INVALID_IDEMPOTENCY_KEY', error: 'A valid idempotencyKey is required.' };
  }

  try {
    const { data, error } = await supabase.functions.invoke('campaign-preflight', {
      body: {
        action: 'create_snapshot',
        businessId: req.businessId,
        campaignId: req.campaignId,
        idempotencyKey: req.idempotencyKey.trim(),
      },
    });

    if (error) {
      const parsed = await parseEdgeFunctionError(error);
      const embeddedGuardian =
        parsed.body?.guardian && typeof parsed.body.guardian === 'object'
          ? normalizeEdgeGuardianReport(
              parsed.body.guardian as Record<string, unknown>,
              'all',
              parsed.httpStatus ?? 422
            )
          : undefined;

      return {
        ok: false,
        httpStatus: parsed.httpStatus,
        code: parsed.code,
        error: parsed.message,
        migrationPending: parsed.migrationPending,
        guardian: embeddedGuardian,
      };
    }

    const payload = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    if (!payload.ok) {
      const code = String(payload.code ?? 'SNAPSHOT_FAILED');
      return {
        ok: false,
        code,
        error: String(payload.error ?? 'Campaign snapshot could not be created.'),
        migrationPending: code === 'MIGRATION_NOT_APPLIED',
      };
    }

    return {
      ok: true,
      replayed: Boolean(payload.replayed),
      runId: payload.runId ? String(payload.runId) : undefined,
      runNumber: typeof payload.runNumber === 'number' ? payload.runNumber : undefined,
      status: payload.status ? String(payload.status) : undefined,
      eligibleCount: typeof payload.eligibleCount === 'number' ? payload.eligibleCount : undefined,
      excludedCount: typeof payload.excludedCount === 'number' ? payload.excludedCount : undefined,
      httpStatus: 200,
    };
  } catch (err) {
    const parsed = await parseEdgeFunctionError(err);
    return {
      ok: false,
      httpStatus: parsed.httpStatus,
      code: parsed.code,
      error: parsed.message,
      migrationPending: parsed.migrationPending,
    };
  }
}
