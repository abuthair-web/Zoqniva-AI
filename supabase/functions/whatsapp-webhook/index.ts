// Supabase Edge Function: Official Meta WhatsApp Cloud API Webhook Receiver
// Deploy with: supabase functions deploy whatsapp-webhook --no-verify-jwt

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const VERIFY_TOKEN = Deno.env.get('META_WEBHOOK_VERIFY_TOKEN') ?? '';
const META_APP_SECRET = Deno.env.get('META_APP_SECRET') ?? '';

async function verifyMetaSignature(rawBody: string, signatureHeader: string | null): Promise<boolean> {
  if (!META_APP_SECRET || !signatureHeader?.startsWith('sha256=')) {
    return false;
  }
  const providedHex = signatureHeader.slice(7);
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(META_APP_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signatureBytes = await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody));
  const expectedHex = Array.from(new Uint8Array(signatureBytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return providedHex === expectedHex;
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);

  // 1. Meta Webhook Challenge Verification (GET)
  if (req.method === 'GET') {
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');

    if (mode === 'subscribe' && VERIFY_TOKEN && token === VERIFY_TOKEN && challenge) {
      return new Response(challenge, { status: 200 });
    }
    return new Response('Forbidden: Invalid verify token', { status: 403 });
  }

  // 2. Meta Webhook Event Ingestion (POST)
  if (req.method === 'POST') {
    const rawBody = await req.text();
    const signature = req.headers.get('x-hub-signature-256');
    const signatureValid = await verifyMetaSignature(rawBody, signature);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    let payload: Record<string, unknown> = {};

    try {
      payload = JSON.parse(rawBody);
    } catch {
      return new Response('Invalid JSON', { status: 400 });
    }

    await supabase.from('webhook_events').insert({
      provider: 'meta_whatsapp',
      event_type: 'whatsapp_webhook',
      signature_valid: signatureValid,
      processed: false,
      payload,
    });

    if (!signatureValid) {
      return new Response('Invalid webhook signature', { status: 401 });
    }

    // Process status updates (sent, delivered, read, failed) and inbound messages
    const entries = (payload.entry as Array<Record<string, unknown>>) ?? [];
    for (const entry of entries) {
      const changes = (entry.changes as Array<Record<string, unknown>>) ?? [];
      for (const change of changes) {
        const value = (change.value as Record<string, unknown>) ?? {};
        const statuses = (value.statuses as Array<Record<string, unknown>>) ?? [];

        for (const statusItem of statuses) {
          const metaMessageId = String(statusItem.id ?? '');
          const status = String(statusItem.status ?? '');
          if (metaMessageId && ['sent', 'delivered', 'read', 'failed'].includes(status)) {
            const { data: msg } = await supabase
              .from('messages')
              .update({
                delivery_status: status,
                error_code: status === 'failed' ? String((statusItem.errors as Array<Record<string, unknown>>)?.[0]?.code ?? '') : null,
                error_message: status === 'failed' ? String((statusItem.errors as Array<Record<string, unknown>>)?.[0]?.title ?? 'Delivery failed') : null,
              })
              .eq('meta_message_id', metaMessageId)
              .select('id, business_id')
              .maybeSingle();

            if (msg) {
              await supabase.from('message_events').insert({
                business_id: msg.business_id,
                message_id: msg.id,
                event_type: status,
                raw_payload: statusItem,
              });
            }
          }
        }
      }
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response('Method Not Allowed', { status: 405 });
});
