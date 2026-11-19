import { supabase } from '@/lib/supabase';
import { normalizePhoneE164 } from '@/lib/phone';
import { coerceComponentsArray, findTemplateComponent } from '@/lib/templates';
import type { TemplateComponent } from '@/types/crm';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const E164_STRICT_REGEX = /^\+[1-9][0-9]{6,14}$/;
const OPTED_OUT_STATUSES = new Set(['opted_out', 'unsubscribed', 'revoked', 'blocked', 'do_not_contact']);
const OPTED_IN_STATUSES = new Set(['opted_in', 'subscribed', 'consented']);

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

export interface CampaignGuardianPreflightInput {
  businessId: string;
  campaignId?: string | null;
  templateId: string;
  audienceFilter: CampaignAudienceFilterInput;
  variableMapping?: Record<string, string>;
  scheduleMode?: 'draft' | 'immediate' | 'scheduled';
  scheduledAt?: string | null;
}

export interface CampaignGuardianReport {
  ok: boolean;
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
  error?: string;
}

export interface CampaignSnapshotRequest {
  businessId: string;
  campaignId: string;
  idempotencyKey: string;
  audienceFilter: CampaignAudienceFilterInput;
  variableMapping?: Record<string, string>;
  scheduledAt?: string | null;
}

export interface CampaignSnapshotResult {
  ok: boolean;
  replayed?: boolean;
  runId?: string;
  runNumber?: number;
  status?: string;
  eligibleCount?: number;
  excludedCount?: number;
  code?: string;
  error?: string;
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

  // If marketing_opt_in column is absent on a row, require explicit positive opt_in_status
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

  // Record any selected contacts that were not found in the active business
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

  // Deterministic ordering by created_at / id so deduplication is repeatable across refreshes
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

    // 1. Validate & normalize E.164 phone number
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

    // 2. Enforce explicit consent & opt-out filtering (never infer consent from phone presence)
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

    // 3. Deduplicate by normalized E.164 phone number
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

  // Validate header component format
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

