// Supabase Edge Function: Send One-to-One Official WhatsApp Cloud API Message
// Standalone single-file build for Supabase Dashboard -> Edge Functions -> Via Editor.
// Keep "Enforce JWT Verification" ENABLED (default) when deploying.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_GRAPH_VERSION = /^v(1[89]|2[0-3])\.0$/;

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

function maskPhone(phone?: string | null): string | undefined {
  if (!phone) return undefined;
  const trimmed = phone.trim();
  return trimmed.length <= 4 ? '****' : `***${trimmed.slice(-4)}`;
}

const SENSITIVE_KEY_PATTERN =
  /token|secret|authorization|password|apikey|api_key|signature|verify_token|body|message_text|content/i;

function logEvent(
  category: 'outgoing_submit' | 'permission_error' | 'meta_api_error' | 'duplicate_event',
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
      userMessage: 'Meta app lacks permission for this WhatsApp Business number.',
      diagnosticMessage: `Meta permission error ${numericCode}: ${rawMessage}`,
    };
  }
  if (numericCode === '100') {
    return {
      code: 'META_INVALID_IDENTIFIER',
      httpStatus: 400,
      userMessage: 'The Phone Number ID or template parameters are invalid.',
      diagnosticMessage: `Meta invalid parameter 100: ${rawMessage}`,
    };
  }
  if (numericCode === '131030') {
    return {
      code: 'META_TEST_RECIPIENT_NOT_ALLOWED',
      httpStatus: 400,
      userMessage: 'Recipient phone number is not in Meta’s allowed test recipient list.',
      diagnosticMessage: `Meta sandbox error 131030: ${rawMessage}`,
    };
  }
  if (numericCode === '131047') {
    return {
      code: 'META_REENGAGEMENT_REQUIRED',
      httpStatus: 400,
      userMessage: 'More than 24 hours have passed since the customer replied. Send an approved template instead.',
      diagnosticMessage: `Meta 24h window error 131047: ${rawMessage}`,
    };
  }
  if (numericCode === '131026') {
    return {
      code: 'META_RECIPIENT_UNDELIVERABLE',
      httpStatus: 400,
      userMessage: 'This phone number could not receive the WhatsApp message.',
      diagnosticMessage: `Meta undeliverable 131026: ${rawMessage}`,
    };
  }
  if (numericCode === '130429' || numericCode === '80007') {
    return {
      code: 'META_RATE_LIMITED',
      httpStatus: 429,
      userMessage: 'WhatsApp rate limit reached temporarily. Wait a moment before trying again.',
      diagnosticMessage: `Meta rate limit ${numericCode}: ${rawMessage}`,
    };
  }

  return {
    code: numericCode ? `META_${numericCode}` : `META_HTTP_${httpStatus}`,
    httpStatus: httpStatus >= 400 && httpStatus < 500 ? 400 : 502,
    userMessage: 'WhatsApp could not accept this message right now.',
    diagnosticMessage: `Meta HTTP ${httpStatus}: ${rawMessage}`,
  };
}

