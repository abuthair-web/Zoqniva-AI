-- ==============================================================================
-- ZOQNIVA AI — WHATSAPP MESSAGING ENGINE MIGRATION (003)
-- Idempotent, non-destructive PostgreSQL migration for production reliability:
--   1. Honest delivery lifecycle (pending, submitted, sent, delivered, read, failed)
--   2. Idempotent client sends (client_request_id) & webhook event deduplication
--   3. Test Mode vs Live Mode & authorized test phone allowlist
--   4. Customer WhatsApp ID (wa_id) matching & status timestamps
--   5. Strict RLS & privilege hardening (zero client spoofing of messages/windows)
--   6. Atomic service_role-only RPCs for inbound webhooks & status transitions
-- ==============================================================================

-- 1. Ensure schema & role privileges follow least-privilege RLS
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- Read access (RLS restricts to active business members / admins)
GRANT SELECT ON
  public.businesses,
  public.profiles,
  public.business_members,
  public.whatsapp_accounts,
  public.tags,
  public.templates,
  public.campaigns,
  public.campaign_recipients,
  public.automation_rules,
  public.audit_logs,
  public.webhook_events,
  public.message_events
TO authenticated;

-- Write access strictly governed by RLS policies
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contacts, public.contact_tags TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.conversations TO authenticated;
GRANT SELECT, INSERT ON public.messages TO authenticated;
GRANT INSERT ON public.audit_logs TO authenticated;
GRANT UPDATE ON public.businesses, public.profiles TO authenticated;
GRANT INSERT, UPDATE, DELETE ON
  public.whatsapp_accounts,
  public.tags,
  public.templates,
  public.campaigns,
  public.campaign_recipients,
  public.automation_rules
TO authenticated;

-- Explicitly prevent authenticated/anon clients from updating/deleting messages or forging events
REVOKE UPDATE, DELETE ON public.messages FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.message_events FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.webhook_events FROM anon, authenticated;

-- 2. Extend whatsapp_accounts for Test/Live mode, allowlist, Graph API version & verification metadata
ALTER TABLE public.whatsapp_accounts
  ADD COLUMN IF NOT EXISTS messaging_mode TEXT NOT NULL DEFAULT 'test',
  ADD COLUMN IF NOT EXISTS test_allowlist TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS graph_api_version TEXT NOT NULL DEFAULT 'v21.0',
  ADD COLUMN IF NOT EXISTS verified_name TEXT,
  ADD COLUMN IF NOT EXISTS app_id TEXT,
  ADD COLUMN IF NOT EXISTS webhook_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_sync_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_error_message TEXT;

ALTER TABLE public.whatsapp_accounts
  DROP CONSTRAINT IF EXISTS whatsapp_accounts_messaging_mode_check;
ALTER TABLE public.whatsapp_accounts
  ADD CONSTRAINT whatsapp_accounts_messaging_mode_check
  CHECK (messaging_mode IN ('test', 'live'));

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'whatsapp_accounts' AND column_name = 'phone_number_id'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_whatsapp_accounts_phone_id ON public.whatsapp_accounts(phone_number_id)';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'whatsapp_accounts' AND column_name = 'meta_phone_number_id'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_whatsapp_accounts_meta_phone ON public.whatsapp_accounts(meta_phone_number_id)';
  END IF;
END $$;

-- 3. Add WhatsApp ID (wa_id) & messaging metadata on contacts for duplicate-free inbound matching
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS wa_id TEXT,
  ADD COLUMN IF NOT EXISTS opted_out_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_contacted_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_business_wa_id
  ON public.contacts(business_id, wa_id)
  WHERE wa_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_business_phone
  ON public.contacts(business_id, phone_e164);

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

CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_meta_message_id_unique
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

-- 7. Extend webhook_events for admin diagnostics & retry tracking
ALTER TABLE public.webhook_events
  ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_retry_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_webhook_events_business_received
  ON public.webhook_events(business_id, received_at DESC);

-- 8. Protect 24-hour customer service window fields from client tampering
CREATE OR REPLACE FUNCTION public.protect_conversation_window_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
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

