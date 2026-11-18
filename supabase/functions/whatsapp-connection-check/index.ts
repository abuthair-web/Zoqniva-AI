// Supabase Edge Function: Verify Meta WhatsApp Cloud API Connection & Update Messaging Mode
// Deploy with JWT verification ENABLED (default):
//   supabase functions deploy whatsapp-connection-check

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { logEvent } from '../_shared/logger.ts';
import {
  corsHeaders,
  getMetaRuntimeConfig,
  jsonResponse,
  normalizePhoneToE164,
  resolveGraphApiVersion,
  verifyMetaConnection,
} from '../_shared/metaCloudApi.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method Not Allowed' }, 405);
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonResponse({ ok: false, error: 'Missing Authorization header' }, 401);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
      return jsonResponse({ ok: false, error: 'Supabase environment secrets missing' }, 500);
    }

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes.user) {
      return jsonResponse({ ok: false, error: 'Unauthorized session' }, 401);
    }

    const payload = (await req.json().catch(() => ({}))) as {
      action?: 'verify' | 'save_config';
      phoneNumberId?: string;
      wabaId?: string;
      messagingMode?: 'test' | 'live';
      testAllowlist?: string[];
      graphApiVersion?: string;
    };

    const action = payload.action === 'save_config' ? 'save_config' : 'verify';

    // Resolve active admin membership
    const { data: memberRows, error: memberErr } = await serviceClient
      .from('business_members')
      .select('business_id, role, status')
      .eq('user_id', userRes.user.id);

    if (memberErr) {
      return jsonResponse({ ok: false, error: 'Failed to verify business membership' }, 500);
    }

    const activeAdmin = (memberRows ?? []).find(
      (m) => m.status === 'active' && m.role === 'admin'
    );
    if (!activeAdmin) {
      logEvent('permission_error', 'warn', 'Non-admin attempted WhatsApp connection check', {
        userId: userRes.user.id,
      });
      return jsonResponse(
        { ok: false, error: 'Only business administrators can configure or test WhatsApp.' },
        403
      );
    }

    const businessId = String(activeAdmin.business_id);

    // Fetch existing whatsapp_accounts record if present
    const { data: existingAccount } = await serviceClient
      .from('whatsapp_accounts')
      .select('*')
      .eq('business_id', businessId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    const config = getMetaRuntimeConfig({
      phoneNumberId:
        payload.phoneNumberId?.trim() ||
        (existingAccount?.meta_phone_number_id ? String(existingAccount.meta_phone_number_id) : ''),
      wabaId:
        payload.wabaId?.trim() ||
        (existingAccount?.meta_waba_id ? String(existingAccount.meta_waba_id) : ''),
      graphApiVersion:
        payload.graphApiVersion ??
        (existingAccount?.graph_api_version ? String(existingAccount.graph_api_version) : undefined),
    });

    const nextMode: 'test' | 'live' =
      payload.messagingMode === 'live'
        ? 'live'
        : payload.messagingMode === 'test'
        ? 'test'
        : existingAccount?.messaging_mode === 'live'
        ? 'live'
        : 'test';

    const normalizedAllowlist = Array.isArray(payload.testAllowlist)
      ? Array.from(
          new Set(
            payload.testAllowlist
              .map((raw) => normalizePhoneToE164(String(raw)))
              .filter((v): v is string => Boolean(v))
          )
        )
      : Array.isArray(existingAccount?.test_allowlist)
      ? (existingAccount.test_allowlist as string[])
      : [];

    const cleanGraphVersion = resolveGraphApiVersion(config.graphApiVersion);
    const projectRefMatch = supabaseUrl.match(/^https:\/\/([a-z0-9-]+)\.supabase\.co/i);
    const webhookCallbackUrl = projectRefMatch
      ? `https://${projectRefMatch[1]}.supabase.co/functions/v1/whatsapp-webhook`
      : `${supabaseUrl.replace(/\/$/, '')}/functions/v1/whatsapp-webhook`;

    if (action === 'save_config') {
      if (existingAccount) {
        const { error: updErr } = await serviceClient
          .from('whatsapp_accounts')
          .update({
            messaging_mode: nextMode,
            test_allowlist: normalizedAllowlist,
            graph_api_version: cleanGraphVersion,
            ...(config.phoneNumberId ? { meta_phone_number_id: config.phoneNumberId } : {}),
            ...(config.wabaId ? { meta_waba_id: config.wabaId } : {}),
          })
          .eq('id', existingAccount.id);

        if (updErr) {
          return jsonResponse({ ok: false, error: updErr.message }, 500);
        }
      } else {
        if (!config.phoneNumberId || !config.wabaId) {
          return jsonResponse(
            {
              ok: false,
              error: 'Save your Meta Phone Number ID and WABA ID first before updating mode.',
            },
            400
          );
        }
        const { error: insErr } = await serviceClient.from('whatsapp_accounts').insert({
          business_id: businessId,
          display_name: 'WhatsApp Business',
          phone_number_e164: '+10000000000',
          meta_phone_number_id: config.phoneNumberId,
          meta_waba_id: config.wabaId,
          connection_status: 'configuration_required',
          messaging_mode: nextMode,
          test_allowlist: normalizedAllowlist,
          graph_api_version: cleanGraphVersion,
          app_id: config.appId || null,
        });
        if (insErr) {
          return jsonResponse({ ok: false, error: insErr.message }, 500);
        }
      }

      return jsonResponse({
        ok: true,
        messagingMode: nextMode,
        testAllowlist: normalizedAllowlist,
        graphApiVersion: cleanGraphVersion,
        webhookCallbackUrl,
        webhookSecretsReady: Boolean(config.appSecret && config.webhookVerifyToken),
        message: `Saved ${nextMode === 'test' ? 'Test Mode' : 'Live Mode'} settings.`,
      });
    }

    // Live Graph API Connection Check (NO outbound WhatsApp messages sent)
    const check = await verifyMetaConnection(config);
    const nowIso = new Date().toISOString();

    const phoneE164 =
      check.displayPhoneNumber ||
      (existingAccount?.phone_number_e164 ? String(existingAccount.phone_number_e164) : '+10000000000');

    const upsertFields = {
      business_id: businessId,
      display_name:
        check.verifiedName ||
        (existingAccount?.display_name ? String(existingAccount.display_name) : 'WhatsApp Business'),
      verified_name: check.verifiedName ?? existingAccount?.verified_name ?? null,
      phone_number_e164: phoneE164,
      meta_phone_number_id: config.phoneNumberId || String(existingAccount?.meta_phone_number_id ?? 'unconfigured'),
      meta_waba_id: config.wabaId || String(existingAccount?.meta_waba_id ?? 'unconfigured'),
      connection_status: check.status,
      quality_rating: check.qualityRating ?? 'unknown',
      last_sync_at: nowIso,
      last_error_message: check.ok ? null : (check.userMessage ?? check.diagnosticMessage ?? 'Connection check failed'),
      messaging_mode: nextMode,
      test_allowlist: normalizedAllowlist,
      graph_api_version: cleanGraphVersion,
      app_id: config.appId || existingAccount?.app_id || null,
    };

    if (existingAccount) {
      await serviceClient
        .from('whatsapp_accounts')
        .update(upsertFields)
        .eq('id', existingAccount.id);
    } else if (config.phoneNumberId && config.wabaId) {
      await serviceClient.from('whatsapp_accounts').insert(upsertFields);
    }

    await serviceClient.from('audit_logs').insert({
      business_id: businessId,
      actor_id: userRes.user.id,
      action: check.ok ? 'Verified Meta WhatsApp Connection' : 'Meta Connection Check Failed',
      entity_type: 'whatsapp_account',
      details: {
        summary: check.ok
          ? `Connected phone ${check.displayPhoneNumber ?? config.phoneNumberId} (${nextMode} mode)`
          : `${check.errorCode ?? 'ERROR'}: ${check.userMessage ?? 'Verification failed'}`,
      },
    });

    if (!check.ok) {
      return jsonResponse(
        {
          ok: false,
          connectionStatus: check.status,
          errorCode: check.errorCode,
          error: check.userMessage,
          diagnostic: check.diagnosticMessage,
          messagingMode: nextMode,
          testAllowlist: normalizedAllowlist,
          graphApiVersion: cleanGraphVersion,
          webhookCallbackUrl,
          webhookSecretsReady: Boolean(config.appSecret && config.webhookVerifyToken),
        },
        check.status === 'configuration_required' ? 400 : 502
      );
    }

    return jsonResponse({
      ok: true,
      connectionStatus: 'connected',
      phoneNumberId: check.phoneNumberId,
      wabaId: check.wabaId,
      displayPhoneNumber: check.displayPhoneNumber,
      verifiedName: check.verifiedName,
      qualityRating: check.qualityRating,
      codeVerificationStatus: check.codeVerificationStatus,
      messagingMode: nextMode,
      testAllowlist: normalizedAllowlist,
      graphApiVersion: cleanGraphVersion,
      webhookCallbackUrl,
      webhookSecretsReady: Boolean(config.appSecret && config.webhookVerifyToken),
      message: `Connected to Meta WhatsApp Cloud API${check.verifiedName ? ` (${check.verifiedName})` : ''}.`,
    });
  } catch (err) {
    logEvent('meta_api_error', 'error', 'Unhandled exception in whatsapp-connection-check', {
      error: (err as Error).message,
    });
    return jsonResponse({ ok: false, error: 'Internal error checking WhatsApp connection.' }, 500);
  }
});
