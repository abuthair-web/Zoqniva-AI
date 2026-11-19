-- ==============================================================================
-- ZOQNIVA AI — CAMPAIGN ENGINE V1, PHASE 1 DATABASE FOUNDATION (MIGRATION 004)
-- ==============================================================================
-- Status: PROPOSED MIGRATION — DO NOT APPLY AUTOMATICALLY.
-- Review preflight output from `tests/db/campaign_engine_preflight_readonly.sql`
-- before executing in Supabase SQL Editor or via `supabase db push`.
--
-- Scope (Phase 1 — Foundation Only, NO Bulk Dispatcher Activated):
--   1. Active-membership RLS helpers using live `business_members.is_active`
--      (never legacy `business_members.status`).
--   2. `public.campaign_runs`: durable launch/snapshot execution records with
--      idempotency keys and partial unique index preventing concurrent active runs.
--   3. `public.campaign_recipients`: repeatable creation / non-destructive upgrade
--      with per-run phone deduplication, exclusion reasons, message linkage, and
--      worker processing leases (`lease_owner`, `lease_token`, `lease_expires_at`).
--   4. `public.campaign_events`: append-only campaign lifecycle & guardian audit log.
--   5. Strict business-scoped RLS + least-privilege GRANTs (no direct client
--      tampering with snapshots, recipient queues, or processing leases).
--   6. Secure atomic `SECURITY DEFINER` RPCs (service_role only):
--      - `public.create_campaign_run_snapshot(...)`
--      - `public.claim_campaign_recipients(...)`
--      - `public.reclaim_expired_campaign_leases(...)`
--
-- Preserves untouched:
--   - Supabase Auth, `whatsapp-webhook`, `whatsapp-send-message`,
--     `whatsapp-connection-check`, `sync-templates`, Contacts, and Campaign Drafts.
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Ensure shared updated_at trigger helper exists (idempotent)
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- ==============================================================================
-- 1. LIVE-SCHEMA-SAFE RLS MEMBERSHIP HELPERS (`business_members.is_active`)
-- ==============================================================================
-- Uses `is_active = TRUE` (the verified live column) without mutating earlier
-- migration functions unexpectedly.
CREATE OR REPLACE FUNCTION public.zoqniva_is_active_business_member(target_business_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.business_members bm
    WHERE bm.business_id = target_business_id
      AND bm.user_id = auth.uid()
      AND bm.is_active = TRUE
      AND bm.role IN ('admin', 'agent')
  );
$$;

CREATE OR REPLACE FUNCTION public.zoqniva_is_active_business_admin(target_business_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.business_members bm
    WHERE bm.business_id = target_business_id
      AND bm.user_id = auth.uid()
      AND bm.is_active = TRUE
      AND bm.role = 'admin'
  );
$$;

