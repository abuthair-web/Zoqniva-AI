import { describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';

/**
 * EXPLICITLY INITIATED LIVE WHATSAPP CLOUD API SANDBOX TEST (Phase 5)
 *
 * NEVER runs in CI. Only runs when an engineer explicitly invokes:
 *   npm run test:live:whatsapp
 * with RUN_LIVE_WHATSAPP_TEST=true, staging Supabase credentials, and an
 * explicitly allowlisted LIVE_WHATSAPP_TEST_PHONE.
 *
 * SAFETY GUARANTEE: Never triggers bulk campaigns or sends to non-allowlisted phones.
 */

const LIVE_WA_ENABLED =
  process.env.RUN_LIVE_WHATSAPP_TEST === 'true' &&
  process.env.ALLOW_LIVE_TEST_DB === 'true' &&
  Boolean(process.env.TEST_SUPABASE_URL) &&
  Boolean(process.env.TEST_SUPABASE_PUBLISHABLE_KEY) &&
  Boolean(process.env.TEST_ADMIN_A_EMAIL) &&
  Boolean(process.env.TEST_ADMIN_A_PASSWORD) &&
  Boolean(process.env.LIVE_WHATSAPP_TEST_PHONE);

describe.runIf(LIVE_WA_ENABLED)('Explicit Live WhatsApp Cloud API Sandbox Verification', () => {
  it('verifies Meta WhatsApp connection & template sync without sending any bulk campaign', async () => {
    const client = createClient(
      process.env.TEST_SUPABASE_URL!,
      process.env.TEST_SUPABASE_PUBLISHABLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );

    const { error: loginErr } = await client.auth.signInWithPassword({
      email: process.env.TEST_ADMIN_A_EMAIL!,
      password: process.env.TEST_ADMIN_A_PASSWORD!,
    });
    expect(loginErr).toBeNull();

    // 1. Connection verification (read-only Meta Graph check; sends zero messages)
    const { data: connData, error: connErr } = await client.functions.invoke(
      'whatsapp-connection-check',
      { body: { action: 'verify' } }
    );
    expect(connErr).toBeNull();
    expect((connData as { ok?: boolean })?.ok).toBe(true);

    // 2. Template sync from Meta WABA
    const { data: syncData, error: syncErr } = await client.functions.invoke('sync-templates', {
      method: 'POST',
    });
    expect(syncErr).toBeNull();
    expect((syncData as { ok?: boolean })?.ok).toBe(true);

    // 3. Optional single 1-to-1 sandbox message ONLY if explicit conversation ID is supplied
    const testConvId = process.env.LIVE_WHATSAPP_TEST_CONVERSATION_ID?.trim();
    if (testConvId) {
      const clientRequestId = `qa-live-${Date.now()}`;
      const { data: sendData, error: sendErr } = await client.functions.invoke(
        'whatsapp-send-message',
        {
          body: {
            conversationId: testConvId,
            messageType: 'text',
            body: `Zoqniva QA single sandbox verification (${new Date().toISOString()})`,
            clientRequestId,
          },
        }
      );
      expect(sendErr).toBeNull();
      expect((sendData as { ok?: boolean })?.ok).toBe(true);
      expect((sendData as { deliveryStatus?: string })?.deliveryStatus).toBe('submitted');
      expect((sendData as { metaMessageId?: string })?.metaMessageId).toBeTruthy();
    }
  });
});
