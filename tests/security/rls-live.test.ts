import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * LIVE SUPABASE MULTI-ROLE RLS SECURITY TEST SUITE (Phase 6)
 *
 * Strictly gated behind `ALLOW_LIVE_TEST_DB=true` and dedicated NON-PRODUCTION
 * staging test user accounts. Never executes against production.
 *
 * Tests all 5 required security roles:
 * 1. Business A Administrator (active admin)
 * 2. Business A Staff / Agent (active agent)
 * 3. Business B Administrator (active admin in isolated tenant B)
 * 4. Unauthenticated Visitor (anon client)
 * 5. Inactive / Suspended Staff Member (is_active = false in Business A)
 */

const LIVE_ENABLED =
  process.env.ALLOW_LIVE_TEST_DB === 'true' &&
  Boolean(process.env.TEST_SUPABASE_URL) &&
  Boolean(process.env.TEST_SUPABASE_PUBLISHABLE_KEY) &&
  Boolean(process.env.TEST_BUSINESS_A_ID) &&
  Boolean(process.env.TEST_BUSINESS_B_ID) &&
  Boolean(process.env.TEST_ADMIN_A_EMAIL) &&
  Boolean(process.env.TEST_ADMIN_A_PASSWORD) &&
  Boolean(process.env.TEST_AGENT_A_EMAIL) &&
  Boolean(process.env.TEST_AGENT_A_PASSWORD) &&
  Boolean(process.env.TEST_ADMIN_B_EMAIL) &&
  Boolean(process.env.TEST_ADMIN_B_PASSWORD) &&
  Boolean(process.env.TEST_INACTIVE_EMAIL) &&
  Boolean(process.env.TEST_INACTIVE_PASSWORD);

function makeClient(): SupabaseClient {
  return createClient(
    process.env.TEST_SUPABASE_URL!,
    process.env.TEST_SUPABASE_PUBLISHABLE_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  );
}

