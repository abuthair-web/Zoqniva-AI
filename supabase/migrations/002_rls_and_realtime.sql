-- ==============================================================================
-- ZOQNIVA AI — ROW LEVEL SECURITY (RLS) & REALTIME CONFIGURATION
-- Enforces Admin vs Agent permissions on the database layer
-- ==============================================================================

-- Helper: Verify current authenticated user belongs to a business as active member
CREATE OR REPLACE FUNCTION public.is_business_member(target_business_id UUID)
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
      AND bm.status = 'active'
  );
$$;

-- Helper: Verify current authenticated user is an active Admin for a business
CREATE OR REPLACE FUNCTION public.is_business_admin(target_business_id UUID)
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
      AND bm.role = 'admin'
      AND bm.status = 'active'
  );
$$;

-- Enable RLS across all 16 tables
ALTER TABLE public.businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;

-- BUSINESSES: Members can read; Admins can update
CREATE POLICY "Members view business"
  ON public.businesses FOR SELECT
  USING (public.is_business_member(id));

CREATE POLICY "Admins update business"
  ON public.businesses FOR UPDATE
  USING (public.is_business_admin(id))
  WITH CHECK (public.is_business_admin(id));

-- PROFILES: Authenticated users can view co-members and edit own profile
CREATE POLICY "Users view own or co-member profiles"
  ON public.profiles FOR SELECT
  USING (
    id = auth.uid() OR EXISTS (
      SELECT 1
      FROM public.business_members bm1
      JOIN public.business_members bm2 ON bm1.business_id = bm2.business_id
      WHERE bm1.user_id = auth.uid() AND bm2.user_id = profiles.id AND bm1.status = 'active'
    )
  );

CREATE POLICY "Users update own profile"
  ON public.profiles FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- BUSINESS MEMBERS: Members can read roster; Admins manage team members
CREATE POLICY "Members view team roster"
  ON public.business_members FOR SELECT
  USING (public.is_business_member(business_id));

CREATE POLICY "Admins manage team roster"
  ON public.business_members FOR ALL
  USING (public.is_business_admin(business_id))
  WITH CHECK (public.is_business_admin(business_id));

-- WHATSAPP ACCOUNTS: Members can view connection status; Admins manage setup
CREATE POLICY "Members view whatsapp account status"
  ON public.whatsapp_accounts FOR SELECT
  USING (public.is_business_member(business_id));

CREATE POLICY "Admins manage whatsapp accounts"
  ON public.whatsapp_accounts FOR ALL
  USING (public.is_business_admin(business_id))
  WITH CHECK (public.is_business_admin(business_id));

-- CONTACTS: Active members can read & create/update contacts; only Admins can delete
CREATE POLICY "Members view contacts"
  ON public.contacts FOR SELECT
  USING (public.is_business_member(business_id));

CREATE POLICY "Members insert contacts"
  ON public.contacts FOR INSERT
  WITH CHECK (public.is_business_member(business_id));

CREATE POLICY "Members update contacts"
  ON public.contacts FOR UPDATE
  USING (public.is_business_member(business_id))
  WITH CHECK (public.is_business_member(business_id));

CREATE POLICY "Admins delete contacts"
  ON public.contacts FOR DELETE
  USING (public.is_business_admin(business_id));

-- TAGS & CONTACT_TAGS
CREATE POLICY "Members view tags"
  ON public.tags FOR SELECT
  USING (public.is_business_member(business_id));

CREATE POLICY "Members manage tags"
  ON public.tags FOR ALL
  USING (public.is_business_member(business_id))
  WITH CHECK (public.is_business_member(business_id));

CREATE POLICY "Members view contact tags"
  ON public.contact_tags FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.contacts c
      WHERE c.id = contact_tags.contact_id AND public.is_business_member(c.business_id)
    )
  );

CREATE POLICY "Members manage contact tags"
  ON public.contact_tags FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.contacts c
      WHERE c.id = contact_tags.contact_id AND public.is_business_member(c.business_id)
    )
  );