  // Validate body placeholders
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

/**
 * Resolves and validates a campaign audience strictly from live Supabase records
 * (`public.contacts`, `public.tags`, `public.contact_tags`) scoped to `businessId`.
 * NEVER calls Meta WhatsApp API.
 */
export async function resolveCampaignAudienceFromDb(params: {
  businessId: string;
  audienceFilter: CampaignAudienceFilterInput;
}): Promise<CampaignAudienceValidationResult> {
  const emptyError = (error: string): CampaignAudienceValidationResult => ({
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
    error,
  });

  if (!supabase) {
    return emptyError('Supabase client is not configured.');
  }
  if (!UUID_REGEX.test(params.businessId)) {
    return emptyError('Active business workspace could not be verified.');
  }

  const mode = params.audienceFilter.mode;

  if (mode === 'groups') {
    const requestedTags = Array.from(new Set(params.audienceFilter.tagIds ?? []));
    const validUuidTags = requestedTags.filter((id) => UUID_REGEX.test(id));
    const malformedTags = requestedTags.filter((id) => !UUID_REGEX.test(id));

    if (requestedTags.length === 0) {
      return evaluateAudienceRows({
        mode,
        matchedContacts: [],
        invalidTagIds: [],
      });
    }

    // Confirm all selected tags belong strictly to this business
    const { data: ownedTags, error: tagErr } = await supabase
      .from('tags')
      .select('id, business_id')
      .eq('business_id', params.businessId)
      .in('id', validUuidTags.length > 0 ? validUuidTags : ['00000000-0000-0000-0000-000000000000']);

    if (tagErr) {
      return emptyError(`Could not verify tags in Supabase: ${tagErr.message}`);
    }

    const ownedTagIds = new Set(
      ((ownedTags ?? []) as Array<Record<string, unknown>>).map((t) => String(t.id))
    );
    const invalidTagIds = [
      ...malformedTags,
      ...validUuidTags.filter((id) => !ownedTagIds.has(id)),
    ];

    if (ownedTagIds.size === 0) {
      return evaluateAudienceRows({
        mode,
        matchedContacts: [],
        invalidTagIds,
      });
    }

    const { data: links, error: linkErr } = await supabase
      .from('contact_tags')
      .select('contact_id, tag_id')
      .in('tag_id', Array.from(ownedTagIds));

    if (linkErr) {
      return emptyError(`Could not load contact tag assignments: ${linkErr.message}`);
    }

    const taggedContactIds = Array.from(
      new Set(((links ?? []) as Array<Record<string, unknown>>).map((l) => String(l.contact_id)))
    );

    if (taggedContactIds.length === 0) {
      return evaluateAudienceRows({
        mode,
        matchedContacts: [],
        invalidTagIds,
      });
    }

    const { data: contactRows, error: contactErr } = await supabase
      .from('contacts')
      .select('*')
      .eq('business_id', params.businessId)
      .in('id', taggedContactIds);

    if (contactErr) {
      return emptyError(`Could not load tagged contacts from Supabase: ${contactErr.message}`);
    }

    return evaluateAudienceRows({
      mode,
      matchedContacts: (contactRows ?? []) as Array<Record<string, unknown>>,
      invalidTagIds,
    });
  }

  if (mode === 'specific') {
    const requestedIds = Array.from(new Set(params.audienceFilter.contactIds ?? []));
    const validUuidIds = requestedIds.filter((id) => UUID_REGEX.test(id));
    const malformedIds = requestedIds.filter((id) => !UUID_REGEX.test(id));

    if (requestedIds.length === 0) {
      return evaluateAudienceRows({
        mode,
        matchedContacts: [],
      });
    }

    const { data: contactRows, error: contactErr } = await supabase
      .from('contacts')
      .select('*')
      .eq('business_id', params.businessId)
      .in('id', validUuidIds.length > 0 ? validUuidIds : ['00000000-0000-0000-0000-000000000000']);

    if (contactErr) {
      return emptyError(`Could not verify selected contacts in Supabase: ${contactErr.message}`);
    }

    const rows = (contactRows ?? []) as Array<Record<string, unknown>>;
    const foundIds = new Set(rows.map((r) => String(r.id)));
    const missingContactIds = [
      ...malformedIds,
      ...validUuidIds.filter((id) => !foundIds.has(id)),
    ];

    return evaluateAudienceRows({
      mode,
      matchedContacts: rows,
      missingContactIds,
    });
  }

  // mode === 'all': fetch all contacts in active business and evaluate explicit consent strictly
  const { data: allContacts, error: allErr } = await supabase
    .from('contacts')
    .select('*')
    .eq('business_id', params.businessId);

  if (allErr) {
    return emptyError(`Could not load workspace contacts from Supabase: ${allErr.message}`);
  }

  return evaluateAudienceRows({
    mode: 'all',
    matchedContacts: (allContacts ?? []) as Array<Record<string, unknown>>,
  });
}

// Circuit breaker to avoid repeating CORS/404 requests if campaign-preflight Edge Function is not deployed
let campaignPreflightEdgeUnavailable = false;

export function resetCampaignPreflightEdgeCircuit(): void {
  campaignPreflightEdgeUnavailable = false;
}

/**
 * Campaign Guardian Preflight Validator (Phase 1).
 * Validates all 9 guardrails against live Supabase database records:
 *   1. Active administrator authorization (`business_members.is_active = true`)
 *   2. Business ownership (campaign, template, tags, contacts, WhatsApp account)
 *   3. Approved Meta template (`templates.status = 'approved'` + `meta_template_id`)
 *   4. Valid supported template parameters (`templates.components` JSONB)
 *   5. Connected WhatsApp account (`whatsapp_accounts`)
 *   6. Contact consent & opt-out filtering
 *   7. Audience uniqueness (normalized E.164 deduplication)
 *   8. Test Mode restrictions (bulk dispatch strictly disabled)
 *   9. Schedule validity
 *
 * NEVER calls Meta WhatsApp API or dispatches any messages.
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
    return {
      ok: false,
      canSaveDraft: false,
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
          code: 'SUPABASE_NOT_CONFIGURED',
          label: 'Database Connection',
          status: 'fail',
          message: 'Supabase client is not configured.',
        },
      ],
      blockingReasons: ['Supabase client is not configured.'],
      warnings: [],
      templateSummary: null,
      audience: emptyAudience,
      validatedAt: nowIso,
      source: 'supabase_db',
      error: 'Supabase client is not configured.',
    };
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
      audience: { ...emptyAudience, error: adminCheck.error },
      validatedAt: nowIso,
      source: 'supabase_db',
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
      checks.push({
        code: 'INVALID_CAMPAIGN_ID',
        label: 'Campaign Ownership',
        status: 'fail',
        message: msg,
      });
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
        checks.push({
          code: 'CAMPAIGN_NOT_IN_BUSINESS',
          label: 'Campaign Ownership',
          status: 'fail',
          message: msg,
        });
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
    checks.push({
      code: 'TEMPLATE_REQUIRED',
      label: 'Approved Meta Template',
      status: 'fail',
      message: msg,
    });
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
      checks.push({
        code: 'TEMPLATE_LOOKUP_FAILED',
        label: 'Approved Meta Template',
        status: 'fail',
        message: msg,
      });
      blockingReasons.push(msg);
    } else if (!tplRow) {
      const msg = 'Selected template does not exist in this workspace (cross-business or deleted).';
      checks.push({
        code: 'TEMPLATE_NOT_FOUND',
        label: 'Approved Meta Template',
        status: 'fail',
        message: msg,
      });
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
        checks.push({
          code: 'TEMPLATE_NOT_APPROVED',
          label: 'Approved Meta Template',
          status: 'fail',
          message: msg,
        });
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
        checks.push({
          code: 'TEMPLATE_PARAMS_UNSUPPORTED',
          label: 'Template Parameters',
          status: 'fail',
          message: msg,
        });
        blockingReasons.push(msg);
      } else if (paramValidation.missingVariables.length > 0) {
        const missingList = paramValidation.missingVariables.map((v) => `{{${v}}}`).join(', ');
        const msg = `Fill required template parameter(s): ${missingList}.`;
        checks.push({
          code: 'TEMPLATE_PARAMS_MISSING',
          label: 'Template Parameters',
          status: 'fail',
          message: msg,
        });
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

  // 5. Connected WhatsApp account + Test Mode inspection
  let whatsappConnected = false;
  let whatsappAccountId: string | null = null;
  let messagingMode: 'test' | 'live' = 'test';
  let normalizedAllowlist = new Set<string>();

  const { data: waRows, error: waErr } = await supabase
    .from('whatsapp_accounts')
    .select('id, business_id, connection_status, messaging_mode, test_allowlist, meta_phone_number_id, phone_number_e164')
    .eq('business_id', input.businessId)
    .limit(1);

  if (waErr) {
    const msg = `Could not inspect WhatsApp account status: ${waErr.message}`;
    checks.push({
      code: 'WHATSAPP_ACCOUNT_LOOKUP_FAILED',
      label: 'WhatsApp Cloud API Connection',
      status: 'fail',
      message: msg,
    });
    blockingReasons.push(msg);
  } else {
    const wa = ((waRows ?? []) as Array<Record<string, unknown>>)[0] ?? null;
    if (!wa) {
      const msg = 'No WhatsApp Business Cloud API account is connected for this workspace.';
      checks.push({
        code: 'WHATSAPP_NOT_CONNECTED',
        label: 'WhatsApp Cloud API Connection',
        status: 'fail',
        message: msg,
      });
      blockingReasons.push(msg);
    } else {
      whatsappAccountId = String(wa.id);
      messagingMode = String(wa.messaging_mode ?? 'test').toLowerCase() === 'live' ? 'live' : 'test';
      const connStatus = String(wa.connection_status ?? 'not_connected').toLowerCase();
      const phoneNumberId = String(wa.meta_phone_number_id ?? wa.phone_number_id ?? '').trim();
      whatsappConnected = connStatus === 'connected' && phoneNumberId.length > 0;

      const rawAllowlist = Array.isArray(wa.test_allowlist) ? wa.test_allowlist : [];
      normalizedAllowlist = new Set(
        rawAllowlist
          .map((item) => normalizePhoneE164(String(item ?? '')))
          .filter((v): v is string => Boolean(v))
      );

      if (!whatsappConnected) {
        const msg = `WhatsApp account connection status is "${connStatus}". Verify your account in Settings.`;
        checks.push({
          code: 'WHATSAPP_NOT_CONNECTED',
          label: 'WhatsApp Cloud API Connection',
          status: 'fail',
          message: msg,
        });
        blockingReasons.push(msg);
      } else {
        checks.push({
          code: 'WHATSAPP_CONNECTED',
          label: 'WhatsApp Cloud API Connection',
          status: 'pass',
          message: `Connected WhatsApp Cloud API account (${String(wa.phone_number_e164 ?? phoneNumberId)}).`,
        });
      }
    }
  }

  // 6 & 7. Database-backed Audience Consent, E.164, Business Ownership & Uniqueness
  const audience = await resolveCampaignAudienceFromDb({
    businessId: input.businessId,
    audienceFilter: input.audienceFilter,
  });

  if (!audience.ok) {
    const msg = audience.error ?? 'Could not validate campaign audience from Supabase.';
    checks.push({
      code: 'AUDIENCE_VALIDATION_FAILED',
      label: 'Audience & Consent Validation',
      status: 'fail',
      message: msg,
    });
    blockingReasons.push(msg);
  } else {
    if (audience.invalidTagIds.length > 0) {
      const msg = `${audience.invalidTagIds.length} selected tag(s) do not belong to this workspace.`;
      checks.push({
        code: 'CROSS_BUSINESS_TAGS',
        label: 'Audience Tag Ownership',
        status: 'fail',
        message: msg,
      });
      blockingReasons.push(msg);
    }

    if (audience.invalidContactIds.length > 0) {
      const msg = `${audience.invalidContactIds.length} selected contact(s) do not exist in this workspace and were excluded.`;
      checks.push({
        code: 'CROSS_BUSINESS_CONTACTS',
        label: 'Audience Contact Ownership',
        status: 'warn',
        message: msg,
      });
      warnings.push(msg);
    }

    if (audience.eligibleCount === 0) {
      const msg =
        audience.totalMatched === 0
          ? 'No contacts matched the selected audience filter.'
          : `All ${audience.totalMatched} matched contact(s) were excluded due to missing consent, opt-out, invalid phone, or duplicates.`;
      checks.push({
        code: 'NO_ELIGIBLE_RECIPIENTS',
        label: 'Eligible Opted-In Audience',
        status: 'fail',
        message: msg,
      });
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
      if (normalizedAllowlist.has(r.phoneE164)) {
        eligibleInTestAllowlist += 1;
      } else {
        eligibleOutsideTestAllowlist += 1;
      }
    }
  }

  if (messagingMode === 'test') {
    const msg = `Test Mode is active — bulk campaign dispatch is strictly disabled (${eligibleInTestAllowlist} of ${audience.eligibleCount} eligible contacts are on the Test Allowlist). Save as Draft remains enabled.`;
    checks.push({
      code: 'TEST_MODE_BULK_DISABLED',
      label: 'Test Mode Safety Guard',
      status: 'warn',
      message: msg,
    });
    warnings.push(msg);
  } else {
    const msg =
      'Campaign Engine Phase 1 is active — preflight validation and draft saving are enabled, while bulk dispatch remains disabled pending Phase 2 activation.';
    checks.push({
      code: 'PHASE_1_DISPATCH_DISABLED',
      label: 'Phase 1 Dispatch Guard',
      status: 'warn',
      message: msg,
    });
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
      checks.push({
        code: 'SCHEDULE_INVALID',
        label: 'Schedule Validity',
        status: 'fail',
        message: msg,
      });
      blockingReasons.push(msg);
    } else if (dt.getTime() < nowMs + minLeadMs) {
      scheduleValid = false;
      const msg = 'Scheduled time must be at least 2 minutes in the future.';
      checks.push({
        code: 'SCHEDULE_IN_PAST',
        label: 'Schedule Validity',
        status: 'fail',
        message: msg,
      });
      blockingReasons.push(msg);
    } else if (dt.getTime() > nowMs + maxFutureMs) {
      scheduleValid = false;
      const msg = 'Scheduled time cannot be more than 1 year in the future.';
      checks.push({
        code: 'SCHEDULE_TOO_FAR',
        label: 'Schedule Validity',
        status: 'fail',
        message: msg,
      });
      blockingReasons.push(msg);
    } else {
      checks.push({
        code: 'SCHEDULE_VALID',
        label: 'Schedule Validity',
        status: 'pass',
        message: `Scheduled timestamp verified (${dt.toISOString()}).`,
      });
    }
  } else {
    checks.push({
      code: 'SCHEDULE_DRAFT_OR_IMMEDIATE',
      label: 'Schedule Validity',
      status: 'pass',
      message: 'Draft / immediate review mode selected (no scheduled timestamp errors).',
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

  // Draft saving remains available whenever admin is authorized, campaign/template belong to business, and schedule format is not malformed
  const canSaveDraft =
    adminCheck.ok && campaignOwnershipOk && templateExistsInBusiness && (input.scheduleMode !== 'scheduled' || scheduleValid);

  return {
    ok: allPreflightPassed,
    canSaveDraft,
    // Phase 1 invariant: bulk dispatch is ALWAYS disabled in Test Mode AND in Phase 1
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
  };
}

/**
 * Optional server-side Edge Function caller for `campaign-preflight` (action: 'validate' | 'create_snapshot').
 * Uses a single-attempt session circuit breaker so undeployed Edge Functions never trigger CORS retry loops.
 * NEVER sends WhatsApp messages.
 */
export async function invokeCampaignPreflightEdge(
  input: CampaignGuardianPreflightInput
): Promise<CampaignGuardianReport | null> {
  if (!supabase || campaignPreflightEdgeUnavailable) {
    return null;
  }

  try {
    const { data, error } = await supabase.functions.invoke('campaign-preflight', {
      body: {
        action: 'validate',
        businessId: input.businessId,
        campaignId: input.campaignId ?? undefined,
        templateId: input.templateId,
        audienceFilter: input.audienceFilter,
        variableMapping: input.variableMapping ?? {},
        scheduleMode: input.scheduleMode ?? 'draft',
        scheduledAt: input.scheduledAt ?? undefined,
      },
    });

    if (error || !data || typeof data !== 'object') {
      campaignPreflightEdgeUnavailable = true;
      return null;
    }

    const report = data as CampaignGuardianReport;
    if (report && report.audience && Array.isArray(report.checks)) {
      return {
        ...report,
        canLaunchBulk: false,
        phase1DispatchBlocked: true,
        source: 'edge_function',
      };
    }
    return null;
  } catch {
    campaignPreflightEdgeUnavailable = true;
    return null;
  }
}

/**
 * Creates a frozen durable snapshot (`campaign_runs` + `campaign_recipients` in `draft_snapshot`
 * or `validated` state) via the `campaign-preflight` Edge Function and atomic PostgreSQL RPC.
 * NEVER triggers WhatsApp message delivery.
 */
export async function createCampaignSnapshotViaEdge(
  req: CampaignSnapshotRequest
): Promise<CampaignSnapshotResult> {
  if (!supabase) {
    return { ok: false, code: 'SUPABASE_NOT_CONFIGURED', error: 'Supabase client is not configured.' };
  }

  if (!UUID_REGEX.test(req.businessId) || !UUID_REGEX.test(req.campaignId)) {
    return { ok: false, code: 'INVALID_IDENTIFIER', error: 'Invalid businessId or campaignId.' };
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
        audienceFilter: req.audienceFilter,
        variableMapping: req.variableMapping ?? {},
        scheduledAt: req.scheduledAt ?? undefined,
      },
    });

    if (error) {
      return {
        ok: false,
        code: 'EDGE_INVOKE_FAILED',
        error: error.message || 'Could not reach campaign-preflight Edge Function.',
      };
    }

    const payload = (data ?? {}) as Record<string, unknown>;
    if (!payload.ok) {
      return {
        ok: false,
        code: String(payload.code ?? 'SNAPSHOT_FAILED'),
        error: String(payload.error ?? 'Campaign snapshot could not be created.'),
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
    };
  } catch (err) {
    return {
      ok: false,
      code: 'EDGE_NETWORK_ERROR',
      error: err instanceof Error ? err.message : 'Network error creating campaign snapshot.',
    };
  }
}
