// Supabase Edge Function: Sync Message Templates from Meta WhatsApp Business Account
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const metaAccessToken = Deno.env.get('META_WHATSAPP_ACCESS_TOKEN');
  const wabaId = Deno.env.get('META_WABA_ID');

  if (!metaAccessToken || !wabaId) {
    return new Response(
      JSON.stringify({
        error: 'META_WHATSAPP_ACCESS_TOKEN and META_WABA_ID must be configured in Supabase Secrets.',
        code: 'META_NOT_CONFIGURED',
      }),
      { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } }
  );

  const metaRes = await fetch(
    `https://graph.facebook.com/v21.0/${wabaId}/message_templates?limit=100`,
    { headers: { Authorization: `Bearer ${metaAccessToken}` } }
  );

  const metaJson = await metaRes.json();
  if (!metaRes.ok) {
    return new Response(JSON.stringify({ error: metaJson?.error?.message ?? 'Meta sync failed' }), {
      status: 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { data: userRes } = await supabase.auth.getUser();
  return new Response(
    JSON.stringify({
      syncedBy: userRes.user?.id,
      templatesCount: Array.isArray(metaJson.data) ? metaJson.data.length : 0,
      templates: metaJson.data ?? [],
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
});
