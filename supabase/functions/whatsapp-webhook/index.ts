// Supabase Edge Function: Official Meta WhatsApp Cloud API Webhook Receiver
// Standalone single-file build for Supabase Dashboard -> Edge Functions -> Via Editor.
// IMPORTANT: Disable "Enforce JWT Verification" (--no-verify-jwt) for this function
// so Meta Cloud API can call GET (verification) and POST (signed webhooks).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const MAX_WEBHOOK_BODY_BYTES = 512 * 1024; // 512 KB safety guard

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-hub-signature-256',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

const SENSITIVE_KEY_PATTERN =
  /token|secret|authorization|password|apikey|api_key|signature|verify_token|body|message_text|content/i;

function sanitizeValue(key: string, value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (SENSITIVE_KEY_PATTERN.test(key)) {
    return typeof value === 'string' ? `[REDACTED len=${value.length}]` : '[REDACTED]';
  }
  if (typeof value === 'string') {
    if (value.startsWith('Bearer ')) return 'Bearer [REDACTED]';
    if (value.startsWith('EAAG') || value.startsWith('EAA')) return '[REDACTED_META_TOKEN]';
    return value.length > 240 ? `${value.slice(0, 240)}...` : value;
  }
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizeValue(key, item));
  if (typeof value === 'object') return sanitizeContext(value as Record<string, unknown>);
  return value;
}

function sanitizeContext(context: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(context)) {
    out[k] = sanitizeValue(k, v);
  }
  return out;
}

function maskPhone(phone?: string | null): string | undefined {
  if (!phone) return undefined;
  const trimmed = phone.trim();
  return trimmed.length <= 4 ? '****' : `***${trimmed.slice(-4)}`;
}

