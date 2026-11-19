-- ============================================================================
-- ZOQNIVA AI — SUPABASE pgTAP DATABASE CONSTRAINTS & 5-ROLE RLS TEST SUITE
-- ============================================================================
-- Run locally against a local Supabase instance:
--   supabase start
--   supabase test db
--
-- Wrapped in BEGIN ... ROLLBACK so ZERO test records are ever persisted.
-- Tests schema invariants, constraints, and all 5 required security roles:
--   1. Business A Administrator (active admin)
--   2. Business A Staff / Agent (active agent)
--   3. Business B Administrator (isolated tenant B)
--   4. Unauthenticated Visitor (anon)
--   5. Inactive Staff Member (is_active = false)
-- ============================================================================

BEGIN;

SELECT plan(24);

-- ----------------------------------------------------------------------------
-- 1. Schema & RLS Enablement Checks
-- ----------------------------------------------------------------------------
SELECT has_table('public', 'businesses', 'public.businesses table exists');
SELECT has_table('public', 'business_members', 'public.business_members table exists');
SELECT has_table('public', 'contacts', 'public.contacts table exists');
SELECT has_table('public', 'campaigns', 'public.campaigns table exists');
SELECT has_table('public', 'templates', 'public.templates table exists');
SELECT has_table('public', 'whatsapp_accounts', 'public.whatsapp_accounts table exists');

SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.contacts'::regclass),
  'RLS is enabled on public.contacts'
);
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.campaigns'::regclass),
  'RLS is enabled on public.campaigns'
);
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.whatsapp_accounts'::regclass),
  'RLS is enabled on public.whatsapp_accounts'
);
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.business_members'::regclass),
  'RLS is enabled on public.business_members'
);

-- ----------------------------------------------------------------------------
-- 2. Seed Ephemeral Test Fixtures (Rolled Back Automatically at End)
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_biz_a uuid := '11111111-1111-4111-8111-111111111111';
  v_biz_b uuid := '22222222-2222-4222-8222-222222222222';
  v_admin_a uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  v_agent_a uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
  v_inactive_a uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';
  v_admin_b uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
  v_has_is_active boolean;
BEGIN
  -- Create auth.users entries for test identities
  INSERT INTO auth.users (id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  VALUES
    (v_admin_a, 'authenticated', 'authenticated', 'pgtap-admin-a@test.local', '{"full_name":"Admin A"}'::jsonb, now(), now()),
    (v_agent_a, 'authenticated', 'authenticated', 'pgtap-agent-a@test.local', '{"full_name":"Agent A"}'::jsonb, now(), now()),
    (v_inactive_a, 'authenticated', 'authenticated', 'pgtap-inactive-a@test.local', '{"full_name":"Inactive A"}'::jsonb, now(), now()),
    (v_admin_b, 'authenticated', 'authenticated', 'pgtap-admin-b@test.local', '{"full_name":"Admin B"}'::jsonb, now(), now())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.businesses (id, name, slug, timezone)
  VALUES
    (v_biz_a, 'QA Business A', 'qa-biz-a-pgtap', 'UTC'),
    (v_biz_b, 'QA Business B', 'qa-biz-b-pgtap', 'UTC')
  ON CONFLICT (id) DO NOTHING;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'business_members' AND column_name = 'is_active'
  ) INTO v_has_is_active;

  IF v_has_is_active THEN
    INSERT INTO public.business_members (business_id, user_id, role, is_active)
    VALUES
      (v_biz_a, v_admin_a, 'admin', true),
      (v_biz_a, v_agent_a, 'agent', true),
      (v_biz_a, v_inactive_a, 'agent', false),
      (v_biz_b, v_admin_b, 'admin', true)
    ON CONFLICT DO NOTHING;
  ELSE
    INSERT INTO public.business_members (business_id, user_id, role, status)
    VALUES
      (v_biz_a, v_admin_a, 'admin', 'active'),
      (v_biz_a, v_agent_a, 'agent', 'active'),
      (v_biz_a, v_inactive_a, 'agent', 'suspended'),
      (v_biz_b, v_admin_b, 'admin', 'active')
    ON CONFLICT DO NOTHING;
  END IF;

  INSERT INTO public.contacts (id, business_id, full_name, phone_e164, marketing_opt_in)
  VALUES
    ('c0000001-0000-4000-8000-000000000001', v_biz_a, 'Tenant A Contact', '+15551110001', true),
    ('c0000002-0000-4000-8000-000000000002', v_biz_b, 'Tenant B Contact', '+15552220002', true)
  ON CONFLICT (id) DO NOTHING;