-- CONVERSATIONS: Admins see all business conversations; Agents see assigned or unassigned conversations
CREATE POLICY "Authorized members view conversations"
  ON public.conversations FOR SELECT
  USING (
    public.is_business_admin(business_id)
    OR (
      public.is_business_member(business_id)
      AND (assigned_to IS NULL OR assigned_to = auth.uid())
    )
  );

CREATE POLICY "Authorized members update conversations"
  ON public.conversations FOR UPDATE
  USING (
    public.is_business_admin(business_id)
    OR (
      public.is_business_member(business_id)
      AND (assigned_to IS NULL OR assigned_to = auth.uid())
    )
  );

CREATE POLICY "Admins insert conversations"
  ON public.conversations FOR INSERT
  WITH CHECK (public.is_business_member(business_id));

-- MESSAGES & MESSAGE_EVENTS: Scoped to authorized conversations
CREATE POLICY "Authorized members view messages"
  ON public.messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.conversations cv
      WHERE cv.id = messages.conversation_id
        AND (
          public.is_business_admin(cv.business_id)
          OR (public.is_business_member(cv.business_id) AND (cv.assigned_to IS NULL OR cv.assigned_to = auth.uid()))
        )
    )
  );

CREATE POLICY "Authorized members insert messages"
  ON public.messages FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.conversations cv
      WHERE cv.id = messages.conversation_id
        AND (
          public.is_business_admin(cv.business_id)
          OR (public.is_business_member(cv.business_id) AND (cv.assigned_to IS NULL OR cv.assigned_to = auth.uid()))
        )
    )
  );

CREATE POLICY "Members view message events"
  ON public.message_events FOR SELECT
  USING (public.is_business_member(business_id));

-- TEMPLATES: All members can view approved templates for inbox use; Admins manage templates
CREATE POLICY "Members view templates"
  ON public.templates FOR SELECT
  USING (public.is_business_member(business_id));

CREATE POLICY "Admins manage templates"
  ON public.templates FOR ALL
  USING (public.is_business_admin(business_id))
  WITH CHECK (public.is_business_admin(business_id));

-- CAMPAIGNS & RECIPIENTS: Admins manage campaigns; Members can view campaign reports
CREATE POLICY "Members view campaigns"
  ON public.campaigns FOR SELECT
  USING (public.is_business_member(business_id));

CREATE POLICY "Admins manage campaigns"
  ON public.campaigns FOR ALL
  USING (public.is_business_admin(business_id))
  WITH CHECK (public.is_business_admin(business_id));

CREATE POLICY "Admins view campaign recipients"
  ON public.campaign_recipients FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.campaigns cp
      WHERE cp.id = campaign_recipients.campaign_id AND public.is_business_admin(cp.business_id)
    )
  );

-- AUTOMATION RULES: Admins manage; Members view
CREATE POLICY "Members view automation rules"
  ON public.automation_rules FOR SELECT
  USING (public.is_business_member(business_id));

CREATE POLICY "Admins manage automation rules"
  ON public.automation_rules FOR ALL
  USING (public.is_business_admin(business_id))
  WITH CHECK (public.is_business_admin(business_id));

-- AUDIT LOGS & WEBHOOK EVENTS: Admins only for audit; Edge Functions (service_role) write webhooks
CREATE POLICY "Admins view audit logs"
  ON public.audit_logs FOR SELECT
  USING (public.is_business_admin(business_id));

CREATE POLICY "Members insert audit logs"
  ON public.audit_logs FOR INSERT
  WITH CHECK (public.is_business_member(business_id));

CREATE POLICY "Admins view webhook events"
  ON public.webhook_events FOR SELECT
  USING (business_id IS NOT NULL AND public.is_business_admin(business_id));

-- ==============================================================================
-- REALTIME PUBLICATION
-- ==============================================================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.message_events;
