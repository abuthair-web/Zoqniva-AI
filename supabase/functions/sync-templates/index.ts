// Supabase Edge Function: Sync Message Templates from Meta WhatsApp Business Account
// Deploy with JWT verification ENABLED:
//   supabase functions deploy sync-templates

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { logEvent } from '../_shared/logger.ts';
import {
  classifyMetaError,
  corsHeaders,
  getMetaRuntimeConfig,
  jsonResponse,
} from '../_shared/metaCloudApi.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return jsonResponse({ ok: false, error: 'Unauthorized' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

  const { data: userRes, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userRes.user) {
    return jsonResponse({ ok: false, error: 'Invalid session' }, 401);
  }

  const { data: member } = await serviceClient
    .from('business_members')
    .select('business_id, role, status')
    .eq('user_id', userRes.user.id)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();

  if (!member || member.role !== 'admin') {
    return jsonResponse({ ok: false, error: 'Only admins can sync templates.' }, 403);
  }

  const { data: waAccount } = await serviceClient
    .from('whatsapp_accounts')
    .select('meta_waba_id, graph_api_version')
    .eq('business_id', member.business_id)
    .limit(1)
    .maybeSingle();

  const config = getMetaRuntimeConfig({
    wabaId: waAccount?.meta_waba_id ? String(waAccount.meta_waba_id) : undefined,
    graphApiVersion: waAccount?.graph_api_version ? String(waAccount.graph_api_version) : undefined,
  });

  if (!config.accessToken || !config.wabaId) {
    return jsonResponse(
      {
        ok: false,
        code: 'META_NOT_CONFIGURED',
        error: 'META_ACCESS_TOKEN and WABA ID must be configured before syncing templates.',
      },
      422
    );
  }

  const metaRes = await fetch(
    `https://graph.facebook.com/${config.graphApiVersion}/${encodeURIComponent(config.wabaId)}/message_templates?limit=100`,
    { headers: { Authorization: `Bearer ${config.accessToken}` } }
  );

  const metaJson = (await metaRes.json().catch(() => ({}))) as Record<string, unknown>;
  if (!metaRes.ok) {
    const classified = classifyMetaError(metaRes.status, metaJson);
    logEvent('meta_api_error', 'error', 'Template sync failed', { code: classified.code });
    return jsonResponse({ ok: false, code: classified.code, error: classified.userMessage }, classified.httpStatus);
  }

  const metaTemplates = Array.isArray(metaJson.data)
    ? (metaJson.data as Array<Record<string, unknown>>)
    : [];

  const nowIso = new Date().toISOString();
  for (const tpl of metaTemplates) {
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
    const rawStatus = String(tpl.status ?? 'PENDING').toUpperCase();
    const approvalStatus = ['DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'PAUSED'].includes(rawStatus)
      ? rawStatus
      : 'PENDING';
    const rawCat = String(tpl.category ?? 'UTILITY').toUpperCase();
    const category = ['MARKETING', 'UTILITY', 'AUTHENTICATION'].includes(rawCat) ? rawCat : 'UTILITY';

    await serviceClient.from('templates').upsert(
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
  }

  return jsonResponse({
    ok: true,
    syncedBy: userRes.user.id,
    templatesCount: metaTemplates.length,
  });
});