END $$;

-- ----------------------------------------------------------------------------
-- 3. Database Constraint Enforcement Tests
-- ----------------------------------------------------------------------------
SELECT throws_ok(
  $$INSERT INTO public.contacts (business_id, full_name, phone_e164)
    VALUES ('11111111-1111-4111-8111-111111111111', 'Bad Phone', '12345')$$,
  '23514',
  NULL,
  'public.contacts rejects non-E.164 phone numbers'
);

SELECT throws_ok(
  $$INSERT INTO public.contacts (business_id, full_name, phone_e164)
    VALUES ('11111111-1111-4111-8111-111111111111', 'Duplicate Phone', '+15551110001')$$,
  '23505',
  NULL,
  'public.contacts rejects duplicate (business_id, phone_e164) within same workspace'
);

SELECT lives_ok(
  $$INSERT INTO public.contacts (business_id, full_name, phone_e164)
    VALUES ('22222222-2222-4222-8222-222222222222', 'Same Phone Other Biz', '+15551110001')$$,
  'public.contacts allows same phone number in a different business workspace'
);

-- ----------------------------------------------------------------------------
-- 4. Role 4: Unauthenticated Visitor (anon) — Must See 0 Rows & Cannot Write
-- ----------------------------------------------------------------------------
SET LOCAL ROLE anon;
SELECT is(
  (SELECT count(*)::int FROM public.contacts),
  0,
  'Anon visitor sees 0 contacts'
);
SELECT is(
  (SELECT count(*)::int FROM public.businesses),
  0,
  'Anon visitor sees 0 businesses'
);
SELECT throws_ok(
  $$INSERT INTO public.contacts (business_id, full_name, phone_e164)
    VALUES ('11111111-1111-4111-8111-111111111111', 'Anon Inject', '+15559990001')$$,
  '42501',
  NULL,
  'Anon visitor cannot insert into public.contacts'
);
RESET ROLE;

-- ----------------------------------------------------------------------------
-- 5. Role 1: Business A Admin — Sees ONLY Business A Data
-- ----------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', true);
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.contacts WHERE business_id = '11111111-1111-4111-8111-111111111111'),
  1,
  'Business A Admin can read Business A contacts'
);
SELECT is(
  (SELECT count(*)::int FROM public.contacts WHERE business_id = '22222222-2222-4222-8222-222222222222'),
  0,
  'Business A Admin cannot read Business B contacts (cross-tenant isolation)'
);
SELECT throws_ok(
  $$INSERT INTO public.contacts (business_id, full_name, phone_e164)
    VALUES ('22222222-2222-4222-8222-222222222222', 'Cross Tenant Insert', '+15558880001')$$,
  '42501',
  NULL,
  'Business A Admin cannot insert contacts into Business B'
);

-- ----------------------------------------------------------------------------
-- 6. Role 2: Business A Agent — Read/Create Own Biz, Cannot Delete Contacts
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', true);
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.contacts WHERE business_id = '11111111-1111-4111-8111-111111111111'),
  1,
  'Business A Agent can read Business A contacts'
);

DELETE FROM public.contacts WHERE id = 'c0000001-0000-4000-8000-000000000001';
SELECT is(
  (SELECT count(*)::int FROM public.contacts WHERE id = 'c0000001-0000-4000-8000-000000000001'),
  1,
  'Business A Agent cannot delete Business A contacts (admin-only DELETE RLS)'
);

-- ----------------------------------------------------------------------------
-- 7. Role 3: Business B Admin — Isolated from Business A
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', true);
SELECT set_config('request.jwt.claims', '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.contacts WHERE business_id = '11111111-1111-4111-8111-111111111111'),
  0,
  'Business B Admin sees 0 contacts belonging to Business A'
);

-- ----------------------------------------------------------------------------
-- 8. Role 5: Inactive / Suspended Staff Member — Rejected by RLS
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', true);
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.contacts WHERE business_id = '11111111-1111-4111-8111-111111111111'),
  0,
  'Inactive Business A staff member sees 0 Business A contacts'
);
SELECT throws_ok(
  $$INSERT INTO public.contacts (business_id, full_name, phone_e164)
    VALUES ('11111111-1111-4111-8111-111111111111', 'Inactive Inject', '+15557770001')$$,
  '42501',
  NULL,
  'Inactive Business A staff member cannot insert contacts'
);

RESET ROLE;

SELECT * FROM finish();

ROLLBACK;
