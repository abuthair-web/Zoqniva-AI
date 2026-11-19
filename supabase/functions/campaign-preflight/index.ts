// Supabase Edge Function: Campaign Engine V1 (Phase 1) — Preflight Guardian & Snapshot API
// Standalone single-file build for Supabase Dashboard -> Edge Functions -> Via Editor.
// Keep "Enforce JWT Verification" ENABLED (default) when deploying.
//
// Phase 1 Safety Invariants:
//   - Active administrator authorization strictly checked against `business_members.is_active = true`.
//   - Bulk WhatsApp dispatch is COMPLETELY DISABLED in Phase 1 and in Test Mode.
//   - NEVER calls Meta Graph API or `whatsapp-send-message`.
//   - Supports ONLY `action: 'validate'` and `action: 'create_snapshot'` (`draft_snapshot`/`validated`).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const E164_STRICT_REGEX = /^\+[1-9][0-9]{6,14}$/;
const OPTED_OUT_STATUSES = new Set(['opted_out', 'unsubscribed', 'revoked', 'blocked', 'do_not_contact']);
const OPTED_IN_STATUSES = new Set(['opted_in', 'subscribed', 'consented']);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function normalizePhoneToE164(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15 || digits.startsWith('0')) return null;
  const candidate = `+${digits}`;
  return E164_STRICT_REGEX.test(candidate) ? candidate : null;
}

type ExclusionReason =
  | 'contact_not_in_business'
  | 'invalid_phone'
  | 'duplicate_phone'
  | 'opted_out'
  | 'no_explicit_consent';