-- 10. Atomic service_role-only RPC: Inbound WhatsApp Message Ingestion
-- Guarantees:
--   - Advisory transaction lock prevents duplicate contacts/conversations on concurrent webhooks
--   - Deduplicates by meta_message_id BEFORE incrementing unread_count
--   - Never turns on marketing_opt_in automatically
--   - Never shrinks window_expires_at or overwrites newer preview/timestamps on delayed webhooks
CREATE OR REPLACE FUNCTION public.process_whatsapp_inbound_message(
  p_business_id UUID,
  p_wa_account_id UUID,
  p_wa_id TEXT,
  p_phone_e164 TEXT,
  p_profile_name TEXT,
  p_meta_message_id TEXT,
  p_message_type TEXT,
  p_body TEXT,
  p_media_filename TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb,
  p_msg_timestamp TIMESTAMPTZ DEFAULT NOW()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_msg_id UUID;
  v_contact_id UUID;
  v_existing_wa_id TEXT;
  v_conv_id UUID;
  v_conv_status TEXT;
  v_inserted_msg_id UUID;
  v_safe_type TEXT;
  v_safe_body TEXT;
  v_window_expires TIMESTAMPTZ;
BEGIN
  IF p_business_id IS NULL OR p_meta_message_id IS NULL OR btrim(p_meta_message_id) = '' THEN
    RAISE EXCEPTION 'Missing required business_id or meta_message_id';
  END IF;

  -- Serialize concurrent webhooks for the same customer phone in this business
  PERFORM pg_advisory_xact_lock(hashtext(p_business_id::text || ':' || p_phone_e164));

  -- Fast idempotent check by Meta Message ID
  SELECT id INTO v_existing_msg_id
  FROM public.messages
  WHERE meta_message_id = p_meta_message_id
  LIMIT 1;

  IF v_existing_msg_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'duplicate', true,
      'message_id', v_existing_msg_id
    );
  END IF;

  -- Resolve or create contact (match wa_id first, then phone_e164)
  SELECT id, wa_id INTO v_contact_id, v_existing_wa_id
  FROM public.contacts
  WHERE business_id = p_business_id
    AND wa_id = p_wa_id
  LIMIT 1;

  IF v_contact_id IS NULL THEN
    SELECT id, wa_id INTO v_contact_id, v_existing_wa_id
    FROM public.contacts
    WHERE business_id = p_business_id
      AND phone_e164 = p_phone_e164
    LIMIT 1;

    IF v_contact_id IS NOT NULL AND (v_existing_wa_id IS NULL OR v_existing_wa_id = '') THEN
      UPDATE public.contacts
      SET wa_id = p_wa_id
      WHERE id = v_contact_id;
    END IF;
  END IF;

  IF v_contact_id IS NULL THEN
    INSERT INTO public.contacts (
      business_id,
      full_name,
      phone_e164,
      wa_id,
      marketing_opt_in,
      notes
    )
    VALUES (
      p_business_id,
      COALESCE(NULLIF(btrim(p_profile_name), ''), p_phone_e164),
      p_phone_e164,
      p_wa_id,
      FALSE,
      'Auto-created from inbound WhatsApp message'
    )
    ON CONFLICT (business_id, phone_e164) DO UPDATE
      SET wa_id = COALESCE(public.contacts.wa_id, EXCLUDED.wa_id)
    RETURNING id INTO v_contact_id;
  END IF;

  -- Find latest conversation for this customer & lock row for atomic unread/window update
  SELECT id, status INTO v_conv_id, v_conv_status
  FROM public.conversations
  WHERE business_id = p_business_id
    AND contact_id = v_contact_id
  ORDER BY last_message_at DESC
  LIMIT 1
  FOR UPDATE;

  v_window_expires := p_msg_timestamp + INTERVAL '24 hours';
  v_safe_body := COALESCE(NULLIF(btrim(p_body), ''), '[Message received]');
  v_safe_type := CASE
    WHEN p_message_type IN ('text', 'template', 'image', 'document', 'audio', 'video')
      THEN p_message_type
    ELSE 'text'
  END;

  IF v_conv_id IS NULL THEN
    INSERT INTO public.conversations (
      business_id,
      contact_id,
      whatsapp_account_id,
      status,
      unread_count,
      last_customer_message_at,
      window_expires_at,
      last_message_preview,
      last_message_at
    )
    VALUES (
      p_business_id,
      v_contact_id,
      p_wa_account_id,
      'open',
      0,
      p_msg_timestamp,
      v_window_expires,
      LEFT(v_safe_body, 140),
      p_msg_timestamp
    )
    RETURNING id, status INTO v_conv_id, v_conv_status;
  END IF;

  -- Insert inbound message FIRST; if duplicate race occurs, ON CONFLICT skips without incrementing unread_count
  INSERT INTO public.messages (
    business_id,
    conversation_id,
    sender_type,
    sender_profile_id,
    direction,
    message_type,
    body,
    media_filename,
    meta_message_id,
    delivery_status,
    metadata,
    created_at
  )
  VALUES (
    p_business_id,
    v_conv_id,
    'contact',
    NULL,
    'inbound',
    v_safe_type,
    v_safe_body,
    p_media_filename,
    p_meta_message_id,
    'delivered',
    COALESCE(p_metadata, '{}'::jsonb),
    p_msg_timestamp
  )
  ON CONFLICT (meta_message_id) WHERE meta_message_id IS NOT NULL DO NOTHING
  RETURNING id INTO v_inserted_msg_id;

  IF v_inserted_msg_id IS NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'duplicate', true,
      'contact_id', v_contact_id,
      'conversation_id', v_conv_id
    );
  END IF;

  -- Advance conversation metadata monotonically only after message insert succeeded
  UPDATE public.conversations
  SET
    whatsapp_account_id = COALESCE(p_wa_account_id, whatsapp_account_id),
    status = CASE WHEN status = 'resolved' THEN 'open' ELSE status END,
    unread_count = unread_count + 1,
    last_customer_message_at = GREATEST(COALESCE(last_customer_message_at, p_msg_timestamp), p_msg_timestamp),
    window_expires_at = GREATEST(COALESCE(window_expires_at, v_window_expires), v_window_expires),
    last_message_preview = CASE
      WHEN last_message_at IS NULL OR p_msg_timestamp >= last_message_at THEN LEFT(v_safe_body, 140)
      ELSE last_message_preview
    END,
    last_message_at = GREATEST(COALESCE(last_message_at, p_msg_timestamp), p_msg_timestamp)
  WHERE id = v_conv_id;

  RETURN jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'contact_id', v_contact_id,
    'conversation_id', v_conv_id,
    'message_id', v_inserted_msg_id
  );
