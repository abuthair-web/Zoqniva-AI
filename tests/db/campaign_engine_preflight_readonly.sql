-- ============================================================================
-- ZOQNIVA AI — CAMPAIGN ENGINE V1 (PHASE 1) READ-ONLY SCHEMA PREFLIGHT SQL
-- ============================================================================
-- 100% READ-ONLY (SELECT statements only). Safe to run in Supabase SQL Editor
-- BEFORE applying `supabase/migrations/004_campaign_engine_v1_phase1.sql`.
--
-- Purpose:
--   1. Verify existing campaign, recipient, template, contact, tag, message,
--      WhatsApp account, membership, and audit tables & RLS status.
--   2. Confirm exact column names, types, nullability, and defaults.
--   3. Inspect constraints (PK, FK, UNIQUE, CHECK), indexes, and RLS policies.
--   4. Inspect message ID relationships and existing campaign_recipients rows.
--   5. Audit consent data quality & duplicate phone risk prior to Phase 1.
-- ============================================================================

-- 1. Table existence & Row-Level Security (RLS) status
SELECT
  expected.table_name,
  (c.oid IS NOT NULL) AS table_exists,
  COALESCE(c.relrowsecurity, FALSE) AS rls_enabled,
  COALESCE(c.relforcerowsecurity, FALSE) AS rls_forced
FROM (
  VALUES
    ('businesses'),
    ('business_members'),
    ('contacts'),
    ('tags'),
    ('contact_tags'),
    ('templates'),
    ('campaigns'),
    ('campaign_runs'),
    ('campaign_recipients'),
    ('campaign_events'),
    ('conversations'),
    ('messages'),
    ('message_events'),
    ('whatsapp_accounts'),
    ('audit_logs'),
    ('webhook_events')
) AS expected(table_name)
LEFT JOIN pg_class c
  ON c.relname = expected.table_name
  AND c.relkind = 'r'
  AND c.relnamespace = 'public'::regnamespace
ORDER BY expected.table_name;

-- 2. Exact live columns, data types, nullability, and defaults
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
    'business_members',
    'contacts',
    'tags',
    'contact_tags',
    'templates',
    'campaigns',
    'campaign_runs',
    'campaign_recipients',
    'campaign_events',
    'messages',
    'message_events',
    'whatsapp_accounts',
    'audit_logs'
  )
ORDER BY table_name, ordinal_position;

-- 3. Constraints (PRIMARY KEY, FOREIGN KEY, UNIQUE, CHECK) on campaign & messaging tables
SELECT
  rel.relname AS table_name,
  con.conname AS constraint_name,
  CASE con.contype
    WHEN 'p' THEN 'PRIMARY KEY'
    WHEN 'f' THEN 'FOREIGN KEY'
    WHEN 'u' THEN 'UNIQUE'
    WHEN 'c' THEN 'CHECK'
    ELSE con.contype::text
  END AS constraint_type,
  pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
WHERE nsp.nspname = 'public'
  AND rel.relname IN (
    'business_members',
    'contacts',
    'tags',
    'contact_tags',
    'templates',
    'campaigns',
    'campaign_runs',
    'campaign_recipients',
    'campaign_events',
    'messages',
    'message_events',
    'whatsapp_accounts',
    'audit_logs'
  )
ORDER BY rel.relname, con.contype, con.conname;

-- 4. Indexes across campaign, contact, template, message, and WhatsApp account tables
SELECT
  tablename AS table_name,
  indexname AS index_name,
  indexdef AS index_definition
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN (
    'business_members',
    'contacts',
    'tags',
    'contact_tags',
    'templates',
    'campaigns',
    'campaign_runs',
    'campaign_recipients',
    'campaign_events',
    'messages',
    'message_events',
    'whatsapp_accounts',
    'audit_logs'
  )
ORDER BY tablename, indexname;

-- 5. Existing RLS policies across campaign, contact, template, message, and audit tables
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
  AND tablename IN (
    'business_members',
    'contacts',
    'tags',
    'contact_tags',
    'templates',
    'campaigns',
    'campaign_runs',
    'campaign_recipients',
    'campaign_events',
    'messages',
    'message_events',
    'whatsapp_accounts',
    'audit_logs'
  )
ORDER BY tablename, cmd, policyname;

-- 6. Inspect foreign key relationships referencing public.messages, public.campaigns, and public.templates
SELECT
  src_rel.relname AS source_table,
  con.conname AS constraint_name,
  tgt_rel.relname AS referenced_table,
  pg_get_constraintdef(con.oid) AS fk_definition
