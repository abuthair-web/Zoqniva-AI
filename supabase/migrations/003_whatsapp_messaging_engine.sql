-- ==============================================================================
-- ZOQNIVA AI — WHATSAPP MESSAGING ENGINE MIGRATION (003)
-- Minimal schema additions for:
--   1. Honest delivery lifecycle (pending, submitted, sent, delivered, read, failed)
--   2. Idempotent client sends (client_request_id) & webhook event deduplication
--   3. Test Mode vs Live Mode & authorized test phone allowlist
--   4. Customer WhatsApp ID (wa_id) matching & status timestamps
--   5. Strict RLS hardening so clients cannot forge inbound messages or statuses
-- ==============================================================================

-- 1. Ensure authenticated & service_role have schema/table grants (RLS remains strictly enforced)
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;

GRANT SELECT ON
  public.businesses,
  public.profiles,
  public.business_members,
  public.whatsapp_accounts,
  public.tags,
  public.templates,
  public.campaigns,
  public.automation_rules,
  public.audit_logs,
  public.webhook_events,
  public.message_events
TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.contacts, public.contact_tags TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.conversations TO authenticated;
GRANT SELECT, INSERT ON public.messages TO authenticated;
GRANT INSERT ON public.audit_logs TO authenticated;
GRANT UPDATE ON public.businesses, public.profiles TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.whatsapp_accounts, public.tags TO authenticated;

-- 2. Extend whatsapp_accounts for Test/Live mode, allowlist, Graph API version & Meta verification info
ALTER TABLE public.whatsapp_accounts
  ADD COLUMN IF NOT EXISTS messaging_mode TEXT NOT NULL DEFAULT 'test',
  ADD COLUMN IF NOT EXISTS test_allowlist TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS graph_api_version TEXT NOT NULL DEFAULT 'v21.0',
  ADD COLUMN IF NOT EXISTS verified_name TEXT,
  ADD COLUMN IF NOT EXISTS app_id TEXT;

ALTER TABLE public.whatsapp_accounts
  DROP CONSTRAINT IF EXISTS whatsapp_accounts_messaging_mode_check;
ALTER TABLE public.whatsapp_accounts
  ADD CONSTRAINT whatsapp_accounts_messaging_mode_check
  CHECK (messaging_mode IN ('test', 'live'));

CREATE INDEX IF NOT EXISTS idx_whatsapp_accounts_meta_phone
  ON public.whatsapp_accounts(meta_phone_number_id);

-- 3. Add WhatsApp ID (wa_id) on contacts so inbound webhooks resolve customers without duplicates
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS wa_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_business_wa_id
  ON public.contacts(business_id, wa_id)
  WHERE wa_id IS NOT NULL;

-- 4. Speed up conversation lookup per business + contact
CREATE INDEX IF NOT EXISTS idx_conversations_business_contact
  ON public.conversations(business_id, contact_id, last_message_at DESC);

-- 5. Extend messages for honest status tracking, timestamps, and idempotency
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS client_request_id TEXT,
  ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS failed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_status_at TIMESTAMPTZ;

ALTER TABLE public.messages
  DROP CONSTRAINT IF EXISTS messages_delivery_status_check;
ALTER TABLE public.messages
  ADD CONSTRAINT messages_delivery_status_check
  CHECK (delivery_status IN ('pending', 'queued', 'submitted', 'sent', 'delivered', 'read', 'failed', 'internal'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_client_request_id
  ON public.messages(business_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_messages_meta_message_id
  ON public.messages(meta_message_id)
  WHERE meta_message_id IS NOT NULL;

-- 6. Extend message_events for pending/submitted events & webhook timestamp deduplication
ALTER TABLE public.message_events
  ADD COLUMN IF NOT EXISTS meta_status_timestamp TIMESTAMPTZ;

ALTER TABLE public.message_events
  DROP CONSTRAINT IF EXISTS message_events_event_type_check;
ALTER TABLE public.message_events
  ADD CONSTRAINT message_events_event_type_check
  CHECK (event_type IN ('pending', 'queued', 'submitted', 'sent', 'delivered', 'read', 'failed'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_message_events_dedupe
  ON public.message_events(message_id, event_type, meta_status_timestamp)
  WHERE meta_status_timestamp IS NOT NULL;

-- 7. Index webhook_events for admin diagnostics
CREATE INDEX IF NOT EXISTS idx_webhook_events_business_received
  ON public.webhook_events(business_id, received_at DESC);

-- 8. Protect 24-hour customer service window fields from client tampering
CREATE OR REPLACE FUNCTION public.protect_conversation_window_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF auth.role() = 'authenticated' THEN
    IF TG_OP = 'INSERT' THEN
      NEW.last_customer_message_at := NULL;
      NEW.window_expires_at := NULL;
    ELSIF TG_OP = 'UPDATE' THEN
      NEW.last_customer_message_at := OLD.last_customer_message_at;
      NEW.window_expires_at := OLD.window_expires_at;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_conversation_window ON public.conversations;
CREATE TRIGGER trg_protect_conversation_window
  BEFORE INSERT OR UPDATE ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.protect_conversation_window_fields();

-- 9. Tighten messages RLS so authenticated clients can only directly insert internal team notes;
--    all real inbound and outbound WhatsApp messages are written exclusively by Edge Functions.
DROP POLICY IF EXISTS "Authorized members insert messages" ON public.messages;
DROP POLICY IF EXISTS "Authorized members insert internal notes only" ON public.messages;

CREATE POLICY "Authorized members insert internal notes only"
  ON public.messages FOR INSERT
  WITH CHECK (
    direction = 'internal'
    AND message_type = 'internal_note'
    AND delivery_status = 'internal'
    AND sender_type = 'agent'
    AND (sender_profile_id IS NULL OR sender_profile_id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.conversations cv
      WHERE cv.id = messages.conversation_id
        AND cv.business_id = messages.business_id
        AND (
          public.is_business_admin(cv.business_id)
          OR (
            public.is_business_member(cv.business_id)
            AND (cv.assigned_to IS NULL OR cv.assigned_to = auth.uid())
          )
        )
    )
  );
