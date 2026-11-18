// Supabase Edge Function: Sync Message Templates from Meta WhatsApp Business Account
// Standalone single-file build for Supabase Dashboard -> Edge Functions -> Via Editor.
// Keep "Enforce JWT Verification" ENABLED (default) when deploying.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const VALID_GRAPH_VERSION = /^v(1[89]|2[0-9])\.0$/;
const DEFAULT_GRAPH_VERSION = 'v25.0';
const MAX_TEMPLATE_PAGES = 10;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function resolveGraphApiVersion(requested?: string | null): string {
  const envVer = Deno.env.get('META_GRAPH_API_VERSION')?.trim();
  if (envVer && VALID_GRAPH_VERSION.test(envVer)) return envVer;
  const candidate = requested?.trim();
  if (candidate && VALID_GRAPH_VERSION.test(candidate)) return candidate;
  return DEFAULT_GRAPH_VERSION;
}

function classifyMetaError(httpStatus: number, metaPayload: Record<string, unknown> | null) {
  const errObj = (metaPayload?.error as Record<string, unknown> | undefined) ?? {};
  const numericCode = errObj.code !== undefined ? String(errObj.code) : '';
  const subcode = errObj.error_subcode !== undefined ? String(errObj.error_subcode) : '';
  const rawMessage = typeof errObj.message === 'string' ? errObj.message : 'Meta Graph API request failed';

  if (numericCode === '190') {
    return {
      code: 'META_TOKEN_EXPIRED',
      httpStatus: 401,
      userMessage: 'WhatsApp API token has expired or is invalid. Ask an admin to rotate the server token.',
      diagnostic: `Meta OAuth error 190${subcode ? `/${subcode}` : ''}: ${rawMessage}`,
    };
  }
  if (numericCode === '10' || numericCode === '200') {
    return {
      code: 'META_PERMISSION_DENIED',
      httpStatus: 403,
      userMessage: 'Meta app lacks permission to list templates for this WABA.',
      diagnostic: `Meta permission error ${numericCode}: ${rawMessage}`,
    };
  }
  return {
    code: numericCode ? `META_${numericCode}` : `META_HTTP_${httpStatus}`,
    httpStatus: httpStatus >= 400 && httpStatus < 500 ? 400 : 502,
    userMessage: 'Could not sync WhatsApp templates from Meta.',
    diagnostic: `Meta HTTP ${httpStatus}: ${rawMessage}`,
  };
}

