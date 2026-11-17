-- ==============================================================================
-- ZOQNIVA AI — INITIAL SUPABASE POSTGRESQL SCHEMA
-- Developed by Noor Labs
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Shared updated_at trigger helper
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- 1. BUSINESSES (Modular multi-tenant foundation, starting with single business)
CREATE TABLE IF NOT EXISTS public.businesses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (char_length(trim(name)) >= 2),
  slug TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]+$'),
  industry TEXT,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  website TEXT,
  business_hours JSONB NOT NULL DEFAULT '{
    "monday": {"enabled": true, "open": "09:00", "close": "18:00"},
    "tuesday": {"enabled": true, "open": "09:00", "close": "18:00"},
    "wednesday": {"enabled": true, "open": "09:00", "close": "18:00"},
    "thursday": {"enabled": true, "open": "09:00", "close": "18:00"},
    "friday": {"enabled": true, "open": "09:00", "close": "18:00"},
    "saturday": {"enabled": false, "open": "10:00", "close": "14:00"},
    "sunday": {"enabled": false, "open": "10:00", "close": "14:00"}
  }'::jsonb,
  ai_settings JSONB NOT NULL DEFAULT '{
    "enabled": false,
    "auto_reply_authorized": false,
    "assistant_name": "Zoqniva Assistant",
    "provider": "unconfigured",
    "tone": "professional",
    "system_instructions": "Assist customers politely and escalate billing or complex account disputes to a human agent.",
    "handoff_keywords": ["agent", "human", "manager", "refund"]
  }'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_businesses_updated_at
  BEFORE UPDATE ON public.businesses
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2. PROFILES (Linked 1:1 to auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL CHECK (char_length(trim(full_name)) >= 2),
  avatar_url TEXT,
  phone TEXT,
  notification_preferences JSONB NOT NULL DEFAULT '{
    "new_conversation": true,
    "assigned_mention": true,
    "failed_message_alert": true,
    "campaign_summary": false
  }'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3. BUSINESS MEMBERS (Staff & Role-Based Access Control)
CREATE TABLE IF NOT EXISTS public.business_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'agent')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'invited', 'suspended')),
  job_title TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, user_id)
);

CREATE INDEX idx_business_members_user ON public.business_members(user_id);
CREATE INDEX idx_business_members_business_role ON public.business_members(business_id, role);

CREATE TRIGGER trg_business_members_updated_at
  BEFORE UPDATE ON public.business_members
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4. WHATSAPP ACCOUNTS (Official Meta Cloud API connection metadata; tokens stored ONLY in Supabase Secrets)
CREATE TABLE IF NOT EXISTS public.whatsapp_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  phone_number_e164 TEXT NOT NULL CHECK (phone_number_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  meta_phone_number_id TEXT NOT NULL,
  meta_waba_id TEXT NOT NULL,
  connection_status TEXT NOT NULL DEFAULT 'not_connected'
    CHECK (connection_status IN ('not_connected', 'configuration_required', 'connected', 'connection_error')),
  quality_rating TEXT DEFAULT 'unknown' CHECK (quality_rating IN ('green', 'yellow', 'red', 'unknown')),
  webhook_verified_at TIMESTAMPTZ,
  last_sync_at TIMESTAMPTZ,
  last_error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, meta_phone_number_id)
);

CREATE INDEX idx_whatsapp_accounts_business ON public.whatsapp_accounts(business_id);

CREATE TRIGGER trg_whatsapp_accounts_updated_at
  BEFORE UPDATE ON public.whatsapp_accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 5. CONTACTS (Normalized E.164 international phone numbers)
CREATE TABLE IF NOT EXISTS public.contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL CHECK (char_length(trim(full_name)) >= 1),
  phone_e164 TEXT NOT NULL CHECK (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  email TEXT,
  company TEXT,
  city TEXT,
  country TEXT,
  marketing_opt_in BOOLEAN NOT NULL DEFAULT FALSE,
  opted_out_at TIMESTAMPTZ,
  notes TEXT DEFAULT '',
  custom_attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_contacted_at TIMESTAMPTZ,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, phone_e164)
);

CREATE INDEX idx_contacts_business_name ON public.contacts(business_id, full_name);
CREATE INDEX idx_contacts_business_phone ON public.contacts(business_id, phone_e164);
CREATE INDEX idx_contacts_opt_in ON public.contacts(business_id, marketing_opt_in);

CREATE TRIGGER trg_contacts_updated_at
  BEFORE UPDATE ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 6. TAGS
CREATE TABLE IF NOT EXISTS public.tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(trim(name)) >= 1),
  color TEXT NOT NULL DEFAULT '#2563EB',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, name)
);

CREATE INDEX idx_tags_business ON public.tags(business_id);

-- 7. CONTACT TAGS (Join table)
CREATE TABLE IF NOT EXISTS public.contact_tags (
  contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES public.tags(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (contact_id, tag_id)
);

CREATE INDEX idx_contact_tags_tag ON public.contact_tags(tag_id);

-- 8. CONVERSATIONS
CREATE TABLE IF NOT EXISTS public.conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  whatsapp_account_id UUID REFERENCES public.whatsapp_accounts(id) ON DELETE SET NULL,
  assigned_to UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'pending', 'resolved')),
  unread_count INTEGER NOT NULL DEFAULT 0 CHECK (unread_count >= 0),
  human_handoff_requested BOOLEAN NOT NULL DEFAULT FALSE,
  last_customer_message_at TIMESTAMPTZ,
  window_expires_at TIMESTAMPTZ,
  last_message_preview TEXT,
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_conversations_business_status ON public.conversations(business_id, status, last_message_at DESC);
CREATE INDEX idx_conversations_assigned ON public.conversations(business_id, assigned_to);
CREATE INDEX idx_conversations_contact ON public.conversations(contact_id);

