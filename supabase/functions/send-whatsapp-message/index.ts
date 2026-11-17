// Supabase Edge Function: Send Official WhatsApp Cloud API Message
// Enforces 24-hour customer service window and records honest delivery state.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const metaAccessToken = Deno.env.get('META_WHATSAPP_ACCESS_TOKEN');
    const phoneNumberId = Deno.env.get('META_PHONE_NUMBER_ID');

    if (!metaAccessToken || !phoneNumberId) {
      return new Response(
        JSON.stringify({
          error: 'Meta WhatsApp Cloud API credentials are not configured in Supabase Secrets.',
          code: 'META_NOT_CONFIGURED',
        }),
        { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { conversationId, messageType, body, templateName, language = 'en_US' } = await req.json();

    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .select('id, business_id, window_expires_at, contact:contacts(phone_e164)')
      .eq('id', conversationId)
      .single();

    if (convError || !conversation) {
      return new Response(JSON.stringify({ error: 'Conversation not found or unauthorized' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Enforce 24-hour customer service window
    const windowOpen =
      conversation.window_expires_at && new Date(conversation.window_expires_at).getTime() > Date.now();

    if (!windowOpen && messageType !== 'template') {
      return new Response(
        JSON.stringify({
          error: '24-hour customer service window has expired. An approved template message is required.',
          code: 'WINDOW_EXPIRED',
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const recipientPhone = (conversation.contact as { phone_e164: string }).phone_e164.replace('+', '');
    const metaPayload =
      messageType === 'template'
        ? {
            messaging_product: 'whatsapp',
            to: recipientPhone,
            type: 'template',
            template: { name: templateName, language: { code: language } },
          }
        : {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: recipientPhone,
            type: 'text',
            text: { preview_url: false, body },
          };

    const metaRes = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${metaAccessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(metaPayload),
    });

    const metaData = await metaRes.json();
    const metaMessageId = metaData?.messages?.[0]?.id ?? null;

    if (!metaRes.ok || !metaMessageId) {
      return new Response(
        JSON.stringify({
          error: metaData?.error?.message ?? 'Meta Cloud API rejected message',
          code: String(metaData?.error?.code ?? 'META_API_ERROR'),
        }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(JSON.stringify({ status: 'sent', metaMessageId }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