function evaluateConsent(row: Record<string, unknown>):
  | { eligible: true }
  | { eligible: false; reason: 'opted_out' | 'no_explicit_consent'; detail: string } {
  const optedOutAt =
    row.opted_out_at !== undefined && row.opted_out_at !== null && String(row.opted_out_at).trim() !== ''
      ? String(row.opted_out_at).trim()
      : null;

  if (optedOutAt) {
    return { eligible: false, reason: 'opted_out', detail: `Contact opted out on ${optedOutAt}.` };
  }

  const rawStatus = typeof row.opt_in_status === 'string' ? row.opt_in_status.trim().toLowerCase() : '';
  if (rawStatus && OPTED_OUT_STATUSES.has(rawStatus)) {
    return { eligible: false, reason: 'opted_out', detail: `Contact opt_in_status is "${rawStatus}".` };
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

function validateTemplateComponents(
  rawComponents: unknown,
  variableMapping: Record<string, string>
): {
  ok: boolean;
  supported: boolean;
  requiredBodyVariables: string[];
  missingVariables: string[];
  unsupportedReasons: string[];
} {
  const components = Array.isArray(rawComponents)
    ? rawComponents.filter((c): c is Record<string, unknown> => Boolean(c) && typeof c === 'object')
    : [];

  const headerComp = components.find((c) => String(c.type ?? '').trim().toUpperCase() === 'HEADER');
  const bodyComp = components.find((c) => String(c.type ?? '').trim().toUpperCase() === 'BODY');

  const unsupportedReasons: string[] = [];
  const requiredBodyVariables: string[] = [];
  const missingVariables: string[] = [];

  if (!bodyComp || typeof bodyComp.text !== 'string' || !bodyComp.text.trim()) {
    unsupportedReasons.push('Template is missing valid BODY text in components JSONB.');
  }

  if (headerComp) {
    const fmt = String(headerComp.format ?? (headerComp.text ? 'TEXT' : 'NONE')).trim().toUpperCase();
    if (fmt === 'IMAGE' || fmt === 'VIDEO' || fmt === 'DOCUMENT' || fmt === 'LOCATION') {
      unsupportedReasons.push(`Template uses a ${fmt} header, which is not yet supported in Phase 1.`);
    } else if (fmt === 'TEXT' && typeof headerComp.text === 'string') {
      const headerTokens = headerComp.text.match(/\{\{([^}]+)\}\}/g) ?? [];
      if (headerTokens.length > 0) {
        unsupportedReasons.push('Dynamic HEADER text variables are not supported in Phase 1.');
      }
    }
  }

  if (bodyComp && typeof bodyComp.text === 'string') {
    const matches = bodyComp.text.match(/\{\{([^}]+)\}\}/g) ?? [];
    for (const m of matches) {
      const token = m.slice(2, -2).trim();
      if (!/^\d+$/.test(token)) {
        unsupportedReasons.push(`Unsupported named body parameter "{{${token}}}".`);
      } else if (!requiredBodyVariables.includes(token)) {
        requiredBodyVariables.push(token);
      }
    }
    requiredBodyVariables.sort((a, b) => Number(a) - Number(b));

    for (const key of requiredBodyVariables) {
      const val = variableMapping[key];
      if (typeof val !== 'string' || !val.trim()) {
        missingVariables.push(key);
      }
    }
  }

  return {
    ok: unsupportedReasons.length === 0 && missingVariables.length === 0,
    supported: unsupportedReasons.length === 0,
    requiredBodyVariables,
    missingVariables,
    unsupportedReasons,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, code: 'METHOD_NOT_ALLOWED', error: 'Only POST is allowed.' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')?.trim();
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim();
  if (!supabaseUrl || !supabaseServiceKey) {
    return jsonResponse(
      { ok: false, code: 'SERVER_MISCONFIGURED', error: 'Supabase server environment is not configured.' },
      500
    );
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) {
    return jsonResponse({ ok: false, code: 'UNAUTHENTICATED', error: 'Missing Authorization Bearer token.' }, 401);
  }

  const adminClient = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1. Authenticate caller JWT
  const { data: userRes, error: userErr } = await adminClient.auth.getUser(jwt);
  if (userErr || !userRes?.user) {
    return jsonResponse({ ok: false, code: 'UNAUTHENTICATED', error: 'Invalid or expired auth token.' }, 401);
  }
  const actorId = userRes.user.id;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse({ ok: false, code: 'INVALID_JSON', error: 'Request body must be valid JSON.' }, 400);
  }

  const action = String(body.action ?? 'validate').trim();
  if (action !== 'validate' && action !== 'create_snapshot') {
    return jsonResponse(
      {
        ok: false,
        code: 'ACTION_NOT_ALLOWED',
        error: 'Only "validate" and "create_snapshot" are permitted in Phase 1. Bulk dispatch is disabled.',
      },
      400
    );
  }

  const businessId = String(body.businessId ?? '').trim();
  if (!UUID_REGEX.test(businessId)) {
    return jsonResponse({ ok: false, code: 'INVALID_BUSINESS_ID', error: 'Valid businessId UUID is required.' }, 400);
  }

  // 2. Enforce active administrator authorization using verified `is_active = true`
  const { data: memberRow, error: memberErr } = await adminClient
    .from('business_members')
    .select('business_id, user_id, role, is_active')
    .eq('business_id', businessId)
    .eq('user_id', actorId)
    .eq('is_active', true)
    .maybeSingle();

  if (memberErr) {
    return jsonResponse(
      { ok: false, code: 'MEMBERSHIP_CHECK_FAILED', error: 'Failed to verify workspace membership.' },
      500
    );
  }

  if (!memberRow || memberRow.is_active !== true || memberRow.role !== 'admin') {
    return jsonResponse(
      {
        ok: false,
        code: 'ADMIN_REQUIRED',
        error: 'Only active workspace administrators can run campaign preflight or create snapshots.',
      },
      403
    );
  }

  // 3. Resolve campaign ownership (required for create_snapshot, optional for validate)
  const campaignId = body.campaignId ? String(body.campaignId).trim() : null;
  let campaignRow: Record<string, unknown> | null = null;
  if (campaignId) {
    if (!UUID_REGEX.test(campaignId)) {
      return jsonResponse({ ok: false, code: 'INVALID_CAMPAIGN_ID', error: 'Invalid campaignId UUID.' }, 400);
    }
    const { data: cRow, error: cErr } = await adminClient
      .from('campaigns')
      .select('id, business_id, name, template_id, audience_filter, status, scheduled_at')
      .eq('id', campaignId)
      .eq('business_id', businessId)
      .maybeSingle();

    if (cErr || !cRow) {
      return jsonResponse(
        { ok: false, code: 'CAMPAIGN_NOT_FOUND', error: 'Campaign does not exist in this workspace.' },
        404
      );
    }
    campaignRow = cRow as Record<string, unknown>;
  } else if (action === 'create_snapshot') {
    return jsonResponse(
      { ok: false, code: 'CAMPAIGN_ID_REQUIRED', error: 'campaignId is required to create a snapshot.' },
      400
    );
  }

  const templateId = String(body.templateId ?? campaignRow?.template_id ?? '').trim();
  const rawVars =
    body.variableMapping && typeof body.variableMapping === 'object' && !Array.isArray(body.variableMapping)
      ? (body.variableMapping as Record<string, unknown>)
      : {};
  const variableMapping: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawVars)) {
    if (typeof v === 'string' || typeof v === 'number') variableMapping[k] = String(v);
  }

  const rawFilter =
    body.audienceFilter && typeof body.audienceFilter === 'object' && !Array.isArray(body.audienceFilter)
      ? (body.audienceFilter as Record<string, unknown>)
      : campaignRow?.audience_filter && typeof campaignRow.audience_filter === 'object'
      ? (campaignRow.audience_filter as Record<string, unknown>)
      : {};

  const rawMode = String(rawFilter.mode ?? 'all');
  const audienceMode: 'all' | 'groups' | 'specific' =
    rawMode === 'groups' || rawMode === 'specific' ? rawMode : 'all';
  const requestedTagIds = Array.from(
    new Set(
      (Array.isArray(rawFilter.tagIds)
        ? rawFilter.tagIds
        : Array.isArray(rawFilter.tag_ids)
        ? rawFilter.tag_ids
        : []
      ).map(String)
    )
  );
  const requestedContactIds = Array.from(
    new Set(
      (Array.isArray(rawFilter.contactIds)
        ? rawFilter.contactIds
        : Array.isArray(rawFilter.contact_ids)
        ? rawFilter.contact_ids
        : []
      ).map(String)
    )
  );

  const checks: Array<{ code: string; label: string; status: 'pass' | 'warn' | 'fail'; message: string }> = [
    {
      code: 'ADMIN_AUTHORIZED',
      label: 'Administrator Authorization',
      status: 'pass',
      message: 'Verified active workspace administrator membership.',
    },
  ];
  const blockingReasons: string[] = [];
  const warnings: string[] = [];

  // 4. Verify approved Meta template & supported parameters
  let templateRow: Record<string, unknown> | null = null;
  let templateSummary: Record<string, unknown> | null = null;
  let templateOk = false;

  if (!UUID_REGEX.test(templateId)) {
    const msg = 'Valid templateId UUID is required.';
    checks.push({ code: 'TEMPLATE_REQUIRED', label: 'Approved Meta Template', status: 'fail', message: msg });
    blockingReasons.push(msg);
  } else {
    const { data: tpl, error: tplErr } = await adminClient
      .from('templates')
      .select('id, business_id, meta_template_id, name, language, category, status, components')
      .eq('id', templateId)
      .eq('business_id', businessId)
      .maybeSingle();

    if (tplErr || !tpl) {
      const msg = 'Selected template does not exist in this business workspace.';
      checks.push({ code: 'TEMPLATE_NOT_FOUND', label: 'Approved Meta Template', status: 'fail', message: msg });
      blockingReasons.push(msg);
    } else {
      templateRow = tpl as Record<string, unknown>;
      const statusLower = String(templateRow.status ?? '').trim().toLowerCase();
      const metaTplId =
        templateRow.meta_template_id && String(templateRow.meta_template_id).trim() !== ''
          ? String(templateRow.meta_template_id).trim()
          : null;
      const paramCheck = validateTemplateComponents(templateRow.components, variableMapping);

      templateSummary = {
        id: String(templateRow.id),
        name: String(templateRow.name ?? ''),
        language: String(templateRow.language ?? 'en_US'),
        category: String(templateRow.category ?? 'UTILITY'),
        status: statusLower || 'draft',
        metaTemplateId: metaTplId,
        requiredVariables: paramCheck.requiredBodyVariables,
      };

      if (statusLower !== 'approved' || !metaTplId) {
        const msg = `Template "${templateSummary.name}" is not Meta-approved (status: ${templateSummary.status}).`;
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

      if (!paramCheck.supported) {
        const msg = paramCheck.unsupportedReasons.join(' ');
        checks.push({ code: 'TEMPLATE_PARAMS_UNSUPPORTED', label: 'Template Parameters', status: 'fail', message: msg });
        blockingReasons.push(msg);
      } else if (paramCheck.missingVariables.length > 0) {
        const msg = `Fill required template parameter(s): ${paramCheck.missingVariables.map((v) => `{{${v}}}`).join(', ')}.`;
        checks.push({ code: 'TEMPLATE_PARAMS_MISSING', label: 'Template Parameters', status: 'fail', message: msg });
        blockingReasons.push(msg);
      } else {
        checks.push({
          code: 'TEMPLATE_PARAMS_VALID',
          label: 'Template Parameters',
          status: 'pass',
          message:
            paramCheck.requiredBodyVariables.length === 0
              ? 'Static template requires no variable parameters.'
              : `All ${paramCheck.requiredBodyVariables.length} template parameter(s) provided.`,
        });
      }
    }
  }

  // 5. Inspect WhatsApp account connection & Test Mode
  const { data: waRows } = await adminClient
    .from('whatsapp_accounts')
    .select('id, business_id, connection_status, messaging_mode, test_allowlist, meta_phone_number_id, phone_number_e164')
    .eq('business_id', businessId)
    .limit(1);

  const wa = ((waRows ?? []) as Array<Record<string, unknown>>)[0] ?? null;
  const whatsappAccountId = wa ? String(wa.id) : null;
  const messagingMode: 'test' | 'live' =
    wa && String(wa.messaging_mode ?? 'test').toLowerCase() === 'live' ? 'live' : 'test';
  const whatsappConnected = Boolean(
    wa &&
      String(wa.connection_status ?? '').toLowerCase() === 'connected' &&
      String(wa.meta_phone_number_id ?? '').trim().length > 0
  );
  const normalizedAllowlist = new Set(
    (Array.isArray(wa?.test_allowlist) ? wa.test_allowlist : [])
      .map((item) => normalizePhoneToE164(String(item ?? '')))
      .filter((v): v is string => Boolean(v))
  );

  if (!whatsappConnected) {
    const msg = 'No connected WhatsApp Business Cloud API account found for this workspace.';
    checks.push({ code: 'WHATSAPP_NOT_CONNECTED', label: 'WhatsApp Cloud API Connection', status: 'fail', message: msg });
    blockingReasons.push(msg);
  } else {
    checks.push({
      code: 'WHATSAPP_CONNECTED',
      label: 'WhatsApp Cloud API Connection',
      status: 'pass',
      message: `Connected WhatsApp account (${String(wa?.phone_number_e164 ?? wa?.meta_phone_number_id)}).`,
    });
  }

  // 6. Database-backed audience resolution, consent, E.164 validation & phone deduplication
  const groupedExclusions: Record<ExclusionReason, number> = {
    contact_not_in_business: 0,
    invalid_phone: 0,
    duplicate_phone: 0,
    opted_out: 0,
    no_explicit_consent: 0,
  };
  const invalidTagIds: string[] = [];
  const invalidContactIds: string[] = [];
  let matchedContacts: Array<Record<string, unknown>> = [];

  if (audienceMode === 'groups') {
    const validUuidTags = requestedTagIds.filter((id) => UUID_REGEX.test(id));
    invalidTagIds.push(...requestedTagIds.filter((id) => !UUID_REGEX.test(id)));

    if (validUuidTags.length > 0) {
      const { data: ownedTags } = await adminClient
        .from('tags')
        .select('id')
        .eq('business_id', businessId)
        .in('id', validUuidTags);

      const ownedSet = new Set(((ownedTags ?? []) as Array<Record<string, unknown>>).map((t) => String(t.id)));
      invalidTagIds.push(...validUuidTags.filter((id) => !ownedSet.has(id)));

      if (ownedSet.size > 0) {
        const { data: links } = await adminClient
          .from('contact_tags')
          .select('contact_id')
          .in('tag_id', Array.from(ownedSet));

        const cIds = Array.from(new Set(((links ?? []) as Array<Record<string, unknown>>).map((l) => String(l.contact_id))));
        if (cIds.length > 0) {
          const { data: cRows } = await adminClient
            .from('contacts')
            .select('id, business_id, full_name, phone_e164, marketing_opt_in, opt_in_status, opted_out_at, created_at')
            .eq('business_id', businessId)
            .in('id', cIds);
          matchedContacts = (cRows ?? []) as Array<Record<string, unknown>>;
        }
      }
    }
  } else if (audienceMode === 'specific') {
    const validUuidContacts = requestedContactIds.filter((id) => UUID_REGEX.test(id));
    invalidContactIds.push(...requestedContactIds.filter((id) => !UUID_REGEX.test(id)));

    if (validUuidContacts.length > 0) {
      const { data: cRows } = await adminClient
        .from('contacts')
        .select('id, business_id, full_name, phone_e164, marketing_opt_in, opt_in_status, opted_out_at, created_at')
        .eq('business_id', businessId)
        .in('id', validUuidContacts);
      matchedContacts = (cRows ?? []) as Array<Record<string, unknown>>;
      const foundSet = new Set(matchedContacts.map((r) => String(r.id)));
      invalidContactIds.push(...validUuidContacts.filter((id) => !foundSet.has(id)));
    }
  } else {
    const { data: cRows } = await adminClient
      .from('contacts')
      .select('id, business_id, full_name, phone_e164, marketing_opt_in, opt_in_status, opted_out_at, created_at')
      .eq('business_id', businessId);
    matchedContacts = (cRows ?? []) as Array<Record<string, unknown>>;
  }

  matchedContacts.sort((a, b) => {
    const at = String(a.created_at ?? '');
    const bt = String(b.created_at ?? '');
    return at !== bt ? at.localeCompare(bt) : String(a.id ?? '').localeCompare(String(b.id ?? ''));
  });

  const eligibleRecipients: Array<{
    contactId: string;
    fullName: string;
    phoneE164: string;
    marketingOptIn: boolean;
    optInStatus: string | null;
    optedOutAt: string | null;
  }> = [];
  const excludedRecipients: Array<{
    contactId: string | null;
    fullName: string;
    rawPhone: string;
    normalizedPhone: string | null;
    reason: ExclusionReason;
    detail: string;
  }> = [];
  const seenPhones = new Set<string>();

  for (const missingId of invalidContactIds) {
    groupedExclusions.contact_not_in_business += 1;
    excludedRecipients.push({
      contactId: missingId,
      fullName: 'Unknown / Outside Workspace',
      rawPhone: '',
      normalizedPhone: null,
      reason: 'contact_not_in_business',
      detail: 'Selected contact does not belong to this workspace.',
    });
  }

  for (const row of matchedContacts) {
    const contactId = String(row.id ?? '');
    const fullName = String(row.full_name ?? 'Unnamed Contact').trim() || 'Unnamed Contact';
    const rawPhone = String(row.phone_e164 ?? '').trim();
    const normalized = normalizePhoneToE164(rawPhone);

    if (!normalized) {
      groupedExclusions.invalid_phone += 1;
      excludedRecipients.push({
        contactId: contactId || null,
        fullName,
        rawPhone,
        normalizedPhone: null,
        reason: 'invalid_phone',
        detail: 'Phone number is not valid E.164.',
      });
      continue;
    }

    const consent = evaluateConsent(row);
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

    if (seenPhones.has(normalized)) {
      groupedExclusions.duplicate_phone += 1;
      excludedRecipients.push({
        contactId: contactId || null,
        fullName,
        rawPhone,
        normalizedPhone: normalized,
        reason: 'duplicate_phone',
        detail: `Duplicate normalized phone (${normalized}).`,
      });
      continue;
    }

    seenPhones.add(normalized);
    eligibleRecipients.push({
      contactId,
      fullName,
      phoneE164: normalized,
      marketingOptIn: true,
      optInStatus: typeof row.opt_in_status === 'string' ? row.opt_in_status : null,
      optedOutAt: row.opted_out_at ? String(row.opted_out_at) : null,
    });
  }

  if (invalidTagIds.length > 0) {
    const msg = `${invalidTagIds.length} selected tag(s) do not belong to this workspace.`;
    checks.push({ code: 'CROSS_BUSINESS_TAGS', label: 'Audience Tag Ownership', status: 'fail', message: msg });
    blockingReasons.push(msg);
  }

  if (eligibleRecipients.length === 0) {
    const msg = 'No eligible opted-in recipients matched the campaign audience.';
    checks.push({ code: 'NO_ELIGIBLE_RECIPIENTS', label: 'Eligible Opted-In Audience', status: 'fail', message: msg });
    blockingReasons.push(msg);
  } else {
    checks.push({
      code: 'AUDIENCE_VALIDATED',
      label: 'Eligible Opted-In Audience',
      status: 'pass',
      message: `${eligibleRecipients.length} unique opted-in recipients verified (${excludedRecipients.length} excluded).`,
    });
  }

  let eligibleInTestAllowlist = 0;
  let eligibleOutsideTestAllowlist = 0;
  for (const r of eligibleRecipients) {
    if (normalizedAllowlist.has(r.phoneE164)) eligibleInTestAllowlist += 1;
    else eligibleOutsideTestAllowlist += 1;
  }

  if (messagingMode === 'test') {
    const msg = 'Test Mode is active — bulk campaign dispatch is strictly disabled.';
    checks.push({ code: 'TEST_MODE_BULK_DISABLED', label: 'Test Mode Safety Guard', status: 'warn', message: msg });
    warnings.push(msg);
  } else {
    const msg = 'Phase 1 foundation mode — bulk campaign dispatch is intentionally disabled.';
    checks.push({ code: 'PHASE_1_DISPATCH_DISABLED', label: 'Phase 1 Dispatch Guard', status: 'warn', message: msg });
    warnings.push(msg);
  }

  // 7. Schedule validation
  const scheduleMode = String(body.scheduleMode ?? 'draft');
  const scheduledAtRaw = body.scheduledAt ? String(body.scheduledAt) : null;
  let scheduledIso: string | null = null;
  if (scheduleMode === 'scheduled') {
    const dt = scheduledAtRaw ? new Date(scheduledAtRaw) : null;
    if (!dt || Number.isNaN(dt.getTime()) || dt.getTime() < Date.now() + 2 * 60 * 1000) {
      const msg = 'Scheduled time must be a valid timestamp at least 2 minutes in the future.';
      checks.push({ code: 'SCHEDULE_INVALID', label: 'Schedule Validity', status: 'fail', message: msg });
      blockingReasons.push(msg);
    } else {
      scheduledIso = dt.toISOString();
      checks.push({ code: 'SCHEDULE_VALID', label: 'Schedule Validity', status: 'pass', message: `Scheduled for ${scheduledIso}.` });
    }
  }

  const nowIso = new Date().toISOString();
  const guardianReport = {
    ok: blockingReasons.length === 0 && templateOk && whatsappConnected && eligibleRecipients.length > 0,
    canSaveDraft: Boolean(templateRow),
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
    audience: {
      ok: true,
      mode: audienceMode,
      totalMatched: matchedContacts.length + invalidContactIds.length,
      eligibleCount: eligibleRecipients.length,
      excludedCount: excludedRecipients.length,
      eligibleRecipients,
      excludedRecipients,
      groupedExclusions,
      invalidTagIds,
      invalidContactIds,
      validatedAt: nowIso,
      source: 'edge_function',
    },
    validatedAt: nowIso,
    source: 'edge_function',
  };

  if (action === 'validate') {
    return jsonResponse(guardianReport, 200);
  }

  // action === 'create_snapshot': atomically create a frozen non-dispatching snapshot via RPC
  const idempotencyKey = String(body.idempotencyKey ?? '').trim();
  if (idempotencyKey.length < 4) {
    return jsonResponse(
      { ok: false, code: 'INVALID_IDEMPOTENCY_KEY', error: 'idempotencyKey (min 4 chars) is required.' },
      400
    );
  }

  const initialStatus = guardianReport.ok ? 'validated' : 'draft_snapshot';
  const snapshotRecipients = [
    ...eligibleRecipients.map((r) => ({
      contact_id: r.contactId,
      phone_e164: r.phoneE164,
      contact_name: r.fullName,
      template_variables: variableMapping,
      status: 'pending',
    })),
    ...excludedRecipients.map((r) => ({
      contact_id: UUID_REGEX.test(r.contactId ?? '') ? r.contactId : null,
      phone_e164: r.normalizedPhone ?? r.rawPhone,
      contact_name: r.fullName,
      template_variables: {},
      status: 'excluded',
      exclusion_reason: r.reason,
    })),
  ];

  const { data: rpcRes, error: rpcErr } = await adminClient.rpc('create_campaign_run_snapshot', {
    p_business_id: businessId,
    p_campaign_id: campaignId,
    p_actor_id: actorId,
    p_idempotency_key: idempotencyKey,
    p_whatsapp_account_id: whatsappAccountId,
    p_messaging_mode: messagingMode,
    p_initial_status: initialStatus,
    p_scheduled_at: scheduledIso,
    p_template_snapshot: templateRow ?? {},
    p_audience_filter_snapshot: {
      mode: audienceMode,
      tag_ids: requestedTagIds,
      contact_ids: requestedContactIds,
    },
    p_variable_mapping_snapshot: variableMapping,
    p_guardian_summary: {
      ok: guardianReport.ok,
      blockingReasons,
      warnings,
      groupedExclusions,
      validatedAt: nowIso,
    },
    p_recipients: snapshotRecipients,
  });

  if (rpcErr) {
    return jsonResponse(
      {
        ok: false,
        code: 'SNAPSHOT_RPC_FAILED',
        error: `Could not create campaign snapshot: ${rpcErr.message}`,
      },
      500
    );
  }

  const rpcObj = (rpcRes ?? {}) as Record<string, unknown>;
  if (!rpcObj.ok) {
    const code = String(rpcObj.code ?? 'SNAPSHOT_REJECTED');
    const httpStatus = code === 'ADMIN_REQUIRED' ? 403 : code === 'CONCURRENT_RUN_ACTIVE' ? 409 : 400;
    return jsonResponse(
      { ok: false, code, error: String(rpcObj.error ?? 'Snapshot rejected.') },
      httpStatus
    );
  }

  return jsonResponse(
    {
      ok: true,
      replayed: Boolean(rpcObj.replayed),
      runId: rpcObj.run_id,
      runNumber: rpcObj.run_number,
      status: rpcObj.status,
      eligibleCount: rpcObj.eligible_count,
      excludedCount: rpcObj.excluded_count,
      guardian: guardianReport,
    },
    200
  );
});
