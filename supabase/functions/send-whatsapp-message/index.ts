// Deprecated legacy endpoint — replaced by supabase/functions/whatsapp-send-message
import { corsHeaders, jsonResponse } from '../_shared/metaCloudApi.ts';

Deno.serve((req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  return jsonResponse(
    {
      ok: false,
      code: 'ENDPOINT_DEPRECATED',
      error: 'Use the whatsapp-send-message Edge Function for authenticated 1-to-1 WhatsApp delivery.',
    },
    410
  );
});