async function fetchMetaWithTimeout(url: string, accessToken: string, timeoutMs = 12000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

type DbLowerStatus = 'approved' | 'pending' | 'rejected' | 'paused' | 'disabled' | 'draft';
type LegacyUpperStatus = 'APPROVED' | 'PENDING' | 'REJECTED' | 'PAUSED' | 'DRAFT';

function mapMetaStatusToDbLower(raw: unknown): DbLowerStatus {
  const upper = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
  if (upper === 'APPROVED' || upper === 'ACTIVE') return 'approved';
  if (upper === 'PENDING' || upper === 'IN_APPEAL' || upper === 'PENDING_DELETION') return 'pending';
  if (upper === 'REJECTED') return 'rejected';
  if (upper === 'PAUSED') return 'paused';
  if (upper === 'DISABLED' || upper === 'LIMIT_EXCEEDED') return 'disabled';
  if (upper === 'DRAFT') return 'draft';
  return 'pending';
}

function mapLowerStatusToLegacyUpper(lower: DbLowerStatus): LegacyUpperStatus {
  if (lower === 'approved') return 'APPROVED';
  if (lower === 'rejected') return 'REJECTED';
  if (lower === 'paused' || lower === 'disabled') return 'PAUSED';
  if (lower === 'draft') return 'DRAFT';
  return 'PENDING';
}

function normalizeBodyForCompare(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function extractBodyTextFromComponents(rawComponents: unknown): string {
  const list = Array.isArray(rawComponents)
    ? (rawComponents as Array<Record<string, unknown>>)
    : [];
  const body = list.find((c) => String(c?.type ?? '').trim().toUpperCase() === 'BODY');
  return typeof body?.text === 'string' ? body.text : '';
}

function getRowBodyText(row: Record<string, unknown>): string {
  const fromComps = extractBodyTextFromComponents(row.components);
  if (fromComps.trim().length > 0) return fromComps;
  return typeof row.body_text === 'string' ? row.body_text : '';
}

function isLocalDraftRow(row: Record<string, unknown>): boolean {
  const hasMetaId =
    row.meta_template_id !== null &&
    row.meta_template_id !== undefined &&
    String(row.meta_template_id).trim() !== '';
  if (hasMetaId) return false;
  const rawStatus = String(row.status ?? row.approval_status ?? '').trim().toLowerCase();
  return rawStatus === '' || rawStatus === 'draft';
}

function baseLanguageCode(lang: string): string {
  return lang.trim().toLowerCase().split(/[-_]/)[0] ?? '';
}

const TEMPLATE_COLUMN_CANDIDATES = [
  'meta_template_id',
  'status',
  'approval_status',
  'components',
  'header_type',
  'header_text',
  'body_text',
  'footer_text',
  'buttons',
  'variables_count',
  'rejection_reason',
  'last_synced_at',
  'updated_at',
] as const;

async function detectTemplatesColumns(
  serviceClient: ReturnType<typeof createClient>,
  seedRows: Array<Record<string, unknown>>
): Promise<Set<string>> {
  const cols = new Set<string>();
  for (const row of seedRows) {
    for (const k of Object.keys(row)) cols.add(k);
  }
  if (cols.size > 0) return cols;

  // Fallback: inspect any row in templates table
  const { data: anyRow } = await serviceClient.from('templates').select('*').limit(1).maybeSingle();
  if (anyRow && typeof anyRow === 'object') {
    for (const k of Object.keys(anyRow as Record<string, unknown>)) cols.add(k);
    if (cols.size > 0) return cols;
  }

  // Table is completely empty: probe candidate columns safely
  await Promise.all(
    TEMPLATE_COLUMN_CANDIDATES.map(async (col) => {
      const { error } = await serviceClient.from('templates').select(col).limit(0);
      if (!error) cols.add(col);
    })
  );
  return cols;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST' && req.method !== 'GET') {
    return jsonResponse({ ok: false, error: 'Method Not Allowed' }, 405);
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
      return jsonResponse({ ok: false, error: 'Unauthorized' }, 401);
    }
    const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!jwt) {
      return jsonResponse({ ok: false, error: 'Unauthorized' }, 401);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
      return jsonResponse({ ok: false, error: 'Server configuration error' }, 500);
    }

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

    const { data: userRes, error: userErr } = await userClient.auth.getUser(jwt);
    if (userErr || !userRes.user) {
      return jsonResponse({ ok: false, error: 'Invalid session' }, 401);
    }

    const { data: member, error: memberErr } = await serviceClient
      .from('business_members')
      .select('business_id, role, is_active')
      .eq('user_id', userRes.user.id)
      .eq('is_active', true)
      .eq('role', 'admin')
      .limit(1)
      .maybeSingle();

    if (memberErr) {
      return jsonResponse({ ok: false, error: 'Failed to verify administrator membership.' }, 500);
    }

    if (!member || member.is_active !== true || member.role !== 'admin') {
      return jsonResponse({ ok: false, error: 'Only admins can sync templates.' }, 403);
    }

    const { data: waAccount } = await serviceClient
      .from('whatsapp_accounts')
      .select('*')
      .eq('business_id', member.business_id)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    const accessToken =
      Deno.env.get('META_ACCESS_TOKEN')?.trim() ||
      Deno.env.get('META_WHATSAPP_ACCESS_TOKEN')?.trim() ||
      '';
    const rawWaba = String(
      waAccount?.waba_id ??
        waAccount?.meta_waba_id ??
        waAccount?.whatsapp_business_account_id ??
        waAccount?.business_account_id ??
        ''
    ).trim();
    const wabaId =
      (rawWaba && rawWaba !== 'unconfigured' ? rawWaba : '') ||
      Deno.env.get('META_WABA_ID')?.trim() ||
      '';
    const graphApiVersion = resolveGraphApiVersion(
      waAccount?.graph_api_version ? String(waAccount.graph_api_version) : undefined
    );

    if (!accessToken || !wabaId) {
      return jsonResponse(
        {
          ok: false,
          code: 'META_NOT_CONFIGURED',
          error: 'META_ACCESS_TOKEN and WABA ID must be configured before syncing templates.',
        },
        422
      );
    }

    const allTemplates: Array<Record<string, unknown>> = [];
    let nextUrl: string | null =
      `https://graph.facebook.com/${graphApiVersion}/${encodeURIComponent(wabaId)}/message_templates?fields=id,name,language,category,status,components&limit=100`;

    for (let page = 0; page < MAX_TEMPLATE_PAGES && nextUrl; page++) {
      const metaRes = await fetchMetaWithTimeout(nextUrl, accessToken);
      const metaJson = (await metaRes.json().catch(() => ({}))) as Record<string, unknown>;

      if (!metaRes.ok) {
        const classified = classifyMetaError(metaRes.status, metaJson);
        console.error(
          JSON.stringify({
            ts: new Date().toISOString(),
            category: 'meta_api_error',
            level: 'error',
            message: 'Template sync failed',
            code: classified.code,
          })
        );
        return jsonResponse(
          { ok: false, code: classified.code, error: classified.userMessage, diagnostic: classified.diagnostic },
          classified.httpStatus
        );
      }

      const pageItems = Array.isArray(metaJson.data)
        ? (metaJson.data as Array<Record<string, unknown>>)
        : [];
      allTemplates.push(...pageItems);

      const candidateNext = (metaJson.paging as Record<string, unknown> | undefined)?.next;
      if (typeof candidateNext === 'string' && candidateNext.startsWith('https://graph.facebook.com/')) {
        nextUrl = candidateNext;
      } else {
        nextUrl = null;
      }
    }

    // Load existing business templates to inspect schema & safely reconcile local drafts
    const { data: existingData, error: existingLoadErr } = await serviceClient
      .from('templates')
      .select('*')
      .eq('business_id', member.business_id);

    if (existingLoadErr) {
      return jsonResponse(
        {
          ok: false,
          error: `Failed to inspect existing templates table: ${existingLoadErr.message}`,
        },
        500
      );
    }

    const existingRows = (existingData ?? []) as Array<Record<string, unknown>>;
    const tableCols = await detectTemplatesColumns(serviceClient, existingRows);

    // Respect existing category casing if DB uses lowercase check constraints; default uppercase
    const sampleExistingCat = existingRows.find((r) => typeof r.category === 'string')?.category;
    const preferLowerCategory =
      typeof sampleExistingCat === 'string' && sampleExistingCat === sampleExistingCat.toLowerCase();

    const nowIso = new Date().toISOString();
    let synced = 0;
    let skipped = 0;
    const skippedItems: Array<{ name: string; language: string; reason: string }> = [];
    const errors: Array<{ name: string; language: string; error: string }> = [];
    const verifiedIds: string[] = [];

    for (const tpl of allTemplates) {
      const rawName = String(tpl.name ?? '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
      const language = String(tpl.language ?? 'en_US').trim() || 'en_US';
      if (!rawName) {
        skipped++;
        skippedItems.push({ name: '(unnamed)', language, reason: 'Missing template name from Meta' });
        continue;
      }

      const metaTemplateId = tpl.id !== undefined && tpl.id !== null ? String(tpl.id).trim() : '';
      if (!metaTemplateId) {
        skipped++;
        skippedItems.push({ name: rawName, language, reason: 'Missing Meta template ID' });
        continue;
      }

      // Preserve complete Meta components array verbatim (HEADER, BODY, FOOTER, BUTTONS, examples, etc.)
      const components = Array.isArray(tpl.components)
        ? (tpl.components as Array<Record<string, unknown>>)
        : [];
      const headerComp = components.find(
        (c) => String(c?.type ?? '').trim().toUpperCase() === 'HEADER'
      );
      const bodyComp = components.find(
        (c) => String(c?.type ?? '').trim().toUpperCase() === 'BODY'
      );
      const footerComp = components.find(
        (c) => String(c?.type ?? '').trim().toUpperCase() === 'FOOTER'
      );
      const buttonsComp = components.find(
        (c) => String(c?.type ?? '').trim().toUpperCase() === 'BUTTONS'
      );

      const bodyText = typeof bodyComp?.text === 'string' ? bodyComp.text : '';
      const varMatches = bodyText.match(/\{\{[^}]+\}\}/g) ?? [];
      const uniqueVarsCount = new Set(varMatches.map((m) => m.trim())).size;
      const headerFmt = String(headerComp?.format ?? (headerComp?.text ? 'TEXT' : 'NONE'))
        .trim()
        .toUpperCase();
      const headerType = ['TEXT', 'IMAGE', 'DOCUMENT'].includes(headerFmt) ? headerFmt : 'NONE';

      const dbStatus = mapMetaStatusToDbLower(tpl.status);
      const legacyApprovalStatus = mapLowerStatusToLegacyUpper(dbStatus);
      const rawCat = String(tpl.category ?? 'UTILITY').trim().toUpperCase();
      const upperCategory = ['MARKETING', 'UTILITY', 'AUTHENTICATION'].includes(rawCat)
        ? rawCat
        : 'UTILITY';
      const categoryValue = preferLowerCategory ? upperCategory.toLowerCase() : upperCategory;

      // Build column-safe write payload matching actual database schema
      const buildRecord = (catVal: string): Record<string, unknown> => {
        const rec: Record<string, unknown> = {
          business_id: member.business_id,
          meta_template_id: metaTemplateId,
          name: rawName,
          language,
          category: catVal,
        };
        if (tableCols.has('status') || tableCols.size === 0) rec.status = dbStatus;
        if (tableCols.has('components') || tableCols.size === 0) rec.components = components;
        if (tableCols.has('approval_status')) rec.approval_status = legacyApprovalStatus;
        if (tableCols.has('header_type')) rec.header_type = headerType;
        if (tableCols.has('header_text')) {
          rec.header_text = typeof headerComp?.text === 'string' ? headerComp.text : null;
        }
        if (tableCols.has('body_text')) rec.body_text = bodyText;
        if (tableCols.has('footer_text')) {
          rec.footer_text = typeof footerComp?.text === 'string' ? footerComp.text : null;
        }
        if (tableCols.has('buttons')) {
          rec.buttons = Array.isArray(buttonsComp?.buttons) ? buttonsComp.buttons : [];
        }
        if (tableCols.has('variables_count')) rec.variables_count = uniqueVarsCount;
        if (tableCols.has('rejection_reason')) {
          rec.rejection_reason = typeof tpl.rejected_reason === 'string' ? tpl.rejected_reason : null;
        }
        if (tableCols.has('last_synced_at')) rec.last_synced_at = nowIso;
        if (tableCols.has('updated_at')) rec.updated_at = nowIso;
        return rec;
      };

      // Safe reconciliation rules:
      // 1) Check exact (name, language)
      const exactRow = existingRows.find(
        (r) => String(r.name ?? '') === rawName && String(r.language ?? '') === language
      );

      // 2) Check variant-language local draft (e.g. local draft 'en_US' vs Meta 'en')
      const variantDraftRow = !exactRow
        ? existingRows.find(
            (r) =>
              String(r.name ?? '') === rawName &&
              isLocalDraftRow(r) &&
              baseLanguageCode(String(r.language ?? '')) === baseLanguageCode(language)
          )
        : undefined;

      const metaBodyNorm = normalizeBodyForCompare(bodyText);

      if (exactRow && isLocalDraftRow(exactRow)) {
        const draftBodyNorm = normalizeBodyForCompare(getRowBodyText(exactRow));
        const safeToReconcile = draftBodyNorm === '' || draftBodyNorm === metaBodyNorm;
        if (!safeToReconcile) {
          skipped++;
          skippedItems.push({
            name: rawName,
            language,
            reason:
              'Skipped because a local draft with different custom message text already exists for this name and language.',
          });
          continue;
        }
      }

      const executeWrite = async (catVal: string) => {
        const record = buildRecord(catVal);
        if (variantDraftRow) {
          const draftBodyNorm = normalizeBodyForCompare(getRowBodyText(variantDraftRow));
          const safeToReconcileVariant = draftBodyNorm === '' || draftBodyNorm === metaBodyNorm;
          if (safeToReconcileVariant) {
            return await serviceClient
              .from('templates')
              .update(record)
              .eq('id', String(variantDraftRow.id))
              .eq('business_id', member.business_id)
              .select('*')
              .single();
          }
        }

        return await serviceClient
          .from('templates')
          .upsert(record, { onConflict: 'business_id,name,language' })
          .select('*')
          .single();
      };

      let writeRes = await executeWrite(categoryValue);
      // Retry with alternate category casing only if a CHECK constraint rejects casing
      if (writeRes.error && writeRes.error.code === '23514' && writeRes.error.message.includes('category')) {
        const altCategory = preferLowerCategory ? upperCategory : upperCategory.toLowerCase();
        writeRes = await executeWrite(altCategory);
      }

      if (writeRes.error || !writeRes.data) {
        errors.push({
          name: rawName,
          language,
          error: writeRes.error?.message || 'Upsert returned no verified row.',
        });
        continue;
      }

      const savedRow = writeRes.data as Record<string, unknown>;
      verifiedIds.push(String(savedRow.id));
      synced++;
    }

    // Final read-back verification against public.templates
    let readBackVerified = verifiedIds.length;
    if (verifiedIds.length > 0) {
      const { data: readBackRows, error: readBackErr } = await serviceClient
        .from('templates')
        .select('*')
        .eq('business_id', member.business_id)
        .in('id', verifiedIds);

      if (readBackErr || !readBackRows) {
        return jsonResponse(
          {
            ok: false,
            error: `Templates were written but read-back verification failed: ${readBackErr?.message ?? 'no rows returned'}`,
            totalFromMeta: allTemplates.length,
            synced: 0,
            skipped,
            skippedItems,
            errors,
          },
          500
        );
      }
      readBackVerified = readBackRows.length;
    }

    const totalFromMeta = allTemplates.length;
    if (totalFromMeta > 0 && synced === 0 && errors.length > 0) {
      return jsonResponse(
        {
          ok: false,
          error: `Failed to save synced templates: ${errors[0].error}`,
          totalFromMeta,
          synced: 0,
          skipped,
          skippedItems,
          errors,
        },
        500
      );
    }

    await serviceClient.from('audit_logs').insert({
      business_id: member.business_id,
      actor_id: userRes.user.id,
      action: 'Synced Meta Message Templates',
      entity_type: 'template',
      details: {
        summary: `Synced ${readBackVerified}/${totalFromMeta} template(s) from Meta WABA ${wabaId} (skipped ${skipped})`,
      },
    });

    return jsonResponse({
      ok: true,
      syncedBy: userRes.user.id,
      totalFromMeta,
      synced: readBackVerified,
      skipped,
      skippedItems,
      errors,
      templatesCount: readBackVerified,
      syncedAt: nowIso,
    });
  } catch (err) {
    return jsonResponse(
      {
        ok: false,
        error: 'Unexpected error syncing templates from Meta.',
        diagnostic: (err as Error).message,
      },
      500
    );
  }
});
