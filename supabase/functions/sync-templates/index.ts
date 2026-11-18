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
      `https://graph.facebook.com/${graphApiVersion}/${encodeURIComponent(wabaId)}/message_templates?limit=100`;

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

    const nowIso = new Date().toISOString();
    let upsertedCount = 0;

    for (const tpl of allTemplates) {
      const rawName = String(tpl.name ?? '').toLowerCase().replace(/[^a-z0-9_]/g, '_');
      if (!rawName) continue;

      const components = Array.isArray(tpl.components)
        ? (tpl.components as Array<Record<string, unknown>>)
        : [];
      const headerComp = components.find((c) => c.type === 'HEADER');
      const bodyComp = components.find((c) => c.type === 'BODY');
      const footerComp = components.find((c) => c.type === 'FOOTER');
      const buttonsComp = components.find((c) => c.type === 'BUTTONS');

      const bodyText = typeof bodyComp?.text === 'string' ? bodyComp.text : '';
      const matches = bodyText.match(/\{\{\d+\}\}/g) ?? [];
      const headerFmt = String(headerComp?.format ?? 'NONE').toUpperCase();
      const headerType = ['TEXT', 'IMAGE', 'DOCUMENT'].includes(headerFmt) ? headerFmt : 'NONE';

      // Preserve Meta's actual approval status honestly (never force DRAFT/PENDING to APPROVED)
      const rawStatus = String(tpl.status ?? 'PENDING').toUpperCase();
      const approvalStatus = ['DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'PAUSED'].includes(rawStatus)
        ? rawStatus
        : 'PENDING';
      const rawCat = String(tpl.category ?? 'UTILITY').toUpperCase();
      const category = ['MARKETING', 'UTILITY', 'AUTHENTICATION'].includes(rawCat) ? rawCat : 'UTILITY';

      const { error: upsertErr } = await serviceClient.from('templates').upsert(
        {
          business_id: member.business_id,
          meta_template_id: tpl.id ? String(tpl.id) : null,
          name: rawName,
          category,
          language: String(tpl.language ?? 'en_US'),
          header_type: headerType,
          header_text: typeof headerComp?.text === 'string' ? headerComp.text : null,
          body_text: bodyText || rawName,
          footer_text: typeof footerComp?.text === 'string' ? footerComp.text : null,
          buttons: Array.isArray(buttonsComp?.buttons) ? buttonsComp.buttons : [],
          variables_count: matches.length,
          approval_status: approvalStatus,
          rejection_reason: typeof tpl.rejected_reason === 'string' ? tpl.rejected_reason : null,
          last_synced_at: nowIso,
        },
        { onConflict: 'business_id,name,language' }
      );

      if (!upsertErr) upsertedCount++;
    }

    await serviceClient.from('audit_logs').insert({
      business_id: member.business_id,
      actor_id: userRes.user.id,
      action: 'Synced Meta Message Templates',
      entity_type: 'template',
      details: {
        summary: `Synced ${upsertedCount} template(s) from Meta WABA ${wabaId}`,
      },
    });

    return jsonResponse({
      ok: true,
      syncedBy: userRes.user.id,
      templatesCount: upsertedCount,
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
