-- ==============================================================================
-- ZOQNIVA AI — POST-MIGRATION 003 VERIFICATION SCRIPT (READ-ONLY)
-- Run in Supabase Dashboard -> SQL Editor AFTER running 003_whatsapp_messaging_engine.sql
-- ==============================================================================

-- 1. Verify required WhatsApp engine columns exist
SELECT
  expected.table_name,
  expected.column_name,
  (c.column_name IS NOT NULL) AS column_exists,
  c.data_type
FROM (
  VALUES
    ('whatsapp_accounts', 'messaging_mode'),
    ('whatsapp_accounts', 'test_allowlist'),
    ('whatsapp_accounts', 'graph_api_version'),
    ('whatsapp_accounts', 'verified_name'),
    ('whatsapp_accounts', 'app_id'),
    ('whatsapp_accounts', 'webhook_verified_at'),
    ('contacts', 'wa_id'),
    ('messages', 'client_request_id'),
    ('messages', 'submitted_at'),
    ('messages', 'sent_at'),
    ('messages', 'delivered_at'),
    ('messages', 'read_at'),
    ('messages', 'failed_at'),
    ('messages', 'last_status_at'),
    ('message_events', 'meta_status_timestamp'),
    ('webhook_events', 'retry_count'),
    ('webhook_events', 'last_retry_at')
) AS expected(table_name, column_name)
LEFT JOIN information_schema.columns c
  ON c.table_schema = 'public'
 AND c.table_name = expected.table_name
 AND c.column_name = expected.column_name
ORDER BY expected.table_name, expected.column_name;

-- 2. Verify required deduplication & lookup indexes exist
SELECT
  expected.indexname,
  (i.indexname IS NOT NULL) AS index_exists,
  i.tablename,
  i.indexdef
FROM (
  VALUES
    ('idx_whatsapp_accounts_meta_phone'),
    ('idx_contacts_business_wa_id'),
    ('idx_conversations_business_contact'),
    ('idx_messages_client_request_id'),
    ('idx_messages_meta_message_id_unique'),
    ('idx_message_events_dedupe'),
    ('idx_webhook_events_business_received')
) AS expected(indexname)
LEFT JOIN pg_indexes i
  ON i.schemaname = 'public'
 AND i.indexname = expected.indexname
ORDER BY expected.indexname;

-- 3. Verify 24h window protection trigger & message RLS hardening
SELECT
  trigger_name,
  event_object_table,
  action_timing,
  event_manipulation
FROM information_schema.triggers
WHERE trigger_schema = 'public'
  AND trigger_name = 'trg_protect_conversation_window';

SELECT
  tablename,
  policyname,
  cmd,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'messages'
ORDER BY policyname;

-- 4. Verify atomic webhook RPCs exist & are locked down strictly to service_role
SELECT
  p.proname AS function_name,
  p.prosecdef AS security_definer,
  r.grantee,
  r.privilege_type
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
LEFT JOIN information_schema.routine_privileges r
  ON r.routine_schema = 'public'
 AND r.routine_name = p.proname
WHERE n.nspname = 'public'
  AND p.proname IN ('process_whatsapp_inbound_message', 'process_whatsapp_status_event')
ORDER BY p.proname, r.grantee;

-- 5. Confirm RLS remains enabled on all core tables
SELECT
  c.relname AS table_name,
  c.relrowsecurity AS rls_enabled
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relname IN (
    'businesses',
    'profiles',
    'business_members',
    'whatsapp_accounts',
    'contacts',
    'conversations',
    'messages',
    'message_events',
    'webhook_events',
    'templates'
  )
ORDER BY c.relname;

-- 6. Confirm Realtime tables are active
SELECT tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
  AND schemaname = 'public'
ORDER BY tablename;

-- 7. Confirm existing active admin & business accounts remain intact
SELECT
  b.id AS business_id,
  b.name AS business_name,
  count(bm.id) FILTER (WHERE bm.is_active = TRUE AND bm.role = 'admin') AS active_admins,
  count(bm.id) FILTER (WHERE bm.is_active = TRUE) AS total_active_members
FROM public.businesses b
LEFT JOIN public.business_members bm ON bm.business_id = b.id
GROUP BY b.id, b.name
ORDER BY b.created_at;