CREATE TRIGGER trg_conversations_updated_at
  BEFORE UPDATE ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 9. MESSAGES
CREATE TABLE IF NOT EXISTS public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_type TEXT NOT NULL CHECK (sender_type IN ('contact', 'agent', 'ai', 'system')),
  sender_profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound', 'internal')),
  message_type TEXT NOT NULL DEFAULT 'text'
    CHECK (message_type IN ('text', 'template', 'image', 'document', 'audio', 'video', 'internal_note')),
  body TEXT NOT NULL,
  media_url TEXT,
  media_filename TEXT,
  template_name TEXT,
  meta_message_id TEXT UNIQUE,
  delivery_status TEXT NOT NULL DEFAULT 'queued'
    CHECK (delivery_status IN ('queued', 'sent', 'delivered', 'read', 'failed', 'internal')),
  error_code TEXT,
  error_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_messages_conversation_created ON public.messages(conversation_id, created_at ASC);
CREATE INDEX idx_messages_business_status ON public.messages(business_id, delivery_status);

-- 10. MESSAGE EVENTS (Meta Webhook delivery lifecycle audit)
CREATE TABLE IF NOT EXISTS public.message_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  message_id UUID NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('queued', 'sent', 'delivered', 'read', 'failed')),
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_message_events_message ON public.message_events(message_id, occurred_at ASC);

-- 11. TEMPLATES
CREATE TABLE IF NOT EXISTS public.templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  meta_template_id TEXT,
  name TEXT NOT NULL CHECK (name ~ '^[a-z0-9_]+$'),
  category TEXT NOT NULL CHECK (category IN ('MARKETING', 'UTILITY', 'AUTHENTICATION')),
  language TEXT NOT NULL DEFAULT 'en_US',
  header_type TEXT NOT NULL DEFAULT 'NONE' CHECK (header_type IN ('NONE', 'TEXT', 'IMAGE', 'DOCUMENT')),
  header_text TEXT,
  body_text TEXT NOT NULL,
  footer_text TEXT,
  buttons JSONB NOT NULL DEFAULT '[]'::jsonb,
  variables_count INTEGER NOT NULL DEFAULT 0 CHECK (variables_count >= 0),
  approval_status TEXT NOT NULL DEFAULT 'DRAFT'
    CHECK (approval_status IN ('DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'PAUSED')),
  rejection_reason TEXT,
  last_synced_at TIMESTAMPTZ,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, name, language)
);

CREATE INDEX idx_templates_business_status ON public.templates(business_id, approval_status);

CREATE TRIGGER trg_templates_updated_at
  BEFORE UPDATE ON public.templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 12. CAMPAIGNS
CREATE TABLE IF NOT EXISTS public.campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(trim(name)) >= 2),
  template_id UUID NOT NULL REFERENCES public.templates(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'scheduled', 'running', 'paused', 'completed', 'cancelled')),
  target_tag_ids UUID[] NOT NULL DEFAULT '{}',
  variable_mapping JSONB NOT NULL DEFAULT '{}'::jsonb,
  scheduled_for TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  selected_count INTEGER NOT NULL DEFAULT 0,
  eligible_count INTEGER NOT NULL DEFAULT 0,
  submitted_count INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  delivered_count INTEGER NOT NULL DEFAULT 0,
  read_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_campaigns_business_status ON public.campaigns(business_id, status);

CREATE TRIGGER trg_campaigns_updated_at
  BEFORE UPDATE ON public.campaigns
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 13. CAMPAIGN RECIPIENTS (Queue-compatible per-recipient tracking)
CREATE TABLE IF NOT EXISTS public.campaign_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'submitted', 'sent', 'delivered', 'read', 'failed', 'skipped')),
  skip_reason TEXT,
  error_message TEXT,
  meta_message_id TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (campaign_id, contact_id)
);

CREATE INDEX idx_campaign_recipients_campaign_status ON public.campaign_recipients(campaign_id, status);

-- 14. AUTOMATION RULES (Extensible schema for future visual flow builder)
CREATE TABLE IF NOT EXISTS public.automation_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  rule_type TEXT NOT NULL CHECK (rule_type IN (
    'welcome_message',
    'keyword_reply',
    'business_hours',
    'out_of_office',
    'auto_tagging',
    'conversation_assignment',
    'human_handoff'
  )),
  description TEXT,
  is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  trigger_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  action_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  flow_nodes JSONB NOT NULL DEFAULT '[]'::jsonb,
  execution_count INTEGER NOT NULL DEFAULT 0,
  last_executed_at TIMESTAMPTZ,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_automation_rules_business ON public.automation_rules(business_id, rule_type);

CREATE TRIGGER trg_automation_rules_updated_at
  BEFORE UPDATE ON public.automation_rules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 15. AUDIT LOGS
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_business_created ON public.audit_logs(business_id, created_at DESC);

-- 16. WEBHOOK EVENTS (Raw Meta Cloud API inbound webhook audit log)
CREATE TABLE IF NOT EXISTS public.webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID REFERENCES public.businesses(id) ON DELETE SET NULL,
  provider TEXT NOT NULL DEFAULT 'meta_whatsapp',
  event_type TEXT NOT NULL,
  signature_valid BOOLEAN NOT NULL DEFAULT FALSE,
  processed BOOLEAN NOT NULL DEFAULT FALSE,
  processing_error TEXT,
  payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX idx_webhook_events_processed ON public.webhook_events(processed, received_at DESC);
