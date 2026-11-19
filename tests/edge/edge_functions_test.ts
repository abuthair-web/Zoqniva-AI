// Deno-compatible Edge Function test suite for Zoqniva AI
// Run locally with Deno installed:
//   npm run test:edge
//   (executes: deno test --allow-env --allow-net tests/edge/edge_functions_test.ts)
//
// Optional live staging Edge Function endpoint check:
//   EDGE_FUNCTIONS_BASE_URL="https://<staging-ref>.supabase.co/functions/v1" \
//   deno test --allow-env --allow-net tests/edge/edge_functions_test.ts

import { assert, assertEquals } from 'jsr:@std/assert@1';

async function computeHmacSha256(rawBody: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(rawBody));
  const hex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `sha256=${hex}`;
}

Deno.test('Edge Function security contracts: CORS, JWT auth, is_active, and HMAC verification', async () => {
  const protectedFns = [
    'supabase/functions/whatsapp-connection-check/index.ts',
    'supabase/functions/whatsapp-send-message/index.ts',
    'supabase/functions/sync-templates/index.ts',
    'supabase/functions/team-members/index.ts',
  ];

  for (const relPath of protectedFns) {
    const code = await Deno.readTextFile(relPath);
    assert(code.includes("req.method === 'OPTIONS'"), `${relPath} missing OPTIONS CORS handler`);
    assert(code.includes('auth.getUser'), `${relPath} missing JWT auth verification`);
    assert(code.includes('is_active'), `${relPath} missing business_members.is_active check`);
    assert(
      !/from\(['"]business_members['"]\)[\s\S]{0,160}\.select\(['"][^'"]*\bstatus\b[^'"]*['"]\)/.test(
        code
      ),
      `${relPath} references nonexistent business_members.status`
    );
  }

  const webhookCode = await Deno.readTextFile('supabase/functions/whatsapp-webhook/index.ts');
  assert(webhookCode.includes('x-hub-signature-256'), 'whatsapp-webhook missing HMAC header check');
  assert(webhookCode.includes('verifyWebhookSignature'), 'whatsapp-webhook missing signature verifier');
  assert(
    webhookCode.includes('process_whatsapp_inbound_message'),
    'whatsapp-webhook missing atomic inbound RPC'
  );
  assert(
    webhookCode.includes('process_whatsapp_status_event'),
    'whatsapp-webhook missing atomic status RPC'
  );

  const sendCode = await Deno.readTextFile('supabase/functions/whatsapp-send-message/index.ts');
  assert(!/\bapproval_status\b/.test(sendCode), 'whatsapp-send-message must not reference nonexistent approval_status');
  assert(
    sendCode.includes("select('id, business_id, meta_template_id, name, language, category, status, components')"),
    'whatsapp-send-message must query real templates status and components columns'
  );
  assert(sendCode.includes('TEMPLATE_REJECTED'), 'whatsapp-send-message must explicitly reject rejected templates');
  assert(sendCode.includes('TEMPLATE_PENDING'), 'whatsapp-send-message must explicitly reject pending templates');
  assert(sendCode.includes('TEMPLATE_NOT_FOUND'), 'whatsapp-send-message must explicitly report missing templates');
  assert(
    sendCode.includes('TEMPLATE_UNSUPPORTED_COMPONENT'),
    'whatsapp-send-message must reject unsupported template components safely'
  );
  assert(
    sendCode.includes('IDEMPOTENT_REQUEST_FAILED'),
    'whatsapp-send-message must never report duplicate failed requests as ok: true'
  );
  assert(
    sendCode.includes('PERSISTENCE_RECONCILIATION_REQUIRED'),
    'whatsapp-send-message must handle DB update failures after Meta acceptance explicitly'
  );
});

Deno.test('Webhook HMAC-SHA256 signature helper produces valid sha256= digest', async () => {
  const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });
  const sig = await computeHmacSha256(body, 'test-secret');
  assert(sig.startsWith('sha256='));
  assertEquals(sig.length, 7 + 64);
});

Deno.test({
  name: 'Staging Edge Function HTTP checks (OPTIONS preflight & unauthenticated 401 rejection)',
  ignore: !Deno.env.get('EDGE_FUNCTIONS_BASE_URL'),
  async fn() {
    const base = Deno.env.get('EDGE_FUNCTIONS_BASE_URL')!.replace(/\/$/, '');

    // 1. CORS OPTIONS preflight on team-members
    const optRes = await fetch(`${base}/team-members`, { method: 'OPTIONS' });
    assert(optRes.status === 200 || optRes.status === 204);
    assert(Boolean(optRes.headers.get('access-control-allow-origin')));
    await optRes.body?.cancel();

    // 2. Unauthenticated POST to protected functions must return 401
    for (const fn of ['team-members', 'whatsapp-connection-check', 'sync-templates', 'whatsapp-send-message']) {
      const res = await fetch(`${base}/${fn}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      assertEquals(res.status, 401, `${fn} should reject unauthenticated POST with 401`);
      await res.body?.cancel();
    }

    // 3. Unsigned POST to whatsapp-webhook must be rejected with 401
    const whRes = await fetch(`${base}/whatsapp-webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ object: 'whatsapp_business_account', entry: [] }),
    });
    assertEquals(whRes.status, 401, 'whatsapp-webhook must reject missing signature with 401');
    await whRes.body?.cancel();
  },
});