GRANT EXECUTE ON FUNCTION public.zoqniva_is_active_business_member(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.zoqniva_is_active_business_admin(UUID) TO authenticated, service_role;

-- ==============================================================================
-- 2. CAMPAIGN RUNS (`public.campaign_runs`)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.campaign_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  whatsapp_account_id UUID REFERENCES public.whatsapp_accounts(id) ON DELETE SET NULL,
  template_id UUID NOT NULL REFERENCES public.templates(id) ON DELETE RESTRICT,
  run_number INTEGER NOT NULL DEFAULT 1 CHECK (run_number >= 1),
  idempotency_key TEXT NOT NULL CHECK (char_length(btrim(idempotency_key)) >= 4),
  messaging_mode TEXT NOT NULL DEFAULT 'test' CHECK (messaging_mode IN ('test', 'live')),
  status TEXT NOT NULL DEFAULT 'draft_snapshot' CHECK (
    status IN (
      'draft_snapshot',
      'validated',
      'queued',
      'running',
      'paused',
      'completed',
      'cancelled',
      'failed'
    )
  ),
  scheduled_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  -- Frozen immutable snapshots captured at validation/launch time
  template_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  audience_filter_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  variable_mapping_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  guardian_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Aggregate counts
  total_matched_count INTEGER NOT NULL DEFAULT 0 CHECK (total_matched_count >= 0),
  eligible_count INTEGER NOT NULL DEFAULT 0 CHECK (eligible_count >= 0),
  excluded_count INTEGER NOT NULL DEFAULT 0 CHECK (excluded_count >= 0),
  queued_count INTEGER NOT NULL DEFAULT 0 CHECK (queued_count >= 0),
  claimed_count INTEGER NOT NULL DEFAULT 0 CHECK (claimed_count >= 0),
  submitted_count INTEGER NOT NULL DEFAULT 0 CHECK (submitted_count >= 0),
  sent_count INTEGER NOT NULL DEFAULT 0 CHECK (sent_count >= 0),
  delivered_count INTEGER NOT NULL DEFAULT 0 CHECK (delivered_count >= 0),
  read_count INTEGER NOT NULL DEFAULT 0 CHECK (read_count >= 0),
  failed_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  skipped_count INTEGER NOT NULL DEFAULT 0 CHECK (skipped_count >= 0),
  last_error_code TEXT,
  last_error_message TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_campaign_runs_idempotency UNIQUE (business_id, campaign_id, idempotency_key),
  CONSTRAINT uq_campaign_runs_number UNIQUE (campaign_id, run_number)
);

-- Critical concurrency guard: at most ONE active run per campaign at any time
CREATE UNIQUE INDEX IF NOT EXISTS uq_campaign_runs_single_active_per_campaign
  ON public.campaign_runs(campaign_id)
  WHERE status IN ('queued', 'running', 'paused');