async function dispatchMetaMessage(params: {
  graphApiVersion: string;
  phoneNumberId: string;
  accessToken: string;
  recipientWaId: string;
  messageType: 'text' | 'template';
  body?: string;
  templateName?: string;
  language?: string;
  templateParameters?: string[];
}) {
  const {
    graphApiVersion,
    phoneNumberId,
    accessToken,
    recipientWaId,
    messageType,
    body,
    templateName,
    language = 'en_US',
    templateParameters,
  } = params;

  const metaPayload =
    messageType === 'template'
      ? {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: recipientWaId,
          type: 'template',
          template: {
            name: templateName,
            language: { code: language },
            ...(templateParameters && templateParameters.length > 0
              ? {
                  components: [
                    {
                      type: 'body',
                      parameters: templateParameters.map((val) => ({
                        type: 'text',
                        text: val,
                      })),
                    },
                  ],
                }
              : {}),
          },
        }
      : {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: recipientWaId,
          type: 'text',
          text: {
            preview_url: false,
            body: body ?? '',
          },
        };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);

  try {
    const res = await fetch(
      `https://graph.facebook.com/${graphApiVersion}/${encodeURIComponent(phoneNumberId)}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(metaPayload),
        signal: controller.signal,
      }
    );

    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const messagesArr = Array.isArray(json.messages) ? (json.messages as Array<Record<string, unknown>>) : [];
    const metaMessageId = typeof messagesArr[0]?.id === 'string' ? messagesArr[0].id : undefined;

    if (!res.ok || !metaMessageId) {
      const classified = classifyMetaError(res.status, json);
      logEvent('meta_api_error', 'error', 'Meta send rejected', {
        code: classified.code,
        recipient: maskPhone(recipientWaId),
        messageType,
      });
      return {
        ok: false,
        httpStatus: classified.httpStatus,
        errorCode: classified.code,
        userMessage: classified.userMessage,
        diagnosticMessage: classified.diagnosticMessage,
        rawResponse: json,
      };
    }

    logEvent('outgoing_submit', 'info', 'Message accepted by Meta Cloud API', {
      metaMessageId,
      recipient: maskPhone(recipientWaId),
      messageType,
    });

    return {
      ok: true,
      httpStatus: 200,
      metaMessageId,
      rawResponse: json,
    };
  } catch (err) {
    // NEVER blindly retry a timed-out POST to Meta to avoid duplicate WhatsApp messages
    const isAbort = err instanceof DOMException && err.name === 'AbortError';
    logEvent('meta_api_error', 'error', 'Meta send network failure/timeout', {
      isAbort,
      recipient: maskPhone(recipientWaId),
    });
    return {
      ok: false,
      httpStatus: 504,
      errorCode: isAbort ? 'META_REQUEST_TIMEOUT' : 'META_NETWORK_ERROR',
      userMessage: isAbort
        ? 'Timed out waiting for WhatsApp confirmation. Check status before retrying to avoid duplicates.'
        : 'Network error communicating with WhatsApp Cloud API.',
      diagnosticMessage: (err as Error).message,
    };
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

    // 1. Authenticate caller
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes.user) {
      return jsonResponse({ ok: false, error: 'Invalid or expired user session' }, 401);
    }
    const callerId = userRes.user.id;

    // 2. Parse & validate request payload (strictly 1-to-1 text or template; no bulk/campaigns)
    const payload = (await req.json().catch(() => ({}))) as {
      conversationId?: string;
      messageType?: string;
      body?: string;
      templateName?: string;
      language?: string;
      templateParameters?: string[];
      clientRequestId?: string;
    };

    const conversationId = String(payload.conversationId ?? '').trim();
    const messageType = String(payload.messageType ?? 'text').trim();
    const trimmedBody = String(payload.body ?? '').trim();
    const templateName = payload.templateName ? String(payload.templateName).trim() : undefined;
    const clientRequestId = payload.clientRequestId ? String(payload.clientRequestId).trim() : undefined;

    if (!UUID_REGEX.test(conversationId)) {
      return jsonResponse({ ok: false, code: 'INVALID_CONVERSATION_ID', error: 'Invalid conversation ID.' }, 400);
    }

    if (messageType !== 'text' && messageType !== 'template') {
      return jsonResponse(
        {
          ok: false,
          code: 'UNSUPPORTED_MESSAGE_TYPE',
          error: 'Only 1-to-1 text replies and approved template messages are supported.',
        },
        400
      );
    }

    if (!trimmedBody) {
      return jsonResponse({ ok: false, code: 'EMPTY_MESSAGE', error: 'Message text cannot be empty.' }, 400);
    }

    if (trimmedBody.length > 4096) {
      return jsonResponse(
        { ok: false, code: 'MESSAGE_TOO_LONG', error: 'WhatsApp messages cannot exceed 4,096 characters.' },
        400
      );
    }

    if (clientRequestId && clientRequestId.length > 128) {
      return jsonResponse({ ok: false, code: 'INVALID_CLIENT_REQUEST_ID', error: 'Invalid client request ID.' }, 400);
    }

    if (messageType === 'template' && !templateName) {
      return jsonResponse(
        { ok: false, code: 'TEMPLATE_REQUIRED', error: 'Template name is required for template messages.' },
        400
      );
    }

    // 3. Load target conversation & contact
    const { data: conversation, error: convErr } = await serviceClient
      .from('conversations')
      .select(
        'id, business_id, assigned_to, window_expires_at, contact:contacts(id, full_name, phone_e164, wa_id, marketing_opt_in, opted_out_at)'
      )
      .eq('id', conversationId)
      .maybeSingle();

    if (convErr || !conversation) {
      return jsonResponse({ ok: false, code: 'CONVERSATION_NOT_FOUND', error: 'Conversation not found.' }, 404);
    }

    const businessId = String(conversation.business_id);

    // 4. Verify active business membership & authorization (admin or assigned/unassigned agent)
    const { data: membership, error: membershipErr } = await serviceClient
      .from('business_members')
      .select('role, is_active')
      .eq('business_id', businessId)
      .eq('user_id', callerId)
      .eq('is_active', true)
      .maybeSingle();

    if (membershipErr) {
      logEvent('permission_error', 'error', 'Failed to verify business membership', {
        callerId,
        businessId,
        error: membershipErr.message,
      });
      return jsonResponse(
        { ok: false, code: 'MEMBERSHIP_CHECK_FAILED', error: 'Failed to verify workspace permissions.' },
        500
      );
    }

    if (
      !membership ||
      membership.is_active !== true ||
      (membership.role !== 'admin' && membership.role !== 'agent')
    ) {
      logEvent('permission_error', 'warn', 'Unauthorized send attempt', { callerId, businessId });
      return jsonResponse({ ok: false, code: 'FORBIDDEN', error: 'You are not authorized for this workspace.' }, 403);
    }

    if (membership.role === 'agent' && conversation.assigned_to !== null && conversation.assigned_to !== callerId) {
      logEvent('permission_error', 'warn', 'Agent attempted send on conversation assigned to another user', {
        callerId,
        conversationId,
      });
      return jsonResponse(
        { ok: false, code: 'CONVERSATION_ASSIGNED_TO_OTHER', error: 'This conversation is assigned to another team member.' },
        403
      );
    }

    // 5. Idempotency check (prevent double sends)
    if (clientRequestId) {
      const { data: existingMsg } = await serviceClient
        .from('messages')
        .select('*')
        .eq('business_id', businessId)
        .eq('client_request_id', clientRequestId)
        .maybeSingle();

      if (existingMsg && existingMsg.delivery_status !== 'failed') {
        logEvent('duplicate_event', 'info', 'Returning idempotent message result', {
          messageId: existingMsg.id,
          clientRequestId,
          status: existingMsg.delivery_status,
        });
        return jsonResponse({
          ok: true,
          idempotentReplay: true,
          deliveryStatus: existingMsg.delivery_status,
          metaMessageId: existingMsg.meta_message_id,
          message: existingMsg,
        });
      }
    }

    // 6. Load business WhatsApp account & runtime Meta credentials
    const { data: waAccount } = await serviceClient
      .from('whatsapp_accounts')
      .select('*')
      .eq('business_id', businessId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    const accessToken =
      Deno.env.get('META_ACCESS_TOKEN')?.trim() ||
      Deno.env.get('META_WHATSAPP_ACCESS_TOKEN')?.trim() ||
      '';
    const rawAccountPhoneId = String(
      waAccount?.phone_number_id ?? waAccount?.meta_phone_number_id ?? ''
    ).trim();
    const phoneNumberId =
      (rawAccountPhoneId && rawAccountPhoneId !== 'unconfigured' ? rawAccountPhoneId : '') ||
      Deno.env.get('META_PHONE_NUMBER_ID')?.trim() ||
      '';
    const graphApiVersion = resolveGraphApiVersion(
      waAccount?.graph_api_version ? String(waAccount.graph_api_version) : undefined
    );

    if (!accessToken || !phoneNumberId) {
      return jsonResponse(
        {
          ok: false,
          code: 'META_NOT_CONFIGURED',
          error: 'Meta WhatsApp Cloud API credentials are not configured on the server.',
        },
        422
      );
    }

    const accountConnStatus = waAccount?.connection_status ?? waAccount?.status;
    if (!waAccount || accountConnStatus !== 'connected') {
      return jsonResponse(
        {
          ok: false,
          code: 'WHATSAPP_NOT_CONNECTED',
          error: 'Verify your WhatsApp connection in Settings before sending live messages.',
        },
        400
      );
    }

    // 7. Normalize recipient phone / wa_id
    const contactObj = Array.isArray(conversation.contact)
      ? (conversation.contact[0] as Record<string, unknown> | undefined)
      : (conversation.contact as Record<string, unknown> | undefined);

    if (!contactObj?.phone_e164) {
      return jsonResponse({ ok: false, code: 'CONTACT_MISSING_PHONE', error: 'Customer phone number is missing.' }, 400);
    }

    const recipientE164 = normalizePhoneToE164(String(contactObj.phone_e164));
    const recipientWaId = normalizeWaId(String(contactObj.wa_id || contactObj.phone_e164));
    if (!recipientE164 || !recipientWaId) {
      return jsonResponse({ ok: false, code: 'INVALID_RECIPIENT_PHONE', error: 'Customer phone number is not valid E.164.' }, 400);
    }

    // 8. Enforce Test Mode Allowlist server-side
    const messagingMode = waAccount.messaging_mode === 'live' ? 'live' : 'test';
    if (messagingMode === 'test') {
      const allowlist = Array.isArray(waAccount.test_allowlist)
        ? waAccount.test_allowlist
            .map((p) => normalizePhoneToE164(String(p)))
            .filter((p): p is string => Boolean(p))
        : [];

      if (!allowlist.includes(recipientE164)) {
        logEvent('permission_error', 'warn', 'Blocked outbound send in Test Mode (not allowlisted)', {
          businessId,
          recipient: maskPhone(recipientE164),
        });
        return jsonResponse(
          {
            ok: false,
            code: 'TEST_MODE_RECIPIENT_NOT_ALLOWED',
            error:
              'Test Mode is active. Add this customer phone number to your Test Allowlist in Settings before sending.',
          },
          403
        );
      }
    }

    // 9. Enforce 24-hour customer service window for free-form text replies
    const windowExpiresMs = conversation.window_expires_at
      ? new Date(String(conversation.window_expires_at)).getTime()
      : 0;
    const windowOpen = !Number.isNaN(windowExpiresMs) && windowExpiresMs > Date.now();

    if (messageType === 'text' && !windowOpen) {
      return jsonResponse(
        {
          ok: false,
          code: 'WINDOW_EXPIRED',
          error:
            'The 24-hour customer service window has closed. Send an approved WhatsApp template message to re-engage.',
        },
        400
      );
    }

    // 10. Validate approved template when sending template message
    let resolvedLanguage = payload.language || 'en_US';
    if (messageType === 'template') {
      const { data: tplRow } = await serviceClient
        .from('templates')
        .select('id, name, category, language, approval_status')
        .eq('business_id', businessId)
        .eq('name', templateName!)
        .eq('approval_status', 'APPROVED')
        .maybeSingle();

      if (!tplRow) {
        return jsonResponse(
          {
            ok: false,
            code: 'TEMPLATE_NOT_APPROVED',
            error: 'Selected template is not approved in your Meta WhatsApp Business account.',
          },
          400
        );
      }

      resolvedLanguage = String(tplRow.language || resolvedLanguage);
      if (tplRow.category === 'MARKETING' && (!contactObj.marketing_opt_in || contactObj.opted_out_at)) {
        return jsonResponse(
          {
            ok: false,
            code: 'CONTACT_OPTED_OUT',
            error: 'This customer has not opted in to marketing template messages.',
          },
          400
        );
      }
    }

    // 11. Create pending message record before calling Meta Graph API
    const { data: createdMsg, error: insErr } = await serviceClient
      .from('messages')
      .insert({
        business_id: businessId,
        conversation_id: conversationId,
        sender_type: 'agent',
        sender_profile_id: callerId,
        direction: 'outbound',
        message_type: messageType,
        body: trimmedBody,
        template_name: messageType === 'template' ? templateName : null,
        client_request_id: clientRequestId ?? null,
        delivery_status: 'pending',
      })
      .select('*')
      .single();

    if (insErr) {
      if (insErr.code === '23505' && clientRequestId) {
        const { data: raceMsg } = await serviceClient
          .from('messages')
          .select('*')
          .eq('business_id', businessId)
          .eq('client_request_id', clientRequestId)
          .maybeSingle();
        if (raceMsg) {
          return jsonResponse({
            ok: true,
            idempotentReplay: true,
            deliveryStatus: raceMsg.delivery_status,
            metaMessageId: raceMsg.meta_message_id,
            message: raceMsg,
          });
        }
      }
      return jsonResponse({ ok: false, error: insErr.message }, 500);
    }

    await serviceClient.from('message_events').insert({
      business_id: businessId,
      message_id: createdMsg.id,
      event_type: 'pending',
      raw_payload: { client_request_id: clientRequestId ?? null },
    });

    // 12. Dispatch to Official Meta WhatsApp Cloud API
    const metaResult = await dispatchMetaMessage({
      graphApiVersion,
      phoneNumberId,
      accessToken,
      recipientWaId,
      messageType: messageType as 'text' | 'template',
      body: trimmedBody,
      templateName,
      language: resolvedLanguage,
      templateParameters: Array.isArray(payload.templateParameters)
        ? payload.templateParameters.map(String)
        : undefined,
    });

    const nowIso = new Date().toISOString();

    if (!metaResult.ok || !metaResult.metaMessageId) {
      const { data: failedMsg } = await serviceClient
        .from('messages')
        .update({
          delivery_status: 'failed',
          failed_at: nowIso,
          last_status_at: nowIso,
          error_code: metaResult.errorCode ?? 'META_SEND_FAILED',
          error_message: metaResult.userMessage ?? metaResult.diagnosticMessage ?? 'Meta rejected message.',
        })
        .eq('id', createdMsg.id)
        .select('*')
        .single();

      await serviceClient.from('message_events').insert({
        business_id: businessId,
        message_id: createdMsg.id,
        event_type: 'failed',
        raw_payload: metaResult.rawResponse ?? {
          code: metaResult.errorCode,
          diagnostic: metaResult.diagnosticMessage,
        },
      });

      return jsonResponse(
        {
          ok: false,
          code: metaResult.errorCode ?? 'META_SEND_FAILED',
          error: metaResult.userMessage ?? 'WhatsApp could not send this message.',
          diagnostic: metaResult.diagnosticMessage,
          message: failedMsg ?? createdMsg,
        },
        metaResult.httpStatus
      );
    }

    // 13. Meta accepted message -> mark strictly as 'submitted' (real webhooks advance sent/delivered/read)
    const { data: submittedMsg } = await serviceClient
      .from('messages')
      .update({
        delivery_status: 'submitted',
        meta_message_id: metaResult.metaMessageId,
        submitted_at: nowIso,
        last_status_at: nowIso,
        error_code: null,
        error_message: null,
      })
      .eq('id', createdMsg.id)
      .select('*')
      .single();

    await serviceClient.from('message_events').insert({
      business_id: businessId,
      message_id: createdMsg.id,
      event_type: 'submitted',
      raw_payload: metaResult.rawResponse ?? { meta_message_id: metaResult.metaMessageId },
    });

    await serviceClient
      .from('conversations')
      .update({
        last_message_preview: trimmedBody.slice(0, 140),
        last_message_at: nowIso,
        unread_count: 0,
      })
      .eq('id', conversationId);

    await serviceClient
      .from('contacts')
      .update({ last_contacted_at: nowIso })
      .eq('id', String(contactObj.id));

    return jsonResponse({
      ok: true,
      deliveryStatus: 'submitted',
      metaMessageId: metaResult.metaMessageId,
      message: submittedMsg ?? createdMsg,
    });
  } catch (err) {
    logEvent('meta_api_error', 'error', 'Unhandled exception in whatsapp-send-message', {
      error: (err as Error).message,
    });
    return jsonResponse({ ok: false, error: 'Unexpected error while sending message.' }, 500);
  }
});