FROM pg_constraint con
JOIN pg_class src_rel ON src_rel.oid = con.conrelid
JOIN pg_class tgt_rel ON tgt_rel.oid = con.confrelid
JOIN pg_namespace nsp ON nsp.oid = src_rel.relnamespace
WHERE nsp.nspname = 'public'
  AND con.contype = 'f'
  AND (
    tgt_rel.relname IN ('campaigns', 'templates', 'messages', 'contacts', 'whatsapp_accounts')
    OR src_rel.relname IN ('campaigns', 'campaign_runs', 'campaign_recipients', 'campaign_events', 'messages', 'message_events')
  )
ORDER BY src_rel.relname, con.conname;

-- 7. Inspect helper functions & confirm whether live RLS helpers use `is_active` vs legacy `status`
SELECT
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS arguments,
  p.prosecdef AS is_security_definer,
  pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'set_updated_at',
    'is_business_member',
    'is_business_admin',
    'zoqniva_is_active_business_member',
    'zoqniva_is_active_business_admin',
    'process_whatsapp_status_event'
  )
ORDER BY p.proname;

-- 8. Verify critical live schema facts required by Campaign Engine V1 Phase 1
SELECT check_name, passed FROM (
  SELECT 'campaigns.audience_filter exists' AS check_name,
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'campaigns' AND column_name = 'audience_filter') AS passed
  UNION ALL
  SELECT 'campaigns.scheduled_at exists',
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'campaigns' AND column_name = 'scheduled_at')
  UNION ALL
  SELECT 'contacts.marketing_opt_in exists',
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'contacts' AND column_name = 'marketing_opt_in')
  UNION ALL
  SELECT 'contacts.opt_in_status exists',
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'contacts' AND column_name = 'opt_in_status')
  UNION ALL
  SELECT 'contacts.opted_out_at exists',
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'contacts' AND column_name = 'opted_out_at')
  UNION ALL
  SELECT 'templates.status exists (lowercase Meta status)',
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'templates' AND column_name = 'status')
  UNION ALL
  SELECT 'templates.components JSONB exists',
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'templates' AND column_name = 'components')
  UNION ALL
  SELECT 'whatsapp_accounts.messaging_mode exists',
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'whatsapp_accounts' AND column_name = 'messaging_mode')
  UNION ALL
  SELECT 'whatsapp_accounts.test_allowlist exists',
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'whatsapp_accounts' AND column_name = 'test_allowlist')
  UNION ALL
  SELECT 'business_members.is_active exists',
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'business_members' AND column_name = 'is_active')
  UNION ALL
  SELECT 'messages.meta_message_id unique index exists',
    EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'messages' AND indexdef ILIKE '%UNIQUE%' AND indexdef ILIKE '%meta_message_id%'
    )
) checks;

-- 9. Read-only data diagnostics: WhatsApp account modes, template statuses, and contact consent summary per business
SELECT
  wa.business_id,
  wa.id AS whatsapp_account_id,
  wa.connection_status,
  wa.messaging_mode,
  COALESCE(array_length(wa.test_allowlist, 1), 0) AS allowlist_size
FROM public.whatsapp_accounts wa
ORDER BY wa.business_id;

SELECT
  t.business_id,
  LOWER(COALESCE(t.status, 'unknown')) AS status,
  COUNT(*) AS template_count,
  COUNT(*) FILTER (WHERE t.meta_template_id IS NOT NULL AND btrim(t.meta_template_id) <> '') AS meta_linked_count
FROM public.templates t
GROUP BY t.business_id, LOWER(COALESCE(t.status, 'unknown'))
ORDER BY t.business_id, status;

SELECT
  c.business_id,
  COUNT(*) AS total_contacts,
  COUNT(*) FILTER (WHERE c.marketing_opt_in = TRUE AND c.opted_out_at IS NULL) AS explicitly_opted_in,
  COUNT(*) FILTER (WHERE c.opted_out_at IS NOT NULL) AS explicitly_opted_out,
  COUNT(*) FILTER (WHERE c.phone_e164 IS NULL OR c.phone_e164 !~ '^\+[1-9][0-9]{6,14}$') AS invalid_e164_phone,
  COUNT(*) - COUNT(DISTINCT regexp_replace(COALESCE(c.phone_e164, ''), '[^0-9+]', '', 'g')) AS potential_duplicate_phones
FROM public.contacts c
GROUP BY c.business_id
ORDER BY c.business_id;
