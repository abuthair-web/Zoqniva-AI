-- ============================================================================
-- ZOQNIVA AI — READ-ONLY LIVE DATABASE SCHEMA & RLS AUDIT SCRIPT (Phase 2)
-- ============================================================================
-- 100% READ-ONLY (SELECT statements only). Safe to run in Supabase SQL Editor
-- or psql to compare live tables, columns, constraints, and RLS policies
-- against repository migrations without modifying any schema or data.
-- ============================================================================

-- 1. List all public CRM tables and verify Row-Level Security (RLS) is enabled
SELECT
  c.relname AS table_name,
  c.relrowsecurity AS rls_enabled,
  c.relforcerowsecurity AS rls_forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relname IN (
    'businesses',
    'business_members',
    'profiles',
    'contacts',
    'tags',
    'contact_tags',
    'templates',
    'campaigns',
    'conversations',
    'messages',
    'message_events',
    'whatsapp_accounts',
    'webhook_events',
    'automation_rules',
    'audit_logs'
  )
ORDER BY c.relname;

-- 2. Inspect actual columns, types, nullability, and defaults for all CRM tables
SELECT
  table_name,
  ordinal_position,
  column_name,
  data_type,
  udt_name,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN (
    'businesses',
    'business_members',
    'profiles',
    'contacts',
    'tags',
    'contact_tags',
    'templates',
    'campaigns',
    'conversations',
    'messages',
    'message_events',
    'whatsapp_accounts',
    'webhook_events',
    'automation_rules',
    'audit_logs'
  )
ORDER BY table_name, ordinal_position;

-- 3. Inspect CHECK, UNIQUE, PRIMARY KEY, and FOREIGN KEY constraints
SELECT
  tc.table_name,
  tc.constraint_name,
  tc.constraint_type,
  pg_get_constraintdef(con.oid) AS constraint_definition
FROM information_schema.table_constraints tc
JOIN pg_constraint con ON con.conname = tc.constraint_name
JOIN pg_namespace n ON n.oid = con.connamespace AND n.nspname = tc.table_schema
WHERE tc.table_schema = 'public'
  AND tc.table_name IN (
    'businesses',
    'business_members',
    'profiles',
    'contacts',
    'tags',
    'contact_tags',
    'templates',
    'campaigns',
    'conversations',
    'messages',
    'whatsapp_accounts',
    'webhook_events',
    'automation_rules',
    'audit_logs'
  )
ORDER BY tc.table_name, tc.constraint_type, tc.constraint_name;

-- 4. Inspect all RLS policies across CRM tables
SELECT
  tablename AS table_name,
  policyname AS policy_name,
  permissive,
  roles,
  cmd,
  qual AS using_expression,
  with_check AS with_check_expression
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, cmd, policyname;

-- 5. Drift Check: Inspect RLS helper function definitions for legacy `status = 'active'` references
SELECT
  p.proname AS function_name,
  pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'is_business_member',
    'is_business_admin',
    'process_whatsapp_inbound_message',
    'process_whatsapp_status_event'
  )
ORDER BY p.proname;

-- 6. Verify expected critical schema invariants (Read-only diagnostic)
SELECT
  'business_members.is_active exists' AS check_name,
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'business_members' AND column_name = 'is_active'
  ) AS passed
UNION ALL
SELECT
  'business_members.status does NOT exist',
  NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'business_members' AND column_name = 'status'
  )
UNION ALL
SELECT
  'profiles.email does NOT exist',
  NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'email'
  )
UNION ALL
SELECT
  'templates.components JSONB exists',
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'templates' AND column_name = 'components'
  );