describe.runIf(LIVE_ENABLED)('Live Supabase 5-Role RLS & Multi-Tenant Security Suite', () => {
  const businessA = process.env.TEST_BUSINESS_A_ID!;
  const businessB = process.env.TEST_BUSINESS_B_ID!;

  let anonClient: SupabaseClient;
  let adminAClient: SupabaseClient;
  let agentAClient: SupabaseClient;
  let adminBClient: SupabaseClient;
  let inactiveClient: SupabaseClient;

  let seededContactIdA: string | null = null;
  let seededTagIdA: string | null = null;
  const qaPhone = `+1555${String(Date.now()).slice(-7)}`;

  beforeAll(async () => {
    anonClient = makeClient();
    adminAClient = makeClient();
    agentAClient = makeClient();
    adminBClient = makeClient();
    inactiveClient = makeClient();

    const logins = await Promise.all([
      adminAClient.auth.signInWithPassword({
        email: process.env.TEST_ADMIN_A_EMAIL!,
        password: process.env.TEST_ADMIN_A_PASSWORD!,
      }),
      agentAClient.auth.signInWithPassword({
        email: process.env.TEST_AGENT_A_EMAIL!,
        password: process.env.TEST_AGENT_A_PASSWORD!,
      }),
      adminBClient.auth.signInWithPassword({
        email: process.env.TEST_ADMIN_B_EMAIL!,
        password: process.env.TEST_ADMIN_B_PASSWORD!,
      }),
      inactiveClient.auth.signInWithPassword({
        email: process.env.TEST_INACTIVE_EMAIL!,
        password: process.env.TEST_INACTIVE_PASSWORD!,
      }),
    ]);

    for (const res of logins) {
      if (res.error) {
        throw new Error(`Staging role sign-in failed: ${res.error.message}`);
      }
    }

    // Seed one isolated QA contact in Business A for cross-tenant & role assertions
    const { data: contact, error: contactErr } = await adminAClient
      .from('contacts')
      .insert({
        business_id: businessA,
        full_name: 'QA RLS Canary Contact',
        phone_e164: qaPhone,
        marketing_opt_in: false,
      })
      .select('id')
      .single();

    if (contactErr || !contact) {
      throw new Error(`Failed to seed Business A canary contact: ${contactErr?.message}`);
    }
    seededContactIdA = String(contact.id);

    const { data: tag } = await adminAClient
      .from('tags')
      .insert({
        business_id: businessA,
        name: `qa-rls-${Date.now()}`,
        color: '#2563EB',
      })
      .select('id')
      .maybeSingle();
    if (tag?.id) seededTagIdA = String(tag.id);
  });

  afterAll(async () => {
    if (seededContactIdA && adminAClient) {
      await adminAClient.from('contacts').delete().eq('id', seededContactIdA).eq('business_id', businessA);
    }
    if (seededTagIdA && adminAClient) {
      await adminAClient.from('tags').delete().eq('id', seededTagIdA).eq('business_id', businessA);
    }
  });

  it('Role 4 (Unauthenticated Visitor): cannot read or write any tenant CRM table', async () => {
    for (const table of ['contacts', 'campaigns', 'templates', 'businesses', 'business_members', 'whatsapp_accounts']) {
      const { data, error } = await anonClient.from(table).select('id').limit(5);
      // Either explicit RLS error or 0 visible rows
      expect(error ? 0 : (data ?? []).length, `anon saw rows in ${table}`).toBe(0);
    }

    const { error: insertErr } = await anonClient.from('contacts').insert({
      business_id: businessA,
      full_name: 'Anon Attack',
      phone_e164: '+15550009999',
    });
    expect(insertErr).not.toBeNull();
  });

  it('Role 3 (Business B Admin): cannot read, update, or delete Business A records', async () => {
    const { data: readA } = await adminBClient
      .from('contacts')
      .select('id')
      .eq('id', seededContactIdA!);
    expect(readA ?? []).toHaveLength(0);

    const { data: bizA } = await adminBClient
      .from('businesses')
      .select('id')
      .eq('id', businessA);
    expect(bizA ?? []).toHaveLength(0);

    const { data: updA } = await adminBClient
      .from('contacts')
      .update({ full_name: 'Cross-Tenant Tamper' })
      .eq('id', seededContactIdA!)
      .select('id');
    expect(updA ?? []).toHaveLength(0);

    const { data: delA } = await adminBClient
      .from('contacts')
      .delete()
      .eq('id', seededContactIdA!)
      .select('id');
    expect(delA ?? []).toHaveLength(0);

    // Cross-tenant insert into Business A must fail under RLS
    const { error: crossInsErr } = await adminBClient.from('contacts').insert({
      business_id: businessA,
      full_name: 'Cross-Tenant Inject',
      phone_e164: '+15550008888',
    });
    expect(crossInsErr).not.toBeNull();
  });

  it('Role 2 (Business A Agent): can read Business A contacts, cannot delete contacts or access admin team-members endpoint', async () => {
    const { data: readA, error: readErr } = await agentAClient
      .from('contacts')
      .select('id, full_name')
      .eq('id', seededContactIdA!)
      .maybeSingle();

    expect(readErr).toBeNull();
    expect(readA?.id).toBe(seededContactIdA);

    // Agent must not delete contacts (admin-only RLS policy)
    const { data: delData } = await agentAClient
      .from('contacts')
      .delete()
      .eq('id', seededContactIdA!)
      .select('id');
    expect(delData ?? []).toHaveLength(0);

    // Agent must not access admin-only team-members Edge Function
    const { data: teamData, error: teamErr } = await agentAClient.functions.invoke('team-members', {
      body: { businessId: businessA },
    });
    expect(teamErr !== null || (teamData as { ok?: boolean } | null)?.ok === false).toBe(true);
  });

  it('Role 5 (Inactive Staff Member): cannot read or write Business A tenant records', async () => {
    const { data: readContacts } = await inactiveClient
      .from('contacts')
      .select('id')
      .eq('business_id', businessA);
    expect(readContacts ?? []).toHaveLength(0);

    const { error: writeErr } = await inactiveClient.from('contacts').insert({
      business_id: businessA,
      full_name: 'Inactive User Insert',
      phone_e164: '+15550007777',
    });
    expect(writeErr).not.toBeNull();
  });

  it('Role 1 (Business A Admin): retains authorized visibility and cleanup control over Business A', async () => {
    const { data: readA, error } = await adminAClient
      .from('contacts')
      .select('id, business_id')
      .eq('id', seededContactIdA!)
      .single();

    expect(error).toBeNull();
    expect(readA?.id).toBe(seededContactIdA);
    expect(readA?.business_id).toBe(businessA);
  });
});
