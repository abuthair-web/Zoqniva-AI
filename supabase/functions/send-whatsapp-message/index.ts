// Deprecated legacy endpoint — replaced by supabase/functions/whatsapp-send-message.
// Standalone stub so it has zero external relative imports.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve((req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  return new Response(
    JSON.stringify({
      ok: false,
      code: 'ENDPOINT_DEPRECATED',
      error: 'Use the whatsapp-send-message Edge Function for authenticated 1-to-1 WhatsApp delivery.',
    }),
    {
      status: 410,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    }
  );
});
