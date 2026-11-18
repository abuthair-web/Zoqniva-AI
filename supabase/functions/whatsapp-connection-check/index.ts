// Supabase Edge Function: Verify Meta WhatsApp Cloud API Connection & Update Messaging Mode
// Standalone single-file build for Supabase Dashboard -> Edge Functions -> Via Editor.
// Keep "Enforce JWT Verification" ENABLED (default) when deploying.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

const VALID_GRAPH_VERSION = /^v(1[89]|2[0-3])\.0$/;

function resolveGraphApiVersion(requested?: string | null): string {
  const envVer = Deno.env.get('META_GRAPH_API_VERSION')?.trim();
  const candidate = requested?.trim() || envVer || 'v21.0';
  return VALID_GRAPH_VERSION.test(candidate) ? candidate : 'v21.0';
}

function normalizeWaId(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15 || digits.startsWith('0')) return null;
  return digits;
}

function normalizePhoneToE164(raw: string): string | null {
  const waId = normalizeWaId(raw);
  return waId ? `+${waId}` : null;
}

function normalizeQualityRating(raw?: string | null): 'green' | 'yellow' | 'red' | 'unknown' {
  const lower = (raw ?? '').toLowerCase();
  if (lower === 'green' || lower === 'yellow' || lower === 'red') return lower;
  return 'unknown';
}

const SENSITIVE_KEY_PATTERN =
  /token|secret|authorization|password|apikey|api_key|signature|verify_token/i;

