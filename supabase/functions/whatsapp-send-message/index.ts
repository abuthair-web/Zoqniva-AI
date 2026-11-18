// Supabase Edge Function: Send One-to-One Official WhatsApp Cloud API Message
// Deploy with JWT verification ENABLED (default):
//   supabase functions deploy whatsapp-send-message

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { logEvent, maskPhone } from '../_shared/logger.ts';
import {
  corsHeaders,
  getMetaRuntimeConfig,
  jsonResponse,
  normalizePhoneToE164,
  normalizeWaId,
  sendMetaWhatsAppMessage,
} from '../_shared/metaCloudApi.ts';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

    // 2. Parse and validate request payload
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
    const { data: membership } = await serviceClient
      .from('business_members')
      .select('role, status')
      .eq('business_id', businessId)
      .eq('user_id', callerId)
      .maybeSingle();

    if (!membership || membership.status !== 'active' || (membership.role !== 'admin' && membership.role !== 'agent')) {
      logEvent('permission_error', 'warn', 'Unauthorized send attempt', { callerId, businessId });
      return jsonResponse({ ok: false, code: 'FORBIDDEN', error: 'You are not authorized for this workspace.' }, 403);
    }

    if (
      membership.role === 'agent' &&
      conversation.assigned_to !== null &&
      conversation.assigned_to !== callerId
    ) {
      logEvent('permission_error', 'warn', 'Agent attempted send on conversation assigned to another user', {
        callerId,
        conversationId,
      });
      return jsonResponse(
        { ok: false, code: 'CONVERSATION_ASSIGNED_TO_OTHER', error: 'This conversation is assigned to another team member.' },
        403
      );
    }

    // 5. Idempotency check (prevent duplicate sends on double-clicks / retries)
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

    // 6. Load business WhatsApp account & runtime Meta config
    const { data: waAccount } = await serviceClient
      .from('whatsapp_accounts')
      .select('*')
      .eq('business_id', businessId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    const metaConfig = getMetaRuntimeConfig({
      phoneNumberId: waAccount?.meta_phone_number_id ? String(waAccount.meta_phone_number_id) : undefined,
      wabaId: waAccount?.meta_waba_id ? String(waAccount.meta_waba_id) : undefined,
      graphApiVersion: waAccount?.graph_api_version ? String(waAccount.graph_api_version) : undefined,
    });

    if (!metaConfig.accessToken || !metaConfig.phoneNumberId) {
      return jsonResponse(
        {
          ok: false,
          code: 'META_NOT_CONFIGURED',
          error: 'Meta WhatsApp Cloud API credentials are not configured on the server.',
        },
        422
      );
    }

    if (waAccount && waAccount.connection_status !== 'connected') {
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
    const messagingMode = waAccount?.messaging_mode === 'live' ? 'live' : 'test';
    if (messagingMode === 'test') {
      const allowlist = Array.isArray(waAccount?.test_allowlist)
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
    const pendingInsert = {
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
    };

    const { data: createdMsg, error: insErr } = await serviceClient
      .from('messages')
      .insert(pendingInsert)
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
    const metaResult = await sendMetaWhatsAppMessage({
      config: metaConfig,
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

    // 13. Meta accepted message -> mark strictly as 'submitted' (wait for real webhook for sent/delivered/read)
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
