// Supabase Edge Function: Official Meta WhatsApp Cloud API Webhook Receiver
// Deploy WITHOUT JWT verification so Meta Cloud API can reach it:
//   supabase functions deploy whatsapp-webhook --no-verify-jwt

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { logEvent, maskPhone } from '../_shared/logger.ts';
import {
  getMetaRuntimeConfig,
  jsonResponse,
  normalizePhoneToE164,
  normalizeWaId,
  shouldAdvanceStatus,
  verifyWebhookSignature,
} from '../_shared/metaCloudApi.ts';

function parseMetaTimestampIso(rawTs: unknown): string {
  const numeric = Number(rawTs);
  if (Number.isFinite(numeric) && numeric > 1_000_000_000) {
    return new Date(numeric * 1000).toISOString();
  }
  return new Date().toISOString();
}

function extractInboundContent(msg: Record<string, unknown>): {
  messageType: 'text' | 'image' | 'document' | 'audio' | 'video';
  body: string;
  mediaFilename?: string;
  metadata: Record<string, unknown>;
} {
  const rawType = String(msg.type ?? 'text');

  if (rawType === 'text') {
    const textObj = (msg.text as Record<string, unknown> | undefined) ?? {};
    return {
      messageType: 'text',
      body: String(textObj.body ?? '').trim() || '[Empty text message]',
      metadata: { raw_type: 'text' },
    };
  }

  if (rawType === 'button') {
    const btnObj = (msg.button as Record<string, unknown> | undefined) ?? {};
    return {
      messageType: 'text',
      body: String(btnObj.text ?? btnObj.payload ?? '[Button reply]'),
      metadata: { raw_type: 'button', payload: btnObj.payload ?? null },
    };
  }

  if (rawType === 'interactive') {
    const interObj = (msg.interactive as Record<string, unknown> | undefined) ?? {};
    const btnReply = interObj.button_reply as Record<string, unknown> | undefined;
    const listReply = interObj.list_reply as Record<string, unknown> | undefined;
    const label =
      (typeof btnReply?.title === 'string' && btnReply.title) ||
      (typeof listReply?.title === 'string' && listReply.title) ||
      '[Interactive reply]';
    return {
      messageType: 'text',
      body: label,
      metadata: {
        raw_type: 'interactive',
        interactive_type: interObj.type ?? null,
        reply_id: btnReply?.id ?? listReply?.id ?? null,
      },
    };
  }

  if (rawType === 'image' || rawType === 'document' || rawType === 'audio' || rawType === 'video') {
    const mediaObj = (msg[rawType] as Record<string, unknown> | undefined) ?? {};
    const caption = typeof mediaObj.caption === 'string' ? mediaObj.caption.trim() : '';
    const filename = typeof mediaObj.filename === 'string' ? mediaObj.filename.trim() : undefined;
    const fallbackLabel =
      rawType === 'image'
        ? '[Image received]'
        : rawType === 'document'
        ? `[Document received${filename ? `: ${filename}` : ''}]`
        : rawType === 'audio'
        ? '[Voice / audio message received]'
        : '[Video received]';

    return {
      messageType: rawType,
      body: caption || fallbackLabel,
      mediaFilename: filename,
      metadata: {
        raw_type: rawType,
        media_id: mediaObj.id ?? null,
        mime_type: mediaObj.mime_type ?? null,
        sha256: mediaObj.sha256 ?? null,
      },
    };
  }

  return {
    messageType: 'text',
    body: `[Unsupported WhatsApp message type: ${rawType}]`,
    metadata: { raw_type: rawType },
  };
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const config = getMetaRuntimeConfig();

  // 1. Meta Webhook Subscription Verification (GET)
  if (req.method === 'GET') {
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');

    if (
      mode === 'subscribe' &&
      config.webhookVerifyToken &&
      token === config.webhookVerifyToken &&
      challenge
    ) {
      logEvent('webhook_verify', 'info', 'Meta webhook verification succeeded');
      return new Response(challenge, {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      });
    }

    logEvent('webhook_verify', 'warn', 'Meta webhook verification failed', {
      mode,
      hasToken: Boolean(token),
      hasExpectedSecret: Boolean(config.webhookVerifyToken),
    });
    return new Response('Forbidden: Invalid verify token', { status: 403 });
  }

  // 2. Meta Webhook Event Ingestion (POST)
  if (req.method === 'POST') {
    const rawBody = await req.text();
    const signatureHeader = req.headers.get('x-hub-signature-256');
    const signatureValid = await verifyWebhookSignature(
      rawBody,
      signatureHeader,
      config.appSecret
    );

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!supabaseUrl || !supabaseServiceKey) {
      return jsonResponse({ error: 'Server configuration error' }, 500);
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      logEvent('invalid_request', 'warn', 'Webhook received invalid JSON payload');
      return jsonResponse({ error: 'Invalid JSON' }, 400);
    }

    const entries = Array.isArray(payload.entry)
      ? (payload.entry as Array<Record<string, unknown>>)
      : [];

    // Try resolving business_id from first phone_number_id for admin audit visibility
    let resolvedEventBusinessId: string | null = null;
    const firstPhoneId =
      (entries[0]?.changes as Array<Record<string, unknown>> | undefined)?.[0]?.value &&
      ((entries[0].changes as Array<Record<string, unknown>>)[0].value as Record<string, unknown>)
        ?.metadata &&
      (
        ((entries[0].changes as Array<Record<string, unknown>>)[0].value as Record<string, unknown>)
          .metadata as Record<string, unknown>
      )?.phone_number_id;

    if (firstPhoneId) {
      const { data: acc } = await supabase
        .from('whatsapp_accounts')
        .select('business_id')
        .eq('meta_phone_number_id', String(firstPhoneId))
        .limit(1)
        .maybeSingle();
      if (acc?.business_id) {
        resolvedEventBusinessId = String(acc.business_id);
      }
    }

    const { data: webhookEventRow } = await supabase
      .from('webhook_events')
      .insert({
        business_id: resolvedEventBusinessId,
        provider: 'meta_whatsapp',
        event_type: String(payload.object ?? 'whatsapp_business_account'),
        signature_valid: signatureValid,
        processed: false,
        payload,
      })
      .select('id')
      .maybeSingle();

    if (!signatureValid) {
      logEvent('permission_error', 'error', 'Rejected webhook with invalid X-Hub-Signature-256');
      return jsonResponse({ error: 'Invalid webhook signature' }, 401);
    }

    const processingErrors: string[] = [];

    for (const entry of entries) {
      const changes = Array.isArray(entry.changes)
        ? (entry.changes as Array<Record<string, unknown>>)
        : [];

      for (const change of changes) {
        if (change.field && change.field !== 'messages') continue;
        const value = (change.value as Record<string, unknown> | undefined) ?? {};
        const metadata = (value.metadata as Record<string, unknown> | undefined) ?? {};
        const phoneNumberId = metadata.phone_number_id ? String(metadata.phone_number_id) : '';

        // Resolve matching business WhatsApp account
        let waAccount: Record<string, unknown> | null = null;
        if (phoneNumberId) {
          const { data: accData } = await supabase
            .from('whatsapp_accounts')
            .select('id, business_id, webhook_verified_at')
            .eq('meta_phone_number_id', phoneNumberId)
            .limit(1)
            .maybeSingle();
          waAccount = (accData as Record<string, unknown> | null) ?? null;

          if (waAccount && !waAccount.webhook_verified_at) {
            await supabase
              .from('whatsapp_accounts')
              .update({ webhook_verified_at: new Date().toISOString() })
              .eq('id', String(waAccount.id));
          }
        }

        // A. PROCESS INBOUND CUSTOMER MESSAGES (No auto-replies)
        const inboundMessages = Array.isArray(value.messages)
          ? (value.messages as Array<Record<string, unknown>>)
          : [];
        const webhookContacts = Array.isArray(value.contacts)
          ? (value.contacts as Array<Record<string, unknown>>)
          : [];

        if (inboundMessages.length > 0) {
          if (!waAccount?.business_id) {
            processingErrors.push(
              `Unrecognized meta_phone_number_id "${phoneNumberId}" for inbound message.`
            );
            logEvent('invalid_request', 'warn', 'Inbound webhook for unmapped phone_number_id', {
              phoneNumberId,
            });
          } else {
            const businessId = String(waAccount.business_id);
            const waAccountId = String(waAccount.id);

            for (const inbound of inboundMessages) {
              const metaMessageId = inbound.id ? String(inbound.id) : '';
              const fromRaw = String(inbound.from ?? '');
              const waId = normalizeWaId(fromRaw);
              const phoneE164 = normalizePhoneToE164(fromRaw);

              if (!metaMessageId || !waId || !phoneE164) {
                processingErrors.push('Inbound message missing valid id or sender phone.');
                continue;
              }

              // Deduplicate inbound message by meta_message_id
              const { data: duplicateMsg } = await supabase
                .from('messages')
                .select('id')
                .eq('meta_message_id', metaMessageId)
                .maybeSingle();

              if (duplicateMsg) {
                logEvent('duplicate_event', 'info', 'Skipped duplicate inbound webhook message', {
                  metaMessageId,
                });
                continue;
              }

              const matchingProfile = webhookContacts.find(
                (wc) => normalizeWaId(String(wc.wa_id ?? '')) === waId
              );
              const profileName =
                typeof (matchingProfile?.profile as Record<string, unknown> | undefined)?.name ===
                'string'
                  ? String((matchingProfile!.profile as Record<string, unknown>).name).trim()
                  : '';

              // Find or create contact (never silently opt-in for marketing on inbound!)
              let contactId: string | null = null;
              const { data: existingByWa } = await supabase
                .from('contacts')
                .select('id, wa_id, full_name')
                .eq('business_id', businessId)
                .eq('wa_id', waId)
                .maybeSingle();

              if (existingByWa) {
                contactId = String(existingByWa.id);
              } else {
                const { data: existingByPhone } = await supabase
                  .from('contacts')
                  .select('id, wa_id, full_name')
                  .eq('business_id', businessId)
                  .eq('phone_e164', phoneE164)
                  .maybeSingle();

                if (existingByPhone) {
                  contactId = String(existingByPhone.id);
                  if (!existingByPhone.wa_id) {
                    await supabase
                      .from('contacts')
                      .update({ wa_id: waId })
                      .eq('id', contactId);
                  }
                } else {
                  const { data: createdContact, error: createContactErr } = await supabase
                    .from('contacts')
                    .insert({
                      business_id: businessId,
                      full_name: profileName || phoneE164,
                      phone_e164: phoneE164,
                      wa_id: waId,
                      marketing_opt_in: false,
                      notes: 'Auto-created from inbound WhatsApp message',
                    })
                    .select('id')
                    .single();

                  if (createContactErr?.code === '23505') {
                    const { data: raceContact } = await supabase
                      .from('contacts')
                      .select('id')
                      .eq('business_id', businessId)
                      .eq('phone_e164', phoneE164)
                      .maybeSingle();
                    contactId = raceContact?.id ? String(raceContact.id) : null;
                  } else if (createdContact?.id) {
                    contactId = String(createdContact.id);
                  }
                }
              }

              if (!contactId) {
                processingErrors.push(`Failed to resolve contact for ${maskPhone(phoneE164)}`);
                continue;
              }

              const msgTimestampIso = parseMetaTimestampIso(inbound.timestamp);
              const windowExpiresIso = new Date(
                new Date(msgTimestampIso).getTime() + 24 * 60 * 60 * 1000
              ).toISOString();

              const extracted = extractInboundContent(inbound);
              const preview = extracted.body.slice(0, 140);

              // Find existing conversation for contact or create one
              const { data: existingConv } = await supabase
                .from('conversations')
                .select('id, status, unread_count')
                .eq('business_id', businessId)
                .eq('contact_id', contactId)
                .order('last_message_at', { ascending: false })
                .limit(1)
                .maybeSingle();

              let conversationId: string | null = null;
              if (existingConv) {
                conversationId = String(existingConv.id);
                await supabase
                  .from('conversations')
                  .update({
                    whatsapp_account_id: waAccountId,
                    status: existingConv.status === 'resolved' ? 'open' : existingConv.status,
                    unread_count: Number(existingConv.unread_count ?? 0) + 1,
                    last_customer_message_at: msgTimestampIso,
                    window_expires_at: windowExpiresIso,
                    last_message_preview: preview,
                    last_message_at: msgTimestampIso,
                  })
                  .eq('id', conversationId);
              } else {
                const { data: createdConv } = await supabase
                  .from('conversations')
                  .insert({
                    business_id: businessId,
                    contact_id: contactId,
                    whatsapp_account_id: waAccountId,
                    status: 'open',
                    unread_count: 1,
                    last_customer_message_at: msgTimestampIso,
                    window_expires_at: windowExpiresIso,
                    last_message_preview: preview,
                    last_message_at: msgTimestampIso,
                  })
                  .select('id')
                  .single();
                conversationId = createdConv?.id ? String(createdConv.id) : null;
              }

              if (!conversationId) {
                processingErrors.push(`Failed to resolve conversation for ${maskPhone(phoneE164)}`);
                continue;
              }

              const { error: msgInsertErr } = await supabase.from('messages').insert({
                business_id: businessId,
                conversation_id: conversationId,
                sender_type: 'contact',
                sender_profile_id: null,
                direction: 'inbound',
                message_type: extracted.messageType,
                body: extracted.body,
                media_filename: extracted.mediaFilename ?? null,
                meta_message_id: metaMessageId,
                delivery_status: 'delivered',
                metadata: extracted.metadata,
                created_at: msgTimestampIso,
              });

              if (msgInsertErr && msgInsertErr.code !== '23505') {
                processingErrors.push(`Failed inserting inbound message: ${msgInsertErr.message}`);
              } else {
                logEvent('webhook_inbound', 'info', 'Stored inbound customer WhatsApp message', {
                  businessId,
                  conversationId,
                  metaMessageId,
                  messageType: extracted.messageType,
                  sender: maskPhone(phoneE164),
                });
              }
            }
          }
        }

        // B. PROCESS DELIVERY STATUS UPDATES (sent, delivered, read, failed)
        const statuses = Array.isArray(value.statuses)
          ? (value.statuses as Array<Record<string, unknown>>)
          : [];

        for (const statusItem of statuses) {
          const metaMessageId = String(statusItem.id ?? '').trim();
          const nextStatus = String(statusItem.status ?? '').trim().toLowerCase();
          if (
            !metaMessageId ||
            !['sent', 'delivered', 'read', 'failed'].includes(nextStatus)
          ) {
            continue;
          }

          const { data: existingMsg } = await supabase
            .from('messages')
            .select('id, business_id, delivery_status')
            .eq('meta_message_id', metaMessageId)
            .maybeSingle();

          if (!existingMsg) {
            logEvent('status_update', 'warn', 'Received status webhook for unknown meta_message_id', {
              metaMessageId,
              nextStatus,
            });
            continue;
          }

          const statusTimestampIso = parseMetaTimestampIso(statusItem.timestamp);

          // Record deduplicated lifecycle event
          const { error: eventErr } = await supabase.from('message_events').insert({
            business_id: existingMsg.business_id,
            message_id: existingMsg.id,
            event_type: nextStatus,
            meta_status_timestamp: statusTimestampIso,
            occurred_at: statusTimestampIso,
            raw_payload: statusItem,
          });

          if (eventErr?.code === '23505') {
            logEvent('duplicate_event', 'info', 'Ignored duplicate status event', {
              metaMessageId,
              nextStatus,
            });
            continue;
          }

          if (!shouldAdvanceStatus(String(existingMsg.delivery_status), nextStatus)) {
            logEvent('duplicate_event', 'info', 'Ignored out-of-order lower status transition', {
              metaMessageId,
              currentStatus: existingMsg.delivery_status,
              incomingStatus: nextStatus,
            });
            continue;
          }

          const errItem = Array.isArray(statusItem.errors)
            ? (statusItem.errors[0] as Record<string, unknown> | undefined)
            : undefined;

          const updatePatch: Record<string, unknown> = {
            delivery_status: nextStatus,
            last_status_at: statusTimestampIso,
          };

          if (nextStatus === 'sent') {
            updatePatch.sent_at = statusTimestampIso;
            updatePatch.error_code = null;
            updatePatch.error_message = null;
          } else if (nextStatus === 'delivered') {
            updatePatch.delivered_at = statusTimestampIso;
            updatePatch.error_code = null;
            updatePatch.error_message = null;
          } else if (nextStatus === 'read') {
            updatePatch.read_at = statusTimestampIso;
            updatePatch.error_code = null;
            updatePatch.error_message = null;
          } else if (nextStatus === 'failed') {
            updatePatch.failed_at = statusTimestampIso;
            updatePatch.error_code = errItem?.code ? String(errItem.code) : 'META_DELIVERY_FAILED';
            updatePatch.error_message =
              typeof errItem?.title === 'string'
                ? errItem.title
                : typeof errItem?.message === 'string'
                ? errItem.message
                : 'Message could not be delivered by WhatsApp.';
          }

          await supabase
            .from('messages')
            .update(updatePatch)
            .eq('id', existingMsg.id);

          logEvent('status_update', 'info', 'Updated WhatsApp message delivery status', {
            messageId: existingMsg.id,
            metaMessageId,
            fromStatus: existingMsg.delivery_status,
            toStatus: nextStatus,
          });
        }
      }
    }

    if (webhookEventRow?.id) {
      await supabase
        .from('webhook_events')
        .update({
          processed: processingErrors.length === 0,
          processed_at: new Date().toISOString(),
          processing_error:
            processingErrors.length > 0 ? processingErrors.join(' | ').slice(0, 500) : null,
        })
        .eq('id', webhookEventRow.id);
    }

    return jsonResponse({ received: true });
  }

  return new Response('Method Not Allowed', { status: 405 });
});
