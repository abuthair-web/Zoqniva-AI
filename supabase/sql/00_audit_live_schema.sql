-- ==============================================================================
-- ZOQNIVA AI — READ-ONLY LIVE SUPABASE DATABASE AUDIT SCRIPT
-- Run in Supabase Dashboard -> SQL Editor BEFORE applying Migration 003.
-- Safe: 100% read-only SELECT queries (no DDL, no DML, no data changes).
-- ==============================================================================

-- 1. Check presence of all expected CRM & WhatsApp tables in public schema
SELECT
  expected.table_name,
  (t.table_name IS NOT NULL) AS exists_in_public,
  COALESCE(c.relrowsecurity, FALSE) AS rls_enabled,
  COALESCE(c.relforcerowsecurity, FALSE) AS rls_forced
FROM (
  VALUES
    ('businesses'),
    ('profiles'),
    ('business_members'),
    ('whatsapp_accounts'),
    ('contacts'),
    ('tags'),
    ('contact_tags'),
    ('conversations'),
    ('messages'),
    ('message_events'),
    ('templates'),
    ('campaigns'),
    ('campaign_recipients'),
    ('automation_rules'),
    ('audit_logs'),
    ('webhook_events')
) AS expected(table_name)
LEFT JOIN information_schema.tables t
  ON t.table_schema = 'public'
 AND t.table_name = expected.table_name
LEFT JOIN pg_class c
  ON c.relname = expected.table_name
 AND c.relnamespace = 'public'::regnamespace
ORDER BY expected.table_name;

-- 2. Inspect exact columns, types, nullability, and defaults across core tables
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
    'profiles',
    'business_members',
    'whatsapp_accounts',
    'contacts',
    'conversations',
    'messages',
    'message_events',
    'webhook_events',
    'templates',
    'campaigns',
    'campaign_recipients',
    'audit_logs'
  )
ORDER BY table_name, ordinal_position;

-- 3. Inspect Primary Keys, Foreign Keys, Unique Constraints, and Check Constraints
SELECT
  conrelid::regclass AS table_name,
  conname AS constraint_name,
  CASE contype
    WHEN 'p' THEN 'PRIMARY KEY'
    WHEN 'f' THEN 'FOREIGN KEY'
    WHEN 'u' THEN 'UNIQUE'
    WHEN 'c' THEN 'CHECK'
    ELSE contype::text
  END AS constraint_type,
  pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE connamespace = 'public'::regnamespace
ORDER BY conrelid::regclass::text, contype, conname;

-- 4. Inspect Indexes (including partial unique indexes)
SELECT
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;

-- 5. Inspect RLS Policies across all public tables
SELECT
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- 6. Inspect Triggers on public tables
SELECT
  event_object_table AS table_name,
  trigger_name,
  action_timing,
  event_manipulation,
  action_statement
FROM information_schema.triggers
WHERE trigger_schema = 'public'
ORDER BY event_object_table, trigger_name;

-- 7. Inspect PostgreSQL Helper Functions & Security Settings
SELECT
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS arguments,
  p.prosecdef AS security_definer,
  p.proconfig AS function_config
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
ORDER BY p.proname;

-- 8. Inspect Table & Function Privileges for anon / authenticated / service_role
SELECT
  table_name,
  grantee,
  string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privileges
FROM information_schema.table_privileges
WHERE table_schema = 'public'
  AND grantee IN ('PUBLIC', 'anon', 'authenticated', 'service_role')
GROUP BY table_name, grantee
ORDER BY table_name, grantee;

-- 9. Inspect Tables Enabled in supabase_realtime Publication
SELECT
  pubname,
  schemaname,
  tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
ORDER BY schemaname, tablename;

-- 10. Non-sensitive row counts & active workspace integrity summary
SELECT
  (SELECT count(*) FROM public.businesses) AS businesses_count,
  (SELECT count(*) FROM public.business_members WHERE status = 'active' AND role = 'admin') AS active_admins_count,
  (SELECT count(*) FROM public.business_members WHERE status = 'active') AS active_members_count,
  (SELECT count(*) FROM public.whatsapp_accounts) AS whatsapp_accounts_count,
  (SELECT count(*) FROM public.contacts) AS contacts_count,
  (SELECT count(*) FROM public.conversations) AS conversations_count,
  (SELECT count(*) FROM public.messages) AS messages_count,
  (SELECT count(*) FROM public.templates) AS templates_count,
  (SELECT count(*) FROM public.webhook_events) AS webhook_events_count;