function logEvent(
  category:
    | 'webhook_verify'
    | 'webhook_inbound'
    | 'status_update'
    | 'permission_error'
    | 'duplicate_event'
    | 'invalid_request'
    | 'db_error',
  level: 'info' | 'warn' | 'error',
  message: string,
  context: Record<string, unknown> = {}
): void {
  const entry = {
    ts: new Date().toISOString(),
    category,
    level,
    message,
    ...sanitizeContext(context),
  };
  if (level === 'error') console.error(JSON.stringify(entry));
  else if (level === 'warn') console.warn(JSON.stringify(entry));
  else console.info(JSON.stringify(entry));
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string
): Promise<boolean> {
  if (!appSecret || !signatureHeader || !signatureHeader.startsWith('sha256=')) {
    return false;
  }
  const providedHex = signatureHeader.slice(7).trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(providedHex)) {
    return false;
  }

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(appSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signatureBytes = await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody));
  const expectedHex = Array.from(new Uint8Array(signatureBytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return constantTimeEqual(providedHex, expectedHex);
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

  if (rawType === 'location') {
    const locObj = (msg.location as Record<string, unknown> | undefined) ?? {};
    const locLabel = [locObj.name, locObj.address].filter((v) => typeof v === 'string' && v.trim()).join(' — ');
    return {
      messageType: 'text',
      body: locLabel ? `[Location shared: ${locLabel}]` : '[Location shared]',
      metadata: {
        raw_type: 'location',
        latitude: locObj.latitude ?? null,
        longitude: locObj.longitude ?? null,
      },
    };
  }

  if (rawType === 'reaction') {
    const reactObj = (msg.reaction as Record<string, unknown> | undefined) ?? {};
    const emoji = typeof reactObj.emoji === 'string' && reactObj.emoji ? reactObj.emoji : '';
    return {
      messageType: 'text',
      body: emoji ? `[Reacted with ${emoji}]` : '[Removed reaction]',
      metadata: { raw_type: 'reaction', target_message_id: reactObj.message_id ?? null },
    };
  }

  return {
    messageType: 'text',
    body: `[Unsupported WhatsApp message type: ${rawType}]`,
    metadata: { raw_type: rawType },
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const webhookVerifyToken = Deno.env.get('META_WEBHOOK_VERIFY_TOKEN')?.trim() ?? '';
  const appSecret = Deno.env.get('META_APP_SECRET')?.trim() ?? '';

  // 1. Meta Webhook Subscription Verification (GET)
  if (req.method === 'GET') {
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token') ?? '';
    const challenge = url.searchParams.get('hub.challenge') ?? '';

    if (
      mode === 'subscribe' &&
      webhookVerifyToken.length > 0 &&
      challenge.length > 0 &&
      constantTimeEqual(token, webhookVerifyToken)
    ) {
      logEvent('webhook_verify', 'info', 'Meta webhook verification succeeded');
      return new Response(challenge, {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      });
    }

    logEvent('webhook_verify', 'warn', 'Meta webhook verification failed', {
      mode,
      hasToken: token.length > 0,
      hasExpectedSecret: webhookVerifyToken.length > 0,
    });
    return new Response('Forbidden: Invalid verify token', { status: 403 });
  }

  // 2. Meta Webhook Event Ingestion (POST)
  if (req.method === 'POST') {
    const contentLengthHeader = Number(req.headers.get('content-length') ?? '0');
    if (Number.isFinite(contentLengthHeader) && contentLengthHeader > MAX_WEBHOOK_BODY_BYTES) {
      logEvent('invalid_request', 'warn', 'Rejected oversized webhook payload', {
        contentLength: contentLengthHeader,
      });
      return jsonResponse({ error: 'Payload too large' }, 413);
    }

    const rawBody = await req.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_WEBHOOK_BODY_BYTES) {
      logEvent('invalid_request', 'warn', 'Rejected oversized raw webhook body');
      return jsonResponse({ error: 'Payload too large' }, 413);
    }

    if (!appSecret) {
      logEvent('permission_error', 'error', 'META_APP_SECRET is missing on webhook server');
      return jsonResponse({ error: 'Webhook signature secret is not configured' }, 500);
    }

    // CRITICAL: Verify X-Hub-Signature-256 BEFORE parsing or storing ANY webhook payload
    const signatureHeader = req.headers.get('x-hub-signature-256');
    const signatureValid = await verifyWebhookSignature(rawBody, signatureHeader, appSecret);
    if (!signatureValid) {
      logEvent('permission_error', 'error', 'Rejected webhook with missing or invalid X-Hub-Signature-256');
      return jsonResponse({ error: 'Invalid webhook signature' }, 401);
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      logEvent('invalid_request', 'warn', 'Verified webhook contained invalid JSON payload');
      return jsonResponse({ error: 'Invalid JSON' }, 400);
    }

    if (payload.object !== 'whatsapp_business_account' || !Array.isArray(payload.entry)) {
      logEvent('invalid_request', 'warn', 'Unexpected webhook payload structure', {
        objectType: String(payload.object ?? ''),
      });
      return jsonResponse({ error: 'Invalid WhatsApp webhook structure' }, 400);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!supabaseUrl || !supabaseServiceKey) {
      return jsonResponse({ error: 'Server configuration error' }, 500);
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const entries = payload.entry as Array<Record<string, unknown>>;

    // Helper to resolve whatsapp_accounts row by phone_number_id or meta_phone_number_id safely
    const findAccountByPhoneId = async (phoneId: string) => {
      for (const col of ['phone_number_id', 'meta_phone_number_id'] as const) {
        const { data, error } = await supabase
          .from('whatsapp_accounts')
          .select('*')
          .eq(col, phoneId)
          .limit(1)
          .maybeSingle();
        if (!error && data) {
          return { data: data as Record<string, unknown>, error: null };
        }
        if (error && error.code !== '42703' && error.code !== 'PGRST204') {
          return { data: null, error };
        }
      }
      return { data: null, error: null };
    };

    // Resolve business_id from first phone_number_id for diagnostic audit visibility
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
      const { data: acc } = await findAccountByPhoneId(String(firstPhoneId));
      if (acc?.business_id) {
        resolvedEventBusinessId = String(acc.business_id);
      }
    }

    // Store ONLY signature-verified payloads
    const { data: webhookEventRow } = await supabase
      .from('webhook_events')
      .insert({
        business_id: resolvedEventBusinessId,
        provider: 'meta_whatsapp',
        event_type: String(payload.object),
        signature_valid: true,
        processed: false,
        payload,
      })
      .select('id')
      .maybeSingle();

    const processingWarnings: string[] = [];
    const transientDbErrors: string[] = [];

    for (const entry of entries) {
      const entryWabaId = entry.id ? String(entry.id) : '';
      const changes = Array.isArray(entry.changes)
        ? (entry.changes as Array<Record<string, unknown>>)
        : [];

      for (const change of changes) {
        if (change.field && change.field !== 'messages') continue;
        const value = (change.value as Record<string, unknown> | undefined) ?? {};
        const metadata = (value.metadata as Record<string, unknown> | undefined) ?? {};
        const phoneNumberId = metadata.phone_number_id ? String(metadata.phone_number_id) : '';

        let waAccount: Record<string, unknown> | null = null;
        if (phoneNumberId) {
          const { data: accData, error: accErr } = await findAccountByPhoneId(phoneNumberId);

          if (accErr) {
            transientDbErrors.push(`whatsapp_accounts lookup failed: ${accErr.message}`);
            continue;
          }

          waAccount = accData;

          if (waAccount) {
            const storedWabaId = String(
              waAccount.waba_id ??
                waAccount.meta_waba_id ??
                waAccount.whatsapp_business_account_id ??
                ''
            ).trim();
            if (entryWabaId && storedWabaId && storedWabaId !== entryWabaId) {
              logEvent('invalid_request', 'warn', 'Webhook WABA ID differs from stored whatsapp_accounts WABA ID', {
                entryWabaId,
                storedWabaId,
                phoneNumberId,
              });
            }

            if ('webhook_verified_at' in waAccount && !waAccount.webhook_verified_at) {
              await supabase
                .from('whatsapp_accounts')
                .update({ webhook_verified_at: new Date().toISOString() })
                .eq('id', String(waAccount.id));
            }
          }
        }

        // A. INBOUND CUSTOMER MESSAGES (No auto-replies)
        const inboundMessages = Array.isArray(value.messages)
          ? (value.messages as Array<Record<string, unknown>>)
          : [];
        const webhookContacts = Array.isArray(value.contacts)
          ? (value.contacts as Array<Record<string, unknown>>)
          : [];

        if (inboundMessages.length > 0) {
          if (!waAccount?.business_id) {
            processingWarnings.push(`Unmapped meta_phone_number_id "${phoneNumberId}" for inbound message.`);
            logEvent('invalid_request', 'warn', 'Inbound webhook for unmapped phone_number_id', {
              phoneNumberId,
            });
          } else {
            const businessId = String(waAccount.business_id);
            const waAccountId = String(waAccount.id);

            for (const inbound of inboundMessages) {
              const metaMessageId = inbound.id ? String(inbound.id).trim() : '';
              const fromRaw = String(inbound.from ?? '');
              const waId = normalizeWaId(fromRaw);
              const phoneE164 = normalizePhoneToE164(fromRaw);

              if (!metaMessageId || !waId || !phoneE164) {
                processingWarnings.push('Skipped inbound item missing valid id or sender phone.');
                continue;
              }

              const matchingProfile = webhookContacts.find(
                (wc) => normalizeWaId(String(wc.wa_id ?? '')) === waId
              );
              const profileName =
                typeof (matchingProfile?.profile as Record<string, unknown> | undefined)?.name === 'string'
                  ? String((matchingProfile!.profile as Record<string, unknown>).name).trim()
                  : '';

              const msgTimestampIso = parseMetaTimestampIso(inbound.timestamp);
              const extracted = extractInboundContent(inbound);

              const { data: rpcResult, error: rpcErr } = await supabase.rpc(
                'process_whatsapp_inbound_message',
                {
                  p_business_id: businessId,
                  p_wa_account_id: waAccountId,
                  p_wa_id: waId,
                  p_phone_e164: phoneE164,
                  p_profile_name: profileName,
                  p_meta_message_id: metaMessageId,
                  p_message_type: extracted.messageType,
                  p_body: extracted.body,
                  p_media_filename: extracted.mediaFilename ?? null,
                  p_metadata: extracted.metadata,
                  p_msg_timestamp: msgTimestampIso,
                }
              );

              if (rpcErr) {
                transientDbErrors.push(`Inbound RPC error: ${rpcErr.message}`);
                logEvent('db_error', 'error', 'Failed atomic inbound message RPC', {
                  metaMessageId,
                  error: rpcErr.message,
                });
              } else if (rpcResult && (rpcResult as Record<string, unknown>).duplicate) {
                logEvent('duplicate_event', 'info', 'Skipped duplicate inbound webhook message', {
                  metaMessageId,
                });
              } else {
                logEvent('webhook_inbound', 'info', 'Stored inbound customer WhatsApp message', {
                  businessId,
                  conversationId: (rpcResult as Record<string, unknown> | null)?.conversation_id,
                  metaMessageId,
                  messageType: extracted.messageType,
                  sender: maskPhone(phoneE164),
                });
              }
            }
          }
        }

        // B. DELIVERY STATUS UPDATES (sent, delivered, read, failed)
        const statuses = Array.isArray(value.statuses)
          ? (value.statuses as Array<Record<string, unknown>>)
          : [];

        for (const statusItem of statuses) {
          const metaMessageId = String(statusItem.id ?? '').trim();
          const nextStatus = String(statusItem.status ?? '').trim().toLowerCase();
          if (!metaMessageId || !['sent', 'delivered', 'read', 'failed'].includes(nextStatus)) {
            continue;
          }

          const statusTimestampIso = parseMetaTimestampIso(statusItem.timestamp);
          const errItem = Array.isArray(statusItem.errors)
            ? (statusItem.errors[0] as Record<string, unknown> | undefined)
            : undefined;
          const errCode = errItem?.code ? String(errItem.code) : null;
          const errMsg =
            typeof errItem?.title === 'string'
              ? errItem.title
              : typeof errItem?.message === 'string'
              ? errItem.message
              : null;

          const { data: statusRes, error: statusErr } = await supabase.rpc(
            'process_whatsapp_status_event',
            {
              p_meta_message_id: metaMessageId,
              p_next_status: nextStatus,
              p_status_timestamp: statusTimestampIso,
              p_error_code: errCode,
              p_error_message: errMsg,
              p_raw_payload: statusItem,
            }
          );

          if (statusErr) {
            transientDbErrors.push(`Status RPC error: ${statusErr.message}`);
            logEvent('db_error', 'error', 'Failed atomic status RPC', {
              metaMessageId,
              nextStatus,
              error: statusErr.message,
            });
            continue;
          }

          const resObj = (statusRes as Record<string, unknown> | null) ?? {};
          if (resObj.found === false) {
            logEvent('status_update', 'warn', 'Received status webhook for unknown meta_message_id', {
              metaMessageId,
              nextStatus,
            });
          } else if (resObj.duplicate === true) {
            logEvent('duplicate_event', 'info', 'Ignored duplicate status event', {
              metaMessageId,
              nextStatus,
            });
          } else if (resObj.advanced === false) {
            logEvent('duplicate_event', 'info', 'Ignored out-of-order lower status transition', {
              metaMessageId,
              currentStatus: resObj.from_status,
              incomingStatus: nextStatus,
            });
          } else {
            logEvent('status_update', 'info', 'Updated WhatsApp message delivery status', {
              messageId: resObj.message_id,
              metaMessageId,
              fromStatus: resObj.from_status,
              toStatus: resObj.to_status,
            });
          }
        }
      }
    }

    const allDiagnostics = [...transientDbErrors, ...processingWarnings];
    if (webhookEventRow?.id) {
      await supabase
        .from('webhook_events')
        .update({
          processed: transientDbErrors.length === 0 && processingWarnings.length === 0,
          processed_at: new Date().toISOString(),
          processing_error:
            allDiagnostics.length > 0 ? allDiagnostics.join(' | ').slice(0, 500) : null,
        })
        .eq('id', webhookEventRow.id);
    }

    if (transientDbErrors.length > 0) {
      return jsonResponse({ received: false, error: 'Temporary database persistence failure' }, 500);
    }

    return jsonResponse({ received: true });
  }

  return new Response('Method Not Allowed', { status: 405 });
});