END;
$$;

-- 11. Atomic service_role-only RPC: Delivery Status Event Update
-- Guarantees:
--   - Deduplicates message_events by (message_id, event_type, meta_status_timestamp)
--   - Enforces monotonic delivery progression (pending < submitted < sent < delivered < read)
--   - Never downgrades delivered/read to failed on out-of-order Meta retries
CREATE OR REPLACE FUNCTION public.process_whatsapp_status_event(
  p_meta_message_id TEXT,
  p_next_status TEXT,
  p_status_timestamp TIMESTAMPTZ DEFAULT NOW(),
  p_error_code TEXT DEFAULT NULL,
  p_error_message TEXT DEFAULT NULL,
  p_raw_payload JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_msg RECORD;
  v_event_id UUID;
  v_cur_rank INTEGER;
  v_next_rank INTEGER;
  v_should_advance BOOLEAN := FALSE;
BEGIN
  IF p_meta_message_id IS NULL OR btrim(p_meta_message_id) = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_meta_message_id');
  END IF;

  IF p_next_status NOT IN ('sent', 'delivered', 'read', 'failed') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_status');
  END IF;

  SELECT id, business_id, delivery_status INTO v_msg
  FROM public.messages
  WHERE meta_message_id = p_meta_message_id
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'found', false);
  END IF;

  -- Record event idempotently
  INSERT INTO public.message_events (
    business_id,
    message_id,
    event_type,
    meta_status_timestamp,
    occurred_at,
    raw_payload
  )
  VALUES (
    v_msg.business_id,
    v_msg.id,
    p_next_status,
    p_status_timestamp,
    p_status_timestamp,
    COALESCE(p_raw_payload, '{}'::jsonb)
  )
  ON CONFLICT (message_id, event_type, meta_status_timestamp)
    WHERE meta_status_timestamp IS NOT NULL
  DO NOTHING
  RETURNING id INTO v_event_id;

  IF v_event_id IS NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'found', true,
      'duplicate', true,
      'advanced', false,
      'message_id', v_msg.id
    );
  END IF;

  IF v_msg.delivery_status = 'internal' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'found', true,
      'duplicate', false,
      'advanced', false,
      'message_id', v_msg.id
    );
  END IF;

  v_cur_rank := CASE v_msg.delivery_status
    WHEN 'pending' THEN 0
    WHEN 'queued' THEN 0
    WHEN 'submitted' THEN 1
    WHEN 'sent' THEN 2
    WHEN 'delivered' THEN 3
    WHEN 'read' THEN 4
    ELSE -1
  END;

  v_next_rank := CASE p_next_status
    WHEN 'sent' THEN 2
    WHEN 'delivered' THEN 3
    WHEN 'read' THEN 4
    ELSE -1
  END;

  IF p_next_status = 'failed' THEN
    v_should_advance := (v_cur_rank < 3 AND v_msg.delivery_status <> 'failed');
  ELSIF v_msg.delivery_status = 'failed' THEN
    v_should_advance := (v_next_rank >= 2);
  ELSE
    v_should_advance := (v_next_rank > v_cur_rank);
  END IF;

  IF v_should_advance THEN
    UPDATE public.messages
    SET
      delivery_status = p_next_status,
      last_status_at = GREATEST(COALESCE(last_status_at, p_status_timestamp), p_status_timestamp),
      sent_at = CASE WHEN p_next_status = 'sent' THEN COALESCE(sent_at, p_status_timestamp) ELSE sent_at END,
      delivered_at = CASE WHEN p_next_status = 'delivered' THEN COALESCE(delivered_at, p_status_timestamp) ELSE delivered_at END,
      read_at = CASE WHEN p_next_status = 'read' THEN COALESCE(read_at, p_status_timestamp) ELSE read_at END,
      failed_at = CASE WHEN p_next_status = 'failed' THEN COALESCE(failed_at, p_status_timestamp) ELSE failed_at END,
      error_code = CASE WHEN p_next_status = 'failed' THEN COALESCE(p_error_code, 'META_DELIVERY_FAILED') ELSE NULL END,
      error_message = CASE WHEN p_next_status = 'failed' THEN COALESCE(p_error_message, 'Message could not be delivered by WhatsApp.') ELSE NULL END
    WHERE id = v_msg.id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'found', true,
    'duplicate', false,
    'advanced', v_should_advance,
    'message_id', v_msg.id,
    'from_status', v_msg.delivery_status,
    'to_status', CASE WHEN v_should_advance THEN p_next_status ELSE v_msg.delivery_status END
  );
END;
$$;

-- Restrict RPC execution strictly to service_role (Edge Functions only)
REVOKE ALL ON FUNCTION public.process_whatsapp_inbound_message(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.process_whatsapp_inbound_message(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TIMESTAMPTZ
) TO service_role;

REVOKE ALL ON FUNCTION public.process_whatsapp_status_event(
  TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, JSONB
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.process_whatsapp_status_event(
  TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, JSONB
) TO service_role;

-- 12. Ensure Realtime publication includes required messaging & connection tables idempotently
DO $$
DECLARE
  v_table TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    FOREACH v_table IN ARRAY ARRAY['conversations', 'messages', 'message_events', 'contacts', 'whatsapp_accounts']
    LOOP
      IF NOT EXISTS (
        SELECT 1
        FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = v_table
      ) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', v_table);
      END IF;
    END LOOP;
  END IF;
END $$;