function logEvent(
  category: 'connection_check' | 'permission_error' | 'meta_api_error',
  level: 'info' | 'warn' | 'error',
  message: string,
  context: Record<string, unknown> = {}
): void {
  const sanitized: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(context)) {
    sanitized[k] = SENSITIVE_KEY_PATTERN.test(k) ? '[REDACTED]' : v;
  }
  const entry = { ts: new Date().toISOString(), category, level, message, ...sanitized };
  if (level === 'error') console.error(JSON.stringify(entry));
  else if (level === 'warn') console.warn(JSON.stringify(entry));
  else console.info(JSON.stringify(entry));
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
      diagnosticMessage: `Meta OAuth error 190${subcode ? `/${subcode}` : ''}: ${rawMessage}`,
    };
  }
  if (numericCode === '10' || numericCode === '200') {
    return {
      code: 'META_PERMISSION_DENIED',
      httpStatus: 403,
      userMessage: 'Meta app lacks permission for this WhatsApp Business number or WABA.',
      diagnosticMessage: `Meta permission error ${numericCode}: ${rawMessage}`,
    };
  }
  if (numericCode === '100') {
    return {
      code: 'META_INVALID_IDENTIFIER',
      httpStatus: 400,
      userMessage: 'The Phone Number ID or WhatsApp Business Account ID is invalid.',
      diagnosticMessage: `Meta invalid parameter 100: ${rawMessage}`,
    };
  }
  return {
    code: numericCode ? `META_${numericCode}` : `META_HTTP_${httpStatus}`,
    httpStatus: httpStatus >= 400 && httpStatus < 500 ? 400 : 502,
    userMessage: 'Meta Graph API verification failed.',
    diagnosticMessage: `Meta HTTP ${httpStatus}: ${rawMessage}`,
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

    // Strict active Admin authorization check BEFORE accessing/modifying account metadata
    const { data: memberRows, error: memberErr } = await serviceClient
      .from('business_members')
      .select('business_id, role, is_active')
      .eq('user_id', userRes.user.id)
      .eq('is_active', true);

    if (memberErr) {
      return jsonResponse({ ok: false, error: 'Failed to verify business membership' }, 500);
    }

    const activeAdmin = (memberRows ?? []).find(
      (m) => m.is_active === true && m.role === 'admin'
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

    const { data: existingAccount } = await serviceClient
      .from('whatsapp_accounts')
      .select('*')
      .eq('business_id', businessId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    const phoneColCandidates = ['phone_number_id', 'meta_phone_number_id'] as const;
    const wabaColCandidates = [
      'waba_id',
      'meta_waba_id',
      'whatsapp_business_account_id',
      'business_account_id',
    ] as const;

    const detectedCols = new Set<string>();
    if (existingAccount) {
      for (const k of Object.keys(existingAccount)) detectedCols.add(k);
    }
    const probeCols = [
      ...phoneColCandidates,
      ...wabaColCandidates,
      'display_name',
      'verified_name',
      'phone_number_e164',
      'phone_number',
      'connection_status',
      'status',
      'quality_rating',
      'last_sync_at',
      'last_error_message',
      'messaging_mode',
      'test_allowlist',
      'graph_api_version',
      'app_id',
    ].filter((c) => !detectedCols.has(c));

    await Promise.all(
      probeCols.map(async (col) => {
        const { error } = await serviceClient.from('whatsapp_accounts').select(col).limit(0);
        if (!error) detectedCols.add(col);
      })
    );

    const readCol = (candidates: readonly string[]) => {
      if (!existingAccount) return '';
      for (const col of candidates) {
        const raw = (existingAccount as Record<string, unknown>)[col];
        if (typeof raw === 'string' || typeof raw === 'number') {
          const val = String(raw).trim();
          if (val && val !== 'unconfigured') return val;
        }
      }
      return '';
    };

    const accessToken =
      Deno.env.get('META_ACCESS_TOKEN')?.trim() ||
      Deno.env.get('META_WHATSAPP_ACCESS_TOKEN')?.trim() ||
      '';
    const appId = Deno.env.get('META_APP_ID')?.trim() ?? '';
    const appSecret = Deno.env.get('META_APP_SECRET')?.trim() ?? '';
    const webhookVerifyToken = Deno.env.get('META_WEBHOOK_VERIFY_TOKEN')?.trim() ?? '';

    const resolvedPhoneNumberId =
      payload.phoneNumberId?.trim() ||
      readCol(phoneColCandidates) ||
      Deno.env.get('META_PHONE_NUMBER_ID')?.trim() ||
      '';

    const resolvedWabaId =
      payload.wabaId?.trim() ||
      readCol(wabaColCandidates) ||
      Deno.env.get('META_WABA_ID')?.trim() ||
      '';

    const cleanGraphVersion = resolveGraphApiVersion(
      payload.graphApiVersion ??
        (existingAccount?.graph_api_version ? String(existingAccount.graph_api_version) : undefined)
    );

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

    const projectRefMatch = supabaseUrl.match(/^https:\/\/([a-z0-9-]+)\.supabase\.co/i);
    const webhookCallbackUrl = projectRefMatch
      ? `https://${projectRefMatch[1]}.supabase.co/functions/v1/whatsapp-webhook`
      : `${supabaseUrl.replace(/\/$/, '')}/functions/v1/whatsapp-webhook`;
    const webhookSecretsReady = Boolean(appSecret && webhookVerifyToken);

    const buildAccountPatch = (fields: {
      phoneId?: string;
      wabaId?: string;
      connStatus?: string;
      displayName?: string;
      verifiedName?: string | null;
      phoneE164?: string;
      qualityRating?: string;
      lastSyncAt?: string;
      lastError?: string | null;
      isInsert?: boolean;
    }) => {
      const patch: Record<string, unknown> = {};
      if (fields.isInsert) patch.business_id = businessId;
      if (fields.phoneId) {
        for (const c of phoneColCandidates) {
          if (detectedCols.has(c)) patch[c] = fields.phoneId;
        }
      }
      if (fields.wabaId) {
        for (const c of wabaColCandidates) {
          if (detectedCols.has(c)) patch[c] = fields.wabaId;
        }
      }
      if (detectedCols.has('messaging_mode')) patch.messaging_mode = nextMode;
      if (detectedCols.has('test_allowlist')) patch.test_allowlist = normalizedAllowlist;
      if (detectedCols.has('graph_api_version')) patch.graph_api_version = cleanGraphVersion;
      if (fields.displayName !== undefined && detectedCols.has('display_name')) {
        patch.display_name = fields.displayName;
      }
      if (fields.verifiedName !== undefined && detectedCols.has('verified_name')) {
        patch.verified_name = fields.verifiedName;
      }
      if (fields.phoneE164 !== undefined) {
        if (detectedCols.has('phone_number_e164')) patch.phone_number_e164 = fields.phoneE164;
        if (detectedCols.has('phone_number')) patch.phone_number = fields.phoneE164;
      }
      if (fields.connStatus !== undefined) {
        if (detectedCols.has('connection_status')) patch.connection_status = fields.connStatus;
        else if (detectedCols.has('status')) patch.status = fields.connStatus;
      }
      if (fields.qualityRating !== undefined && detectedCols.has('quality_rating')) {
        patch.quality_rating = fields.qualityRating;
      }
      if (fields.lastSyncAt !== undefined && detectedCols.has('last_sync_at')) {
        patch.last_sync_at = fields.lastSyncAt;
      }
      if (fields.lastError !== undefined && detectedCols.has('last_error_message')) {
        patch.last_error_message = fields.lastError;
      }
      if (detectedCols.has('app_id') && (appId || existingAccount?.app_id)) {
        patch.app_id = appId || existingAccount?.app_id || null;
      }
      return patch;
    };

    if (action === 'save_config') {
      if (existingAccount) {
        const updatePatch = buildAccountPatch({
          phoneId: resolvedPhoneNumberId || undefined,
          wabaId: resolvedWabaId || undefined,
        });
        const { error: updErr } = await serviceClient
          .from('whatsapp_accounts')
          .update(updatePatch)
          .eq('id', existingAccount.id);

        if (updErr) return jsonResponse({ ok: false, error: updErr.message }, 500);
      } else {
        if (!resolvedPhoneNumberId || !resolvedWabaId) {
          return jsonResponse(
            {
              ok: false,
              error: 'Save your Meta Phone Number ID and WABA ID first before updating mode.',
            },
            400
          );
        }
        const insertPatch = buildAccountPatch({
          isInsert: true,
          phoneId: resolvedPhoneNumberId,
          wabaId: resolvedWabaId,
          displayName: 'WhatsApp Business',
          phoneE164: '+10000000000',
          connStatus: 'configuration_required',
        });
        const { error: insErr } = await serviceClient.from('whatsapp_accounts').insert(insertPatch);
        if (insErr) return jsonResponse({ ok: false, error: insErr.message }, 500);
      }

      await serviceClient.from('audit_logs').insert({
        business_id: businessId,
        actor_id: userRes.user.id,
        action: 'Updated WhatsApp Messaging Config',
        entity_type: 'whatsapp_account',
        details: {
          summary: `Mode set to ${nextMode}; allowlist count: ${normalizedAllowlist.length}`,
        },
      });

      return jsonResponse({
        ok: true,
        phoneNumberId: resolvedPhoneNumberId,
        wabaId: resolvedWabaId,
        messagingMode: nextMode,
        testAllowlist: normalizedAllowlist,
        graphApiVersion: cleanGraphVersion,
        webhookCallbackUrl,
        webhookSecretsReady,
        message: `Saved ${nextMode === 'test' ? 'Test Mode' : 'Live Mode'} settings.`,
      });
    }

    // Live Meta Graph API Connection Verification (NEVER sends automatic test messages)
    if (!accessToken || !resolvedPhoneNumberId || !resolvedWabaId) {
      return jsonResponse(
        {
          ok: false,
          connectionStatus: 'configuration_required',
          errorCode: 'META_SECRETS_MISSING',
          error:
            'META_ACCESS_TOKEN secret, Phone Number ID, and WABA ID must all be configured before verifying.',
          diagnostic: 'Missing META_ACCESS_TOKEN, phone_number_id, or waba_id.',
          messagingMode: nextMode,
          testAllowlist: normalizedAllowlist,
          graphApiVersion: cleanGraphVersion,
          webhookCallbackUrl,
          webhookSecretsReady,
        },
        400
      );
    }

    let checkOk = false;
    let connStatus: 'connected' | 'configuration_required' | 'connection_error' = 'connection_error';
    let errorCode: string | undefined;
    let userMessage: string | undefined;
    let diagnosticMessage: string | undefined;
    let displayPhoneNumber: string | undefined;
    let verifiedName: string | undefined;
    let qualityRating: 'green' | 'yellow' | 'red' | 'unknown' = 'unknown';
    let codeVerificationStatus: string | undefined;
    let verifiedPhoneId = resolvedPhoneNumberId;
    let verifiedWabaId = resolvedWabaId;

    try {
      const phoneUrl =
        `https://graph.facebook.com/${cleanGraphVersion}/${encodeURIComponent(resolvedPhoneNumberId)}` +
        `?fields=id,display_phone_number,verified_name,quality_rating,code_verification_status`;
      const phoneRes = await fetchMetaWithTimeout(phoneUrl, accessToken);
      const phoneJson = (await phoneRes.json().catch(() => ({}))) as Record<string, unknown>;

      if (!phoneRes.ok) {
        const classified = classifyMetaError(phoneRes.status, phoneJson);
        errorCode = classified.code;
        userMessage = classified.userMessage;
        diagnosticMessage = classified.diagnosticMessage;
      } else {
        const wabaUrl =
          `https://graph.facebook.com/${cleanGraphVersion}/${encodeURIComponent(resolvedWabaId)}` +
          `?fields=id,name`;
        const wabaRes = await fetchMetaWithTimeout(wabaUrl, accessToken);
        const wabaJson = (await wabaRes.json().catch(() => ({}))) as Record<string, unknown>;

        if (!wabaRes.ok) {
          const classified = classifyMetaError(wabaRes.status, wabaJson);
          errorCode = classified.code;
          userMessage = classified.userMessage;
          diagnosticMessage = classified.diagnosticMessage;
        } else {
          const wabaPhonesUrl =
            `https://graph.facebook.com/${cleanGraphVersion}/${encodeURIComponent(resolvedWabaId)}/phone_numbers` +
            `?fields=id,display_phone_number,verified_name,quality_rating&limit=100`;
          const wabaPhonesRes = await fetchMetaWithTimeout(wabaPhonesUrl, accessToken);
          const wabaPhonesJson = (await wabaPhonesRes.json().catch(() => ({}))) as Record<string, unknown>;

          if (!wabaPhonesRes.ok) {
            const classified = classifyMetaError(wabaPhonesRes.status, wabaPhonesJson);
            errorCode = classified.code;
            userMessage = classified.userMessage;
            diagnosticMessage = classified.diagnosticMessage;
          } else {
            const wabaPhones = Array.isArray(wabaPhonesJson.data)
              ? (wabaPhonesJson.data as Array<Record<string, unknown>>)
              : [];
            const matchedPhone = wabaPhones.find((p) => String(p.id ?? '') === resolvedPhoneNumberId);

            if (!matchedPhone) {
              errorCode = 'META_PHONE_WABA_MISMATCH';
              userMessage =
                'This Phone Number ID does not belong to the specified WhatsApp Business Account (WABA) ID.';
              diagnosticMessage = `Phone ${resolvedPhoneNumberId} was not returned under WABA ${resolvedWabaId}/phone_numbers.`;
            } else {
              checkOk = true;
              connStatus = 'connected';
              verifiedPhoneId = String(phoneJson.id ?? resolvedPhoneNumberId);
              verifiedWabaId = String(wabaJson.id ?? resolvedWabaId);
              displayPhoneNumber =
                normalizePhoneToE164(String(phoneJson.display_phone_number ?? '')) ?? undefined;
              verifiedName =
                typeof phoneJson.verified_name === 'string'
                  ? phoneJson.verified_name
                  : typeof wabaJson.name === 'string'
                  ? wabaJson.name
                  : undefined;
              qualityRating = normalizeQualityRating(
                typeof phoneJson.quality_rating === 'string' ? phoneJson.quality_rating : null
              );
              codeVerificationStatus =
                typeof phoneJson.code_verification_status === 'string'
                  ? phoneJson.code_verification_status
                  : undefined;
            }
          }
        }
      }
    } catch (err) {
      const isAbort = err instanceof DOMException && err.name === 'AbortError';
      errorCode = isAbort ? 'META_TIMEOUT' : 'META_NETWORK_ERROR';
      userMessage = isAbort
        ? 'Timed out waiting for Meta Cloud API. Please try again.'
        : 'Could not reach Meta Cloud API right now.';
      diagnosticMessage = (err as Error).message;
    }

    const nowIso = new Date().toISOString();
    const phoneE164 =
      displayPhoneNumber ||
      (existingAccount?.phone_number_e164
        ? String(existingAccount.phone_number_e164)
        : existingAccount?.phone_number
        ? String(existingAccount.phone_number)
        : '+10000000000');

    const upsertFields = buildAccountPatch({
      isInsert: !existingAccount,
      phoneId: verifiedPhoneId,
      wabaId: verifiedWabaId,
      connStatus,
      displayName:
        verifiedName ||
        (existingAccount?.display_name ? String(existingAccount.display_name) : 'WhatsApp Business'),
      verifiedName: verifiedName ?? (existingAccount?.verified_name ? String(existingAccount.verified_name) : null),
      phoneE164,
      qualityRating,
      lastSyncAt: nowIso,
      lastError: checkOk ? null : (userMessage ?? diagnosticMessage ?? 'Connection check failed'),
    });

    if (existingAccount) {
      await serviceClient.from('whatsapp_accounts').update(upsertFields).eq('id', existingAccount.id);
    } else {
      await serviceClient.from('whatsapp_accounts').insert(upsertFields);
    }

    await serviceClient.from('audit_logs').insert({
      business_id: businessId,
      actor_id: userRes.user.id,
      action: checkOk ? 'Verified Meta WhatsApp Connection' : 'Meta Connection Check Failed',
      entity_type: 'whatsapp_account',
      details: {
        summary: checkOk
          ? `Connected phone ${displayPhoneNumber ?? verifiedPhoneId} (${nextMode} mode)`
          : `${errorCode ?? 'ERROR'}: ${userMessage ?? 'Verification failed'}`,
      },
    });

    if (!checkOk) {
      logEvent('meta_api_error', 'error', 'Meta WhatsApp connection check failed', {
        businessId,
        errorCode,
      });
      return jsonResponse(
        {
          ok: false,
          connectionStatus: connStatus,
          errorCode,
          error: userMessage,
          diagnostic: diagnosticMessage,
          messagingMode: nextMode,
          testAllowlist: normalizedAllowlist,
          graphApiVersion: cleanGraphVersion,
          webhookCallbackUrl,
          webhookSecretsReady,
        },
        502
      );
    }

    logEvent('connection_check', 'info', 'Meta WhatsApp connection verified', {
      businessId,
      phoneNumberId: verifiedPhoneId,
      wabaId: verifiedWabaId,
      qualityRating,
    });

    return jsonResponse({
      ok: true,
      connectionStatus: 'connected',
      phoneNumberId: verifiedPhoneId,
      wabaId: verifiedWabaId,
      displayPhoneNumber,
      verifiedName,
      qualityRating,
      codeVerificationStatus,
      messagingMode: nextMode,
      testAllowlist: normalizedAllowlist,
      graphApiVersion: cleanGraphVersion,
      webhookCallbackUrl,
      webhookSecretsReady,
      message: `Connected to Meta WhatsApp Cloud API${verifiedName ? ` (${verifiedName})` : ''}.`,
    });
  } catch (err) {
    logEvent('meta_api_error', 'error', 'Unhandled exception in whatsapp-connection-check', {
      error: (err as Error).message,
    });
    return jsonResponse({ ok: false, error: 'Internal error checking WhatsApp connection.' }, 500);
  }
});