CREATE INDEX IF NOT EXISTS idx_campaign_runs_business_status
  ON public.campaign_runs(business_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_campaign_runs_campaign_created
  ON public.campaign_runs(campaign_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_campaign_runs_scheduled_due
  ON public.campaign_runs(status, scheduled_at ASC)
  WHERE status = 'queued' AND scheduled_at IS NOT NULL;

DROP TRIGGER IF EXISTS trg_campaign_runs_updated_at ON public.campaign_runs;
CREATE TRIGGER trg_campaign_runs_updated_at
  BEFORE UPDATE ON public.campaign_runs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ==============================================================================
-- 3. CAMPAIGN RECIPIENTS (`public.campaign_recipients`)
-- ==============================================================================
-- Supports both greenfield installation and repeatable non-destructive upgrade
-- if an earlier `001_initial_schema.sql` `campaign_recipients` table exists.
CREATE TABLE IF NOT EXISTS public.campaign_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  run_id UUID REFERENCES public.campaign_runs(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  phone_e164 TEXT NOT NULL,
  contact_name_snapshot TEXT,
  template_variables JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending',
  exclusion_reason TEXT,
  skip_reason TEXT,
  error_code TEXT,
  error_message TEXT,
  meta_message_id TEXT,
  message_id UUID REFERENCES public.messages(id) ON DELETE SET NULL,
  client_request_id TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts >= 1),
  lease_owner TEXT,
  lease_token UUID,
  lease_expires_at TIMESTAMPTZ,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Non-destructive column upgrades when `campaign_recipients` pre-existed from 001
ALTER TABLE public.campaign_recipients
  ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS run_id UUID REFERENCES public.campaign_runs(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS phone_e164 TEXT,
  ADD COLUMN IF NOT EXISTS contact_name_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS template_variables JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS exclusion_reason TEXT,
  ADD COLUMN IF NOT EXISTS skip_reason TEXT,
  ADD COLUMN IF NOT EXISTS error_code TEXT,
  ADD COLUMN IF NOT EXISTS error_message TEXT,
  ADD COLUMN IF NOT EXISTS meta_message_id TEXT,
  ADD COLUMN IF NOT EXISTS message_id UUID REFERENCES public.messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS client_request_id TEXT,
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS lease_owner TEXT,
  ADD COLUMN IF NOT EXISTS lease_token UUID,
  ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS failed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Backfill business_id / phone_e164 on any legacy rows safely before adding NOT NULL / indexes
UPDATE public.campaign_recipients cr
SET business_id = cp.business_id
FROM public.campaigns cp
WHERE cr.campaign_id = cp.id
  AND cr.business_id IS NULL;

UPDATE public.campaign_recipients cr
SET phone_e164 = COALESCE(ct.phone_e164, 'INVALID:' || cr.id::text)
FROM public.contacts ct
WHERE cr.contact_id = ct.id
  AND cr.phone_e164 IS NULL;

-- Drop legacy UNIQUE(campaign_id, contact_id) if present so multi-run snapshots can coexist cleanly
DO $$
DECLARE
  v_conname TEXT;
BEGIN
  SELECT con.conname INTO v_conname
  FROM pg_constraint con
  WHERE con.conrelid = 'public.campaign_recipients'::regclass
    AND con.contype = 'u'
    AND pg_get_constraintdef(con.oid) = 'UNIQUE (campaign_id, contact_id)';
  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.campaign_recipients DROP CONSTRAINT %I', v_conname);
  END IF;
END $$;

-- Refresh status & lease check constraints idempotently
ALTER TABLE public.campaign_recipients
  DROP CONSTRAINT IF EXISTS campaign_recipients_status_check;
ALTER TABLE public.campaign_recipients
  ADD CONSTRAINT campaign_recipients_status_check
  CHECK (
    status IN (
      'pending',
      'claimed',
      'submitted',
      'sent',
      'delivered',
      'read',
      'failed',
      'skipped',
      'excluded',
      'cancelled'
    )
  );

ALTER TABLE public.campaign_recipients
  DROP CONSTRAINT IF EXISTS campaign_recipients_attempt_bounds_check;
ALTER TABLE public.campaign_recipients
  ADD CONSTRAINT campaign_recipients_attempt_bounds_check
  CHECK (attempt_count >= 0 AND max_attempts >= 1);

-- Guarantee zero duplicate phone numbers or contacts within a single campaign run
CREATE UNIQUE INDEX IF NOT EXISTS uq_campaign_recipients_run_phone
  ON public.campaign_recipients(run_id, phone_e164)
  WHERE run_id IS NOT NULL AND phone_e164 IS NOT NULL AND status <> 'excluded';

CREATE UNIQUE INDEX IF NOT EXISTS uq_campaign_recipients_run_contact
  ON public.campaign_recipients(run_id, contact_id)
  WHERE run_id IS NOT NULL AND contact_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_campaign_recipients_client_request
  ON public.campaign_recipients(business_id, client_request_id)
  WHERE business_id IS NOT NULL AND client_request_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_campaign_recipients_meta_msg
  ON public.campaign_recipients(meta_message_id)
  WHERE meta_message_id IS NOT NULL;

-- High-throughput worker claim & status reporting indexes
CREATE INDEX IF NOT EXISTS idx_campaign_recipients_claimable
  ON public.campaign_recipients(run_id, status, next_attempt_at ASC, lease_expires_at ASC)
  WHERE status IN ('pending', 'claimed');

CREATE INDEX IF NOT EXISTS idx_campaign_recipients_business_run_status
  ON public.campaign_recipients(business_id, run_id, status);

CREATE INDEX IF NOT EXISTS idx_campaign_recipients_message_id
  ON public.campaign_recipients(message_id)
  WHERE message_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_campaign_recipients_updated_at ON public.campaign_recipients;
CREATE TRIGGER trg_campaign_recipients_updated_at
  BEFORE UPDATE ON public.campaign_recipients
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ==============================================================================
-- 4. CAMPAIGN EVENTS (`public.campaign_events`)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.campaign_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  run_id UUID REFERENCES public.campaign_runs(id) ON DELETE CASCADE,
  recipient_id UUID REFERENCES public.campaign_recipients(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'draft_saved',
      'preflight_validated',
      'preflight_blocked',
      'snapshot_created',
      'run_queued',
      'run_started',
      'run_paused',
      'run_resumed',
      'run_completed',
      'run_cancelled',
      'run_failed',
      'recipient_claimed',
      'recipient_submitted',
      'recipient_sent',
      'recipient_delivered',
      'recipient_read',
      'recipient_failed',
      'recipient_excluded',
      'lease_reclaimed'
    )
  ),
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'error')),
  message TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaign_events_business_campaign
  ON public.campaign_events(business_id, campaign_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_campaign_events_run_created
  ON public.campaign_events(run_id, created_at DESC)
  WHERE run_id IS NOT NULL;

-- ==============================================================================
-- 5. ROW-LEVEL SECURITY (RLS) & LEAST-PRIVILEGE GRANTS
-- ==============================================================================
ALTER TABLE public.campaign_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_events ENABLE ROW LEVEL SECURITY;

-- Service role full access for Edge Functions / backend workers
GRANT ALL ON public.campaign_runs, public.campaign_recipients, public.campaign_events TO service_role;

-- Authenticated clients get read-only SELECT governed strictly by RLS;
-- mutations MUST flow through verified Edge Functions / SECURITY DEFINER RPCs.
REVOKE ALL ON public.campaign_runs FROM anon, authenticated;
REVOKE ALL ON public.campaign_recipients FROM anon, authenticated;
REVOKE ALL ON public.campaign_events FROM anon, authenticated;

GRANT SELECT ON public.campaign_runs, public.campaign_recipients, public.campaign_events TO authenticated;

-- campaign_runs policies
DROP POLICY IF EXISTS "Active business members view campaign runs" ON public.campaign_runs;
CREATE POLICY "Active business members view campaign runs"
  ON public.campaign_runs FOR SELECT
  TO authenticated
  USING (public.zoqniva_is_active_business_member(business_id));

-- campaign_recipients policies (admin-only visibility of recipient PII/exclusion lists)
DROP POLICY IF EXISTS "Admins view campaign recipients" ON public.campaign_recipients;
DROP POLICY IF EXISTS "Active business admins view campaign recipients" ON public.campaign_recipients;
CREATE POLICY "Active business admins view campaign recipients"
  ON public.campaign_recipients FOR SELECT
  TO authenticated
  USING (
    business_id IS NOT NULL
    AND public.zoqniva_is_active_business_admin(business_id)
  );

-- campaign_events policies
DROP POLICY IF EXISTS "Active business members view campaign events" ON public.campaign_events;
CREATE POLICY "Active business members view campaign events"
  ON public.campaign_events FOR SELECT
  TO authenticated
  USING (public.zoqniva_is_active_business_member(business_id));

-- ==============================================================================
-- 6. ATOMIC DATABASE FUNCTIONS (SECURITY DEFINER — service_role ONLY)
-- ==============================================================================

-- 6A. Atomically create a durable campaign run & frozen recipient snapshot.
-- Guarantees:
--   - Advisory transaction lock serializes concurrent launches per campaign.
--   - Verifies active admin membership (`business_members.is_active = TRUE`).
--   - Verifies campaign & template belong to `p_business_id`.
--   - Enforces idempotency on `(business_id, campaign_id, idempotency_key)`.
--   - Blocks concurrent active runs (`queued`, `running`, `paused`).
--   - Enforces Test Mode safeguard: refuses `queued`/`running` when `messaging_mode = 'test'`.
--   - Deduplicates eligible phones per run so no recipient job can be duplicated.
CREATE OR REPLACE FUNCTION public.create_campaign_run_snapshot(
  p_business_id UUID,
  p_campaign_id UUID,
  p_actor_id UUID,
  p_idempotency_key TEXT,
  p_whatsapp_account_id UUID DEFAULT NULL,
  p_messaging_mode TEXT DEFAULT 'test',
  p_initial_status TEXT DEFAULT 'draft_snapshot',
  p_scheduled_at TIMESTAMPTZ DEFAULT NULL,
  p_template_snapshot JSONB DEFAULT '{}'::jsonb,
  p_audience_filter_snapshot JSONB DEFAULT '{}'::jsonb,
  p_variable_mapping_snapshot JSONB DEFAULT '{}'::jsonb,
  p_guardian_summary JSONB DEFAULT '{}'::jsonb,
  p_recipients JSONB DEFAULT '[]'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campaign RECORD;
  v_existing_run RECORD;
  v_active_run_id UUID;
  v_next_run_number INTEGER;
  v_run_id UUID;
  v_item JSONB;
  v_contact_id UUID;
  v_phone TEXT;
  v_name TEXT;
  v_vars JSONB;
  v_status TEXT;
  v_exclusion_reason TEXT;
  v_eligible_inserted INTEGER := 0;
  v_excluded_inserted INTEGER := 0;
  v_total_matched INTEGER := 0;
BEGIN
  IF p_business_id IS NULL OR p_campaign_id IS NULL OR p_actor_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_ARGUMENTS', 'error', 'business_id, campaign_id, and actor_id are required.');
  END IF;

  IF p_idempotency_key IS NULL OR char_length(btrim(p_idempotency_key)) < 4 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_IDEMPOTENCY_KEY', 'error', 'A valid idempotency_key (min 4 chars) is required.');
  END IF;

  IF p_messaging_mode NOT IN ('test', 'live') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_MESSAGING_MODE', 'error', 'messaging_mode must be test or live.');
  END IF;

  IF p_initial_status NOT IN ('draft_snapshot', 'validated', 'queued') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INITIAL_STATUS', 'error', 'initial_status must be draft_snapshot, validated, or queued.');
  END IF;

  -- Hard DB-level Test Mode safeguard: bulk dispatch / queuing is strictly disabled in Test Mode
  IF p_messaging_mode = 'test' AND p_initial_status = 'queued' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'TEST_MODE_BULK_DISABLED',
      'error', 'Bulk campaign dispatch is disabled in Test Mode. Only draft_snapshot or validated snapshots are permitted.'
    );
  END IF;

  -- Serialize concurrent snapshot / launch requests for the same campaign
  PERFORM pg_advisory_xact_lock(hashtext('zoqniva_campaign_run:' || p_campaign_id::text));

  -- 1. Verify active administrator authorization using live `is_active = TRUE`
  IF NOT EXISTS (
    SELECT 1
    FROM public.business_members bm
    WHERE bm.business_id = p_business_id
      AND bm.user_id = p_actor_id
      AND bm.role = 'admin'
      AND bm.is_active = TRUE
  ) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'ADMIN_REQUIRED',
      'error', 'Only active workspace administrators can create campaign snapshots.'
    );
  END IF;

  -- 2. Verify campaign belongs to the target business
  SELECT id, business_id, template_id, status INTO v_campaign
  FROM public.campaigns
  WHERE id = p_campaign_id
    AND business_id = p_business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'CAMPAIGN_NOT_FOUND',
      'error', 'Campaign does not exist in this workspace.'
    );
  END IF;

  -- 3. Idempotent replay check
  SELECT * INTO v_existing_run
  FROM public.campaign_runs
  WHERE business_id = p_business_id
    AND campaign_id = p_campaign_id
    AND idempotency_key = btrim(p_idempotency_key)
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'ok', true,
      'replayed', true,
      'run_id', v_existing_run.id,
      'run_number', v_existing_run.run_number,
      'status', v_existing_run.status,
      'eligible_count', v_existing_run.eligible_count,
      'excluded_count', v_existing_run.excluded_count
    );
  END IF;

  -- 4. Concurrent active launch guard (mirrors uq_campaign_runs_single_active_per_campaign)
  IF p_initial_status = 'queued' THEN
    SELECT id INTO v_active_run_id
    FROM public.campaign_runs
    WHERE campaign_id = p_campaign_id
      AND status IN ('queued', 'running', 'paused')
    LIMIT 1;

    IF v_active_run_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'ok', false,
        'code', 'CONCURRENT_RUN_ACTIVE',
        'error', 'An active campaign run already exists for this campaign.',
        'active_run_id', v_active_run_id
      );
    END IF;
  END IF;

  SELECT COALESCE(MAX(run_number), 0) + 1 INTO v_next_run_number
  FROM public.campaign_runs
  WHERE campaign_id = p_campaign_id;

  -- 5. Insert frozen campaign_runs record
  INSERT INTO public.campaign_runs (
    business_id,
    campaign_id,
    whatsapp_account_id,
    template_id,
    run_number,
    idempotency_key,
    messaging_mode,
    status,
    scheduled_at,
    template_snapshot,
    audience_filter_snapshot,
    variable_mapping_snapshot,
    guardian_summary,
    created_by
  )
  VALUES (
    p_business_id,
    p_campaign_id,
    p_whatsapp_account_id,
    v_campaign.template_id,
    v_next_run_number,
    btrim(p_idempotency_key),
    p_messaging_mode,
    p_initial_status,
    p_scheduled_at,
    COALESCE(p_template_snapshot, '{}'::jsonb),
    COALESCE(p_audience_filter_snapshot, '{}'::jsonb),
    COALESCE(p_variable_mapping_snapshot, '{}'::jsonb),
    COALESCE(p_guardian_summary, '{}'::jsonb),
    p_actor_id
  )
  RETURNING id INTO v_run_id;

  -- 6. Insert frozen recipient snapshot rows (deduplicated per run)
  IF jsonb_typeof(p_recipients) = 'array' THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_recipients)
    LOOP
      v_total_matched := v_total_matched + 1;
      v_contact_id := NULLIF(v_item->>'contact_id', '')::uuid;
      v_phone := COALESCE(NULLIF(btrim(v_item->>'phone_e164'), ''), 'INVALID:' || v_total_matched::text);
      v_name := NULLIF(btrim(v_item->>'contact_name'), '');
      v_vars := COALESCE(v_item->'template_variables', '{}'::jsonb);
      v_status := CASE
        WHEN COALESCE(v_item->>'status', 'pending') = 'excluded' THEN 'excluded'
        ELSE 'pending'
      END;
      v_exclusion_reason := NULLIF(btrim(v_item->>'exclusion_reason'), '');

      -- Verify any referenced contact belongs strictly to p_business_id
      IF v_contact_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.contacts ct
        WHERE ct.id = v_contact_id AND ct.business_id = p_business_id
      ) THEN
        v_contact_id := NULL;
        v_status := 'excluded';
        v_exclusion_reason := 'contact_not_in_business';
      END IF;

      INSERT INTO public.campaign_recipients (
        business_id,
        campaign_id,
        run_id,
        contact_id,
        phone_e164,
        contact_name_snapshot,
        template_variables,
        status,
        exclusion_reason,
        client_request_id
      )
      VALUES (
        p_business_id,
        p_campaign_id,
        v_run_id,
        v_contact_id,
        v_phone,
        v_name,
        v_vars,
        v_status,
        CASE WHEN v_status = 'excluded' THEN COALESCE(v_exclusion_reason, 'excluded') ELSE NULL END,
        CASE
          WHEN v_status = 'pending' THEN 'cr:' || v_run_id::text || ':' || v_phone
          ELSE NULL
        END
      )
      ON CONFLICT DO NOTHING;

      IF FOUND THEN
        IF v_status = 'excluded' THEN
          v_excluded_inserted := v_excluded_inserted + 1;
        ELSE
          v_eligible_inserted := v_eligible_inserted + 1;
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- 7. Update frozen counts on campaign_runs
  UPDATE public.campaign_runs
  SET
    total_matched_count = v_total_matched,
    eligible_count = v_eligible_inserted,
    excluded_count = v_excluded_inserted,
    queued_count = CASE WHEN p_initial_status = 'queued' THEN v_eligible_inserted ELSE 0 END,
    skipped_count = v_excluded_inserted
  WHERE id = v_run_id;

  -- 8. Record immutable audit event
  INSERT INTO public.campaign_events (
    business_id,
    campaign_id,
    run_id,
    actor_id,
    event_type,
    severity,
    message,
    details
  )
  VALUES (
    p_business_id,
    p_campaign_id,
    v_run_id,
    p_actor_id,
    'snapshot_created',
    'info',
    format('Campaign run #%s snapshot created (%s eligible, %s excluded).', v_next_run_number, v_eligible_inserted, v_excluded_inserted),
    jsonb_build_object(
      'run_number', v_next_run_number,
      'initial_status', p_initial_status,
      'messaging_mode', p_messaging_mode,
      'eligible_count', v_eligible_inserted,
      'excluded_count', v_excluded_inserted
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'replayed', false,
    'run_id', v_run_id,
    'run_number', v_next_run_number,
    'status', p_initial_status,
    'total_matched_count', v_total_matched,
    'eligible_count', v_eligible_inserted,
    'excluded_count', v_excluded_inserted
  );
END;
$$;

-- 6B. Atomically claim recipient jobs with processing leases (FOR UPDATE SKIP LOCKED).
-- Prepared in Phase 1 so Phase 2 workers can NEVER duplicate or race on a recipient job.
CREATE OR REPLACE FUNCTION public.claim_campaign_recipients(
  p_run_id UUID,
  p_worker_id TEXT,
  p_batch_size INTEGER DEFAULT 25,
  p_lease_seconds INTEGER DEFAULT 120
)
RETURNS TABLE (
  recipient_id UUID,
  business_id UUID,
  campaign_id UUID,
  run_id UUID,
  contact_id UUID,
  phone_e164 TEXT,
  contact_name_snapshot TEXT,
  template_variables JSONB,
  client_request_id TEXT,
  attempt_count INTEGER,
  lease_token UUID,
  lease_expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run RECORD;
  v_safe_batch INTEGER := LEAST(GREATEST(COALESCE(p_batch_size, 25), 1), 100);
  v_safe_lease INTEGER := LEAST(GREATEST(COALESCE(p_lease_seconds, 120), 30), 900);
  v_now TIMESTAMPTZ := NOW();
  v_lease_until TIMESTAMPTZ := v_now + make_interval(secs => v_safe_lease);
BEGIN
  IF p_run_id IS NULL OR p_worker_id IS NULL OR btrim(p_worker_id) = '' THEN
    RAISE EXCEPTION 'p_run_id and p_worker_id are required';
  END IF;

  SELECT id, status, messaging_mode INTO v_run
  FROM public.campaign_runs
  WHERE id = p_run_id;

  -- Never claim recipients for non-running runs OR any Test Mode run
  IF NOT FOUND OR v_run.status <> 'running' OR v_run.messaging_mode <> 'live' THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH claimable AS (
    SELECT cr.id
    FROM public.campaign_recipients cr
    WHERE cr.run_id = p_run_id
      AND cr.attempt_count < cr.max_attempts
      AND (
        (cr.status = 'pending' AND cr.next_attempt_at <= v_now)
        OR (cr.status = 'claimed' AND cr.lease_expires_at IS NOT NULL AND cr.lease_expires_at < v_now)
      )
    ORDER BY cr.next_attempt_at ASC, cr.created_at ASC
    LIMIT v_safe_batch
    FOR UPDATE SKIP LOCKED
  ),
  updated AS (
    UPDATE public.campaign_recipients cr
    SET
      status = 'claimed',
      attempt_count = cr.attempt_count + 1,
      lease_owner = btrim(p_worker_id),
      lease_token = gen_random_uuid(),
      lease_expires_at = v_lease_until,
      claimed_at = v_now
    FROM claimable c
    WHERE cr.id = c.id
    RETURNING
      cr.id,
      cr.business_id,
      cr.campaign_id,
      cr.run_id,
      cr.contact_id,
      cr.phone_e164,
      cr.contact_name_snapshot,
      cr.template_variables,
      cr.client_request_id,
      cr.attempt_count,
      cr.lease_token,
      cr.lease_expires_at
  )
  SELECT
    u.id AS recipient_id,
    u.business_id,
    u.campaign_id,
    u.run_id,
    u.contact_id,
    u.phone_e164,
    u.contact_name_snapshot,
    u.template_variables,
    u.client_request_id,
    u.attempt_count,
    u.lease_token,
    u.lease_expires_at
  FROM updated u;
END;
$$;

-- 6C. Reclaim expired processing leases safely (returns rows to pending or marks failed at max attempts)
CREATE OR REPLACE FUNCTION public.reclaim_expired_campaign_leases(
  p_run_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_requeued INTEGER := 0;
  v_failed INTEGER := 0;
BEGIN
  WITH expired_requeue AS (
    UPDATE public.campaign_recipients cr
    SET
      status = 'pending',
      lease_owner = NULL,
      lease_token = NULL,
      lease_expires_at = NULL,
      next_attempt_at = NOW() + INTERVAL '30 seconds'
    WHERE cr.status = 'claimed'
      AND cr.lease_expires_at IS NOT NULL
      AND cr.lease_expires_at < NOW()
      AND cr.attempt_count < cr.max_attempts
      AND (p_run_id IS NULL OR cr.run_id = p_run_id)
    RETURNING cr.id
  )
  SELECT COUNT(*) INTO v_requeued FROM expired_requeue;

  WITH expired_fail AS (
    UPDATE public.campaign_recipients cr
    SET
      status = 'failed',
      lease_owner = NULL,
      lease_token = NULL,
      lease_expires_at = NULL,
      failed_at = NOW(),
      error_code = 'LEASE_EXPIRED_MAX_ATTEMPTS',
      error_message = 'Recipient processing lease expired after maximum retry attempts.'
    WHERE cr.status = 'claimed'
      AND cr.lease_expires_at IS NOT NULL
      AND cr.lease_expires_at < NOW()
      AND cr.attempt_count >= cr.max_attempts
      AND (p_run_id IS NULL OR cr.run_id = p_run_id)
    RETURNING cr.id
  )
  SELECT COUNT(*) INTO v_failed FROM expired_fail;

  RETURN jsonb_build_object(
    'ok', true,
    'requeued', v_requeued,
    'failed', v_failed
  );
END;
$$;

-- Strictly restrict execution of atomic campaign RPCs to service_role only
REVOKE ALL ON FUNCTION public.create_campaign_run_snapshot(
  UUID, UUID, UUID, TEXT, UUID, TEXT, TEXT, TIMESTAMPTZ, JSONB, JSONB, JSONB, JSONB, JSONB
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_campaign_run_snapshot(
  UUID, UUID, UUID, TEXT, UUID, TEXT, TEXT, TIMESTAMPTZ, JSONB, JSONB, JSONB, JSONB, JSONB
) TO service_role;

REVOKE ALL ON FUNCTION public.claim_campaign_recipients(UUID, TEXT, INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_campaign_recipients(UUID, TEXT, INTEGER, INTEGER)
  TO service_role;

REVOKE ALL ON FUNCTION public.reclaim_expired_campaign_leases(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reclaim_expired_campaign_leases(UUID)
  TO service_role;
