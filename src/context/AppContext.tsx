import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { DEFAULT_BUSINESS_HOURS, EMPTY_BUSINESS_PROFILE } from '@/data/workspaceDefaults';
import { getWindowStatus, normalizePhoneE164 } from '@/lib/phone';
import {
  isSupabaseConfigured,
  supabase,
  supabaseConfigError,
} from '@/lib/supabase';
import type { User } from '@supabase/supabase-js';
import type {
  AIAutomationLog,
  AIKnowledgeItem,
  AppNotification,
  AuditLogEntry,
  AutomationRule,
  AutomationRuleType,
  BusinessHoursDay,
  BusinessProfile,
  Campaign,
  Contact,
  Conversation,
  ConversationStatus,
  Message,
  MessageTemplate,
  MessageType,
  MetaConnectionState,
  StaffRole,
  Tag,
  TeamMember,
} from '@/types/crm';

export interface AuthSessionUser {
  id: string;
  email: string;
  fullName: string;
  role: StaffRole;
  createdAt: string;
}

export type AuthGateStatus =
  | 'loading'
  | 'unauthenticated'
  | 'unauthorized_access'
  | 'authenticated';

interface AppContextValue {
  isSupabaseReady: boolean;
  supabaseMissingReason: string | null;
  authStatus: AuthGateStatus;
  isAuthenticated: boolean;
  authLoading: boolean;
  workspaceLoading: boolean;
  authError: string | null;
  profileAccessError: string | null;
  passwordRecoveryActive: boolean;
  currentUser: AuthSessionUser | null;

  // Auth Actions
  signInWithSupabase: (
    email: string,
    password: string
  ) => Promise<{ ok: boolean; emailNotConfirmed?: boolean; error?: string }>;
  resendConfirmationEmail: (email: string) => Promise<{ ok: boolean; error?: string }>;
  requestPasswordReset: (email: string) => Promise<{ ok: boolean; error?: string }>;
  updatePassword: (newPassword: string) => Promise<{ ok: boolean; error?: string }>;
  logout: () => Promise<void>;

  // Core Data
  business: BusinessProfile;
  teamMembers: TeamMember[];
  tags: Tag[];
  contacts: Contact[];
  conversations: Conversation[];
  messages: Message[];
  templates: MessageTemplate[];
  campaigns: Campaign[];
  automationRules: AutomationRule[];
  aiKnowledge: AIKnowledgeItem[];
  aiLogs: AIAutomationLog[];
  businessHours: BusinessHoursDay[];
  auditLogs: AuditLogEntry[];
  notifications: AppNotification[];

  // Derived Totals & Global Filters / Smart Defaults
  totalUnreadCount: number;
  selectedConversationId: string | null;
  setSelectedConversationId: (id: string | null) => void;
  dateRange: 'today' | '7d' | '30d';
  setDateRange: (range: 'today' | '7d' | '30d') => void;
  recentTemplateIds: string[];
  lastAssignedMemberId: string | null;
  preferredInboxFilter: 'all' | 'mine' | 'unassigned' | 'open' | 'pending' | 'resolved';
  setPreferredInboxFilter: (f: 'all' | 'mine' | 'unassigned' | 'open' | 'pending' | 'resolved') => void;

  // Inbox Actions
  sendMessage: (params: {
    conversationId: string;
    body: string;
    messageType: MessageType;
    templateName?: string;
    mediaFilename?: string;
  }) => Promise<{ ok: boolean; error?: string }>;
  retryFailedMessage: (messageId: string) => Promise<void>;
  markConversationRead: (conversationId: string) => void;
  assignConversation: (conversationId: string, memberId: string | null) => void;
  updateConversationStatus: (conversationId: string, status: ConversationStatus) => void;
  toggleHumanHandoff: (conversationId: string, requested: boolean) => void;

  // Contacts Actions
  addContact: (input: {
    fullName: string;
    phone: string;
    email: string;
    company: string;
    city: string;
    country: string;
    marketingOptIn: boolean;
    tagIds: string[];
    notes: string;
  }) => { ok: boolean; error?: string; contact?: Contact };
  updateContact: (id: string, updates: Partial<Contact>) => { ok: boolean; error?: string };
  deleteContact: (id: string) => void;
  bulkTagContacts: (contactIds: string[], tagId: string) => void;
  importContactsBatch: (
    rows: Array<{
      fullName: string;
      phoneE164: string;
      email: string;
      company: string;
      city: string;
      country: string;
      marketingOptIn: boolean;
    }>
  ) => number;
  createTag: (name: string, color: string) => Tag;
  openOrCreateConversationForContact: (contactId: string) => string;

  // Broadcasts & Templates
  createCampaign: (input: {
    name: string;
    templateId: string;
    audienceMode?: 'all' | 'groups' | 'specific';
    targetTagIds: string[];
    targetContactIds?: string[];
    variableMapping: Record<string, string>;
    scheduleMode: 'immediate' | 'scheduled' | 'draft';
    scheduledFor?: string;
    selectedCount: number;
    eligibleCount: number;
    skippedCount: number;
  }) => Campaign;
  duplicateCampaign: (id: string) => Campaign | null;
  updateCampaignStatus: (id: string, status: Campaign['status']) => void;
  createTemplateDraft: (input: Omit<MessageTemplate, 'id' | 'approvalStatus'>) => MessageTemplate;
  updateTemplateDraft: (id: string, updates: Partial<MessageTemplate>) => void;
  syncTemplatesFromMeta: () => Promise<{ ok: boolean; message: string }>;

  // Automations
  createAutomationRule: (input: {
    name: string;
    ruleType: AutomationRuleType;
    description: string;
    isEnabled: boolean;
    triggerSummary: string;
    actionSummary: string;
    keywords?: string[];
    responseText?: string;
    assignToMemberId?: string | null;
    tagName?: string;
  }) => AutomationRule;
  toggleAutomationRule: (id: string) => void;
  updateAutomationRule: (id: string, updates: Partial<AutomationRule>) => void;
  deleteAutomationRule: (id: string) => void;

  // AI Assistant
  aiConfig: {
    enabled: boolean;
    autoReplyAuthorized: boolean;
    assistantName: string;
    provider: 'unconfigured' | 'gemini_edge' | 'openai_edge';
    tone: 'professional' | 'friendly' | 'concise';
    systemInstructions: string;
    handoffKeywords: string[];
  };
  updateAiConfig: (updates: Partial<AppContextValue['aiConfig']>) => void;
  addAiKnowledgeItem: (item: Omit<AIKnowledgeItem, 'id' | 'updatedAt'>) => void;
  deleteAiKnowledgeItem: (id: string) => void;
  runAiSandboxTest: (prompt: string) => AIAutomationLog;

  // Team & Settings
  inviteTeamMember: (fullName: string, email: string, role: StaffRole, jobTitle: string) => void;
  updateTeamMemberRole: (memberId: string, role: StaffRole) => void;
  toggleTeamMemberStatus: (memberId: string) => void;
  removeTeamMember: (memberId: string) => void;
  updateBusinessProfile: (updates: Partial<BusinessProfile>) => void;
  verifyMetaConnection: (phoneNumberId: string, wabaId: string) => Promise<{ ok: boolean; message: string }>;
  updateBusinessHours: (hours: BusinessHoursDay[]) => void;
  markNotificationRead: (id: string) => void;
  markAllNotificationsRead: () => void;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DAY_KEY_MAP: Array<{ key: string; label: string }> = [
  { key: 'monday', label: 'Monday' },
  { key: 'tuesday', label: 'Tuesday' },
  { key: 'wednesday', label: 'Wednesday' },
  { key: 'thursday', label: 'Thursday' },
  { key: 'friday', label: 'Friday' },
  { key: 'saturday', label: 'Saturday' },
  { key: 'sunday', label: 'Sunday' },
];

const AppContext = createContext<AppContextValue | undefined>(undefined);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [authStatus, setAuthStatus] = useState<AuthGateStatus>(
    isSupabaseConfigured ? 'loading' : 'unauthenticated'
  );
  const [authLoading, setAuthLoading] = useState<boolean>(isSupabaseConfigured);
  const [workspaceLoading, setWorkspaceLoading] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [profileAccessError, setProfileAccessError] = useState<string | null>(null);
  const [passwordRecoveryActive, setPasswordRecoveryActive] = useState<boolean>(false);
  const [currentUser, setCurrentUser] = useState<AuthSessionUser | null>(null);

  // Clean empty workspace state (hydrated exclusively from real Supabase tables when signed in)
  const [business, setBusiness] = useState<BusinessProfile>(EMPTY_BUSINESS_PROFILE);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [automationRules, setAutomationRules] = useState<AutomationRule[]>([]);
  const [aiKnowledge, setAiKnowledge] = useState<AIKnowledgeItem[]>([]);
  const [aiLogs, setAiLogs] = useState<AIAutomationLog[]>([]);
  const [businessHours, setBusinessHours] = useState<BusinessHoursDay[]>(DEFAULT_BUSINESS_HOURS);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<'today' | '7d' | '30d'>('7d');
  const [recentTemplateIds, setRecentTemplateIds] = useState<string[]>([]);
  const [lastAssignedMemberId, setLastAssignedMemberId] = useState<string | null>(null);
  const [preferredInboxFilter, setPreferredInboxFilter] = useState<
    'all' | 'mine' | 'unassigned' | 'open' | 'pending' | 'resolved'
  >(() => {
    const saved = localStorage.getItem('zoqniva_inbox_filter');
    if (saved && ['all', 'mine', 'unassigned', 'open', 'pending', 'resolved'].includes(saved)) {
      return saved as 'all' | 'mine' | 'unassigned' | 'open' | 'pending' | 'resolved';
    }
    return 'all';
  });

  const handleSetPreferredInboxFilter = (
    f: 'all' | 'mine' | 'unassigned' | 'open' | 'pending' | 'resolved'
  ) => {
    setPreferredInboxFilter(f);
    localStorage.setItem('zoqniva_inbox_filter', f);
  };

  const [aiConfig, setAiConfig] = useState<AppContextValue['aiConfig']>({
    enabled: false,
    autoReplyAuthorized: false,
    assistantName: 'Zoqniva Assistant',
    provider: 'unconfigured',
    tone: 'professional',
    systemInstructions: '',
    handoffKeywords: ['agent', 'human', 'manager', 'refund'],
  });

  const resetWorkspaceState = useCallback(() => {
    setBusiness(EMPTY_BUSINESS_PROFILE);
    setTeamMembers([]);
    setTags([]);
    setContacts([]);
    setConversations([]);
    setMessages([]);
    setTemplates([]);
    setCampaigns([]);
    setAutomationRules([]);
    setAiKnowledge([]);
    setAiLogs([]);
    setBusinessHours(DEFAULT_BUSINESS_HOURS);
    setAuditLogs([]);
    setNotifications([]);
    setSelectedConversationId(null);
    setRecentTemplateIds([]);
    setLastAssignedMemberId(null);
  }, []);

  // Load real Supabase records for the authenticated user without inventing any mock data
  const loadSupabaseWorkspace = useCallback(async (userId: string, knownBusinessId?: string) => {
    if (!supabase || !isSupabaseConfigured) return;
    const client = supabase;
    setWorkspaceLoading(true);

    try {
      let businessId = knownBusinessId;
      if (!businessId) {
        const { data: memberRow } = await client
          .from('business_members')
          .select('business_id, status')
          .eq('user_id', userId)
          .eq('status', 'active')
          .limit(1)
          .maybeSingle();

        businessId = memberRow?.business_id as string | undefined;
      }

      if (!businessId) {
        setWorkspaceLoading(false);
        return;
      }

      const [
        bizRes,
        waRes,
        membersRes,
        tagsRes,
        contactsRes,
        contactTagsRes,
        convsRes,
        msgsRes,
        tplsRes,
        cmpsRes,
        rulesRes,
        auditRes,
      ] = await Promise.all([
        client.from('businesses').select('*').eq('id', businessId).maybeSingle(),
        client.from('whatsapp_accounts').select('*').eq('business_id', businessId).limit(1).maybeSingle(),
        client
          .from('business_members')
          .select('id, user_id, role, status, job_title, profiles(id, full_name, email)')
          .eq('business_id', businessId),
        client.from('tags').select('*').eq('business_id', businessId),
        client.from('contacts').select('*').eq('business_id', businessId).order('created_at', { ascending: false }),
        client.from('contact_tags').select('contact_id, tag_id'),
        client
          .from('conversations')
          .select('*')
          .eq('business_id', businessId)
          .order('last_message_at', { ascending: false }),
        client
          .from('messages')
          .select('*')
          .eq('business_id', businessId)
          .order('created_at', { ascending: true }),
        client.from('templates').select('*').eq('business_id', businessId).order('created_at', { ascending: false }),
        client.from('campaigns').select('*').eq('business_id', businessId).order('created_at', { ascending: false }),
        client.from('automation_rules').select('*').eq('business_id', businessId).order('created_at', { ascending: false }),
        client
          .from('audit_logs')
          .select('id, actor_id, action, entity_type, details, created_at')
          .eq('business_id', businessId)
          .order('created_at', { ascending: false })
          .limit(20),
      ]);

      const bizData = bizRes.data as Record<string, unknown> | null;
      const waData = waRes.data as Record<string, unknown> | null;

      if (bizData) {
        setBusiness({
          id: String(bizData.id ?? ''),
          name: String(bizData.name ?? 'Your Business'),
          slug: String(bizData.slug ?? 'workspace'),
          industry: String(bizData.industry ?? ''),
          timezone: String(bizData.timezone ?? 'UTC'),
          website: String(bizData.website ?? ''),
          whatsappDisplayName: String(waData?.display_name ?? ''),
          whatsappPhoneE164: String(waData?.phone_number_e164 ?? ''),
          metaPhoneNumberId: String(waData?.meta_phone_number_id ?? ''),
          metaWabaId: String(waData?.meta_waba_id ?? ''),
          metaConnectionState: (waData?.connection_status as MetaConnectionState) ?? 'not_connected',
          metaLastError: waData?.last_error_message ? String(waData.last_error_message) : undefined,
        });

        const hoursJson = bizData.business_hours as Record<string, { enabled?: boolean; open?: string; close?: string }> | null;
        if (hoursJson && typeof hoursJson === 'object') {
          setBusinessHours(
            DAY_KEY_MAP.map(({ key, label }) => ({
              day: label,
              enabled: Boolean(hoursJson[key]?.enabled),
              open: hoursJson[key]?.open || '09:00',
              close: hoursJson[key]?.close || '18:00',
            }))
          );
        }

        const aiJson = bizData.ai_settings as Record<string, unknown> | null;
        if (aiJson && typeof aiJson === 'object') {
          setAiConfig({
            enabled: Boolean(aiJson.enabled),
            autoReplyAuthorized: Boolean(aiJson.auto_reply_authorized),
            assistantName: String(aiJson.assistant_name ?? 'Zoqniva Assistant'),
            provider: (aiJson.provider as 'unconfigured' | 'gemini_edge' | 'openai_edge') ?? 'unconfigured',
            tone: (aiJson.tone as 'professional' | 'friendly' | 'concise') ?? 'professional',
            systemInstructions: String(aiJson.system_instructions ?? ''),
            handoffKeywords: Array.isArray(aiJson.handoff_keywords)
              ? aiJson.handoff_keywords.map(String)
              : ['agent', 'human', 'manager', 'refund'],
          });
        }
      }

      const convList: Conversation[] = (convsRes.data ?? []).map((c: Record<string, unknown>) => ({
        id: String(c.id),
        contactId: String(c.contact_id),
        assignedToId: c.assigned_to ? String(c.assigned_to) : null,
        status: (c.status as ConversationStatus) ?? 'open',
        unreadCount: Number(c.unread_count ?? 0),
        humanHandoffRequested: Boolean(c.human_handoff_requested),
        lastCustomerMessageAt: String(c.last_customer_message_at ?? c.created_at ?? new Date().toISOString()),
        windowExpiresAt: String(c.window_expires_at ?? new Date(0).toISOString()),
        lastMessagePreview: String(c.last_message_preview ?? ''),
        lastMessageAt: String(c.last_message_at ?? c.created_at ?? new Date().toISOString()),
      }));
      setConversations(convList);

      const memberList: TeamMember[] = (membersRes.data ?? []).map((m: Record<string, unknown>) => {
        const prof = Array.isArray(m.profiles)
          ? (m.profiles[0] as Record<string, unknown> | undefined)
          : (m.profiles as Record<string, unknown> | undefined);
        const profileId = String(m.user_id ?? prof?.id ?? m.id);
        return {
          id: profileId,
          fullName: String(prof?.full_name ?? 'Team Member'),
          email: String(prof?.email ?? ''),
          role: (m.role as StaffRole) ?? 'agent',
          status: (m.status as 'active' | 'invited' | 'suspended') ?? 'active',
          jobTitle: String(m.job_title ?? ''),
          activeConversations: convList.filter(
            (cv) => cv.assignedToId === profileId && cv.status !== 'resolved'
          ).length,
          resolvedToday: convList.filter(
            (cv) => cv.assignedToId === profileId && cv.status === 'resolved'
          ).length,
        };
      });
      setTeamMembers(memberList);

      setTags(
        (tagsRes.data ?? []).map((t: Record<string, unknown>) => ({
          id: String(t.id),
          name: String(t.name),
          color: String(t.color ?? '#2563EB'),
        }))
      );

      const tagMap = new Map<string, string[]>();
      for (const ct of (contactTagsRes.data ?? []) as Array<{ contact_id: string; tag_id: string }>) {
        const list = tagMap.get(ct.contact_id) ?? [];
        list.push(ct.tag_id);
        tagMap.set(ct.contact_id, list);
      }

      setContacts(
        (contactsRes.data ?? []).map((c: Record<string, unknown>) => ({
          id: String(c.id),
          fullName: String(c.full_name),
          phoneE164: String(c.phone_e164),
          email: String(c.email ?? ''),
          company: String(c.company ?? ''),
          city: String(c.city ?? ''),
          country: String(c.country ?? ''),
          marketingOptIn: Boolean(c.marketing_opt_in),
          optedOutAt: c.opted_out_at ? String(c.opted_out_at) : undefined,
          tagIds: tagMap.get(String(c.id)) ?? [],
          notes: String(c.notes ?? ''),
          lastContactedAt: c.last_contacted_at ? String(c.last_contacted_at) : undefined,
          createdAt: String(c.created_at ?? new Date().toISOString()),
        }))
      );

      setMessages(
        (msgsRes.data ?? []).map((m: Record<string, unknown>) => {
          const senderId = m.sender_profile_id ? String(m.sender_profile_id) : undefined;
          const senderMember = memberList.find((tm) => tm.id === senderId);
          return {
            id: String(m.id),
            conversationId: String(m.conversation_id),
            senderType: (m.sender_type as Message['senderType']) ?? 'contact',
            senderName:
              senderMember?.fullName ??
              (m.sender_type === 'contact' ? 'Customer' : m.sender_type === 'ai' ? 'AI Assistant' : 'Team'),
            senderId,
            direction: (m.direction as Message['direction']) ?? 'inbound',
            messageType: (m.message_type as MessageType) ?? 'text',
            body: String(m.body ?? ''),
            mediaUrl: m.media_url ? String(m.media_url) : undefined,
            mediaFilename: m.media_filename ? String(m.media_filename) : undefined,
            templateName: m.template_name ? String(m.template_name) : undefined,
            deliveryStatus: (m.delivery_status as Message['deliveryStatus']) ?? 'queued',
            errorCode: m.error_code ? String(m.error_code) : undefined,
            errorMessage: m.error_message ? String(m.error_message) : undefined,
            createdAt: String(m.created_at ?? new Date().toISOString()),
          };
        })
      );

      setTemplates(
        (tplsRes.data ?? []).map((t: Record<string, unknown>) => ({
          id: String(t.id),
          name: String(t.name),
          category: (t.category as MessageTemplate['category']) ?? 'UTILITY',
          language: String(t.language ?? 'en_US'),
          headerType: (t.header_type as MessageTemplate['headerType']) ?? 'NONE',
          headerText: t.header_text ? String(t.header_text) : undefined,
          bodyText: String(t.body_text ?? ''),
          footerText: t.footer_text ? String(t.footer_text) : undefined,
          buttons: Array.isArray(t.buttons) ? (t.buttons as MessageTemplate['buttons']) : [],
          variablesCount: Number(t.variables_count ?? 0),
          approvalStatus: (t.approval_status as MessageTemplate['approvalStatus']) ?? 'DRAFT',
          rejectionReason: t.rejection_reason ? String(t.rejection_reason) : undefined,
          lastSyncedAt: t.last_synced_at ? String(t.last_synced_at) : undefined,
        }))
      );

      setCampaigns(
        (cmpsRes.data ?? []).map((cp: Record<string, unknown>) => ({
          id: String(cp.id),
          name: String(cp.name),
          templateId: String(cp.template_id),
          status: (cp.status as Campaign['status']) ?? 'draft',
          targetTagIds: Array.isArray(cp.target_tag_ids) ? cp.target_tag_ids.map(String) : [],
          variableMapping: (cp.variable_mapping as Record<string, string>) ?? {},
          scheduledFor: cp.scheduled_for ? String(cp.scheduled_for) : undefined,
          createdAt: String(cp.created_at ?? new Date().toISOString()),
          metrics: {
            selected: Number(cp.selected_count ?? 0),
            eligible: Number(cp.eligible_count ?? 0),
            submitted: Number(cp.submitted_count ?? 0),
            sent: Number(cp.sent_count ?? 0),
            delivered: Number(cp.delivered_count ?? 0),
            read: Number(cp.read_count ?? 0),
            failed: Number(cp.failed_count ?? 0),
            skipped: Number(cp.skipped_count ?? 0),
          },
        }))
      );

      setAutomationRules(
        (rulesRes.data ?? []).map((r: Record<string, unknown>) => {
          const triggerCfg = (r.trigger_config as Record<string, unknown>) ?? {};
          const actionCfg = (r.action_config as Record<string, unknown>) ?? {};
          return {
            id: String(r.id),
            name: String(r.name),
            ruleType: (r.rule_type as AutomationRuleType) ?? 'keyword_reply',
            description: String(r.description ?? ''),
            isEnabled: Boolean(r.is_enabled),
            triggerSummary: String(triggerCfg.summary ?? r.description ?? ''),
            actionSummary: String(actionCfg.summary ?? ''),
            keywords: Array.isArray(triggerCfg.keywords) ? triggerCfg.keywords.map(String) : undefined,
            responseText: actionCfg.responseText ? String(actionCfg.responseText) : undefined,
            assignToMemberId: actionCfg.assignToMemberId ? String(actionCfg.assignToMemberId) : undefined,
            tagName: actionCfg.tagName ? String(actionCfg.tagName) : undefined,
            executionCount: Number(r.execution_count ?? 0),
          };
        })
      );

      setAuditLogs(
        (auditRes.data ?? []).map((a: Record<string, unknown>) => {
          const actor = memberList.find((tm) => tm.id === String(a.actor_id ?? ''));
          const detailsObj = a.details as Record<string, unknown> | null;
          return {
            id: String(a.id),
            actorName: actor?.fullName ?? 'Team Member',
            action: String(a.action),
            entityType: String(a.entity_type),
            timestamp: String(a.created_at ?? new Date().toISOString()),
            details:
              typeof detailsObj?.summary === 'string'
                ? detailsObj.summary
                : JSON.stringify(detailsObj ?? {}),
          };
        })
      );
    } finally {
      setWorkspaceLoading(false);
    }
  }, []);

  const resolveAuthenticatedUser = useCallback(
    async (authUser: User) => {
      if (!supabase || !isSupabaseConfigured) return;
      const client = supabase;

      // Step 2: Load signed-in user's profile from public.profiles
      const { data: profile, error: profileErr } = await client
        .from('profiles')
        .select('id, email, full_name, created_at')
        .eq('id', authUser.id)
        .maybeSingle();

      if (profileErr || !profile) {
        setCurrentUser(null);
        resetWorkspaceState();
        setProfileAccessError(
          profileErr
            ? `Unable to verify staff profile: ${profileErr.message}`
            : 'Access denied: no staff profile was found for your account in public.profiles.'
        );
        setAuthStatus('unauthorized_access');
        return;
      }

      // Step 3 & 5: Find active business membership and authoritative role from business_members
      const { data: memberRows, error: memberErr } = await client
        .from('business_members')
        .select('id, business_id, role, status, job_title')
        .eq('user_id', authUser.id);

      if (memberErr) {
        setCurrentUser(null);
        resetWorkspaceState();
        setProfileAccessError(
          `Unable to verify business membership: ${memberErr.message}`
        );
        setAuthStatus('unauthorized_access');
        return;
      }

      const rows = (memberRows ?? []) as Array<{
        id: string;
        business_id: string;
        role: string;
        status: string;
        job_title?: string | null;
      }>;

      const activeMember = rows.find((m) => m.status === 'active');
      if (!activeMember) {
        const suspended = rows.some((m) => m.status === 'suspended');
        const invited = rows.some((m) => m.status === 'invited');
        setCurrentUser(null);
        resetWorkspaceState();
        setProfileAccessError(
          suspended
            ? 'Access denied: your business membership has been suspended by an administrator.'
            : invited
            ? 'Access denied: your business membership is pending activation.'
            : 'Access denied: no active business membership was found for your account.'
        );
        setAuthStatus('unauthorized_access');
        return;
      }

      const validRole: StaffRole | null =
        activeMember.role === 'admin' || activeMember.role === 'agent'
          ? (activeMember.role as StaffRole)
          : null;

      if (!validRole) {
        setCurrentUser(null);
        resetWorkspaceState();
        setProfileAccessError(
          'Access denied: your business membership does not have an authorized CRM role (admin or agent).'
        );
        setAuthStatus('unauthorized_access');
        return;
      }

      // Step 4: Verify associated business record is accessible under RLS
      const { data: bizData, error: bizErr } = await client
        .from('businesses')
        .select('id, name, slug, industry, timezone, website')
        .eq('id', activeMember.business_id)
        .maybeSingle();

      if (bizErr || !bizData) {
        setCurrentUser(null);
        resetWorkspaceState();
        setProfileAccessError(
          bizErr
            ? `Unable to load business workspace: ${bizErr.message}`
            : 'Access denied: associated business workspace could not be loaded.'
        );
        setAuthStatus('unauthorized_access');
        return;
      }

      // Step 6: Set authoritative user profile, role from business_members, and business workspace
      setProfileAccessError(null);
      setBusiness((prev) => ({
        ...prev,
        id: String(bizData.id),
        name: String(bizData.name),
        slug: String(bizData.slug),
        industry: String(bizData.industry ?? ''),
        timezone: String(bizData.timezone ?? 'UTC'),
        website: String(bizData.website ?? ''),
      }));
      setCurrentUser({
        id: String(profile.id),
        email: String(profile.email || authUser.email || ''),
        fullName: String(profile.full_name || authUser.email || 'Staff Member'),
        role: validRole,
        createdAt: String(profile.created_at || new Date().toISOString()),
      });
      setAuthStatus('authenticated');
      await loadSupabaseWorkspace(authUser.id, activeMember.business_id);
    },
    [loadSupabaseWorkspace, resetWorkspaceState]
  );

  // Clear any legacy demo storage and initialize Supabase Auth session
  useEffect(() => {
    sessionStorage.removeItem('zoqniva_demo_role');
    sessionStorage.removeItem('zoqniva_pending_setup');

    if (!isSupabaseConfigured || !supabase) {
      setAuthStatus('unauthenticated');
      setAuthLoading(false);
      return;
    }

    const client = supabase;
    let active = true;

    const initializeAuth = async () => {
      const { data, error } = await client.auth.getUser();
      if (!active) return;

      if (error || !data.user) {
        setCurrentUser(null);
        setProfileAccessError(null);
        setAuthStatus('unauthenticated');
        resetWorkspaceState();
      } else {
        await resolveAuthenticatedUser(data.user);
      }
      if (active) setAuthLoading(false);
    };

    void initializeAuth();

    const { data: listener } = client.auth.onAuthStateChange((event, session) => {
      if (!active) return;

      if (event === 'PASSWORD_RECOVERY') {
        setPasswordRecoveryActive(true);
      }

      if (event === 'SIGNED_OUT' || !session?.user) {
        setCurrentUser(null);
        setProfileAccessError(null);
        setPasswordRecoveryActive(false);
        setAuthStatus('unauthenticated');
        resetWorkspaceState();
        setAuthLoading(false);
        return;
      }

      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
        void (async () => {
          const { data: userRes, error: userErr } = await client.auth.getUser();
          if (!active) return;
          if (userErr || !userRes.user) {
            setCurrentUser(null);
            setAuthStatus('unauthenticated');
            resetWorkspaceState();
          } else {
            await resolveAuthenticatedUser(userRes.user);
          }
          if (active) setAuthLoading(false);
        })();
      }
    });

    const channel = client
      .channel('zoqniva-inbox-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'messages' },
        () => {
          void client.auth.getUser().then(({ data }) => {
            if (data.user) {
              void loadSupabaseWorkspace(data.user.id);
            }
          });
        }
      )
      .subscribe();

    return () => {
      active = false;
      listener.subscription.unsubscribe();
      void client.removeChannel(channel);
    };
  }, [loadSupabaseWorkspace, resetWorkspaceState, resolveAuthenticatedUser]);

  const appendAudit = (action: string, entityType: string, details: string) => {
    setAuditLogs((prev) => [
      {
        id: `aud-${Date.now()}`,
        actorName: currentUser?.fullName ?? 'System',
        action,
        entityType,
        timestamp: new Date().toISOString(),
        details,
      },
      ...prev,
    ]);
    if (supabase && isSupabaseConfigured && UUID_REGEX.test(business.id)) {
      void supabase.from('audit_logs').insert({
        business_id: business.id,
        actor_id: currentUser?.id ?? null,
        action,
        entity_type: entityType,
        details: { summary: details },
      });
    }
  };

  const signInWithSupabase: AppContextValue['signInWithSupabase'] = async (email, password) => {
    if (!supabase || !isSupabaseConfigured) {
      const msg = supabaseConfigError || 'Supabase configuration is required to sign in.';
      setAuthError(msg);
      return { ok: false, error: msg };
    }
    setAuthError(null);
    setProfileAccessError(null);
    setAuthLoading(true);

    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (error) {
      setAuthLoading(false);
      setAuthError(error.message);
      const unconfirmed = error.message.toLowerCase().includes('email not confirmed');
      return { ok: false, emailNotConfirmed: unconfirmed, error: error.message };
    }

    const { data: userRes, error: userErr } = await supabase.auth.getUser();
    const verifiedUser = userRes.user ?? data.user;
    if (userErr || !verifiedUser) {
      setAuthLoading(false);
      const errMsg = userErr?.message || 'Unable to verify authenticated session.';
      setAuthError(errMsg);
      return { ok: false, error: errMsg };
    }

    await resolveAuthenticatedUser(verifiedUser);
    setAuthLoading(false);
    return { ok: true };
  };

  const resendConfirmationEmail: AppContextValue['resendConfirmationEmail'] = async (email) => {
    if (!supabase || !isSupabaseConfigured) {
      return { ok: false, error: 'Supabase configuration is required.' };
    }
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: email.trim(),
      options: {
        emailRedirectTo: `${window.location.origin}/login`,
      },
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  };

  const requestPasswordReset: AppContextValue['requestPasswordReset'] = async (email) => {
    if (!supabase || !isSupabaseConfigured) {
      return { ok: false, error: 'Supabase configuration is required.' };
    }
    setAuthError(null);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) {
      setAuthError(error.message);
      return { ok: false, error: error.message };
    }
    return { ok: true };
  };

  const updatePassword: AppContextValue['updatePassword'] = async (newPassword) => {
    if (!supabase || !isSupabaseConfigured) {
      return { ok: false, error: 'Supabase configuration is required.' };
    }
    setAuthError(null);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) {
      setAuthError(error.message);
      return { ok: false, error: error.message };
    }
    setPasswordRecoveryActive(false);
    const { data: userRes } = await supabase.auth.getUser();
    if (userRes.user) {
      await resolveAuthenticatedUser(userRes.user);
    }
    return { ok: true };
  };

  const logout = async () => {
    sessionStorage.removeItem('zoqniva_demo_role');
    sessionStorage.removeItem('zoqniva_pending_setup');
    if (supabase && isSupabaseConfigured) {
      await supabase.auth.signOut();
    }
    setCurrentUser(null);
    setAuthError(null);
    setProfileAccessError(null);
    setPasswordRecoveryActive(false);
    setAuthStatus('unauthenticated');
    resetWorkspaceState();
  };

  const totalUnreadCount = useMemo(
    () => conversations.reduce((sum, c) => sum + c.unreadCount, 0),
    [conversations]
  );

  // ============================================================================
  // INBOX OPERATIONS (Respecting 24h Window & Honest Delivery States)
  // ============================================================================
  const sendMessage: AppContextValue['sendMessage'] = async ({
    conversationId,
    body,
    messageType,
    templateName,
    mediaFilename,
  }) => {
    const conv = conversations.find((c) => c.id === conversationId);
    if (!conv) return { ok: false, error: 'Conversation not found.' };

    const trimmed = body.trim();
    if (!trimmed) return { ok: false, error: 'Message content cannot be empty.' };

    if (messageType === 'internal_note') {
      const noteMsg: Message = {
        id: `msg-${Date.now()}`,
        conversationId,
        senderType: 'agent',
        senderName: currentUser?.fullName ?? 'Agent',
        senderId: currentUser?.id,
        direction: 'internal',
        messageType: 'internal_note',
        body: trimmed,
        deliveryStatus: 'internal',
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, noteMsg]);
      return { ok: true };
    }

    const windowState = getWindowStatus(conv.windowExpiresAt);
    if (!windowState.isOpen && messageType !== 'template') {
      return {
        ok: false,
        error:
          'The 24-hour customer service window is closed. You must send an approved WhatsApp template message.',
      };
    }

    const isMetaConnected = business.metaConnectionState === 'connected';

    if (supabase && isSupabaseConfigured && isMetaConnected) {
      const { data, error } = await supabase.functions.invoke('send-whatsapp-message', {
        body: {
          conversationId,
          messageType,
          body: trimmed,
          templateName,
        },
      });

      if (error || !data?.metaMessageId) {
        const errMsg: Message = {
          id: `msg-${Date.now()}`,
          conversationId,
          senderType: 'agent',
          senderName: currentUser?.fullName ?? 'Agent',
          senderId: currentUser?.id,
          direction: 'outbound',
          messageType,
          body: trimmed,
          templateName,
          mediaFilename,
          deliveryStatus: 'failed',
          errorCode: data?.code ?? 'EDGE_FUNCTION_ERROR',
          errorMessage: error?.message ?? data?.error ?? 'Failed to dispatch via Meta Cloud API.',
          createdAt: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, errMsg]);
        return { ok: false, error: errMsg.errorMessage };
      }
    }

    const deliveryStatus = isMetaConnected ? 'sent' : 'failed';
    const newMsg: Message = {
      id: `msg-${Date.now()}`,
      conversationId,
      senderType: 'agent',
      senderName: currentUser?.fullName ?? 'Agent',
      senderId: currentUser?.id,
      direction: 'outbound',
      messageType,
      body: trimmed,
      templateName,
      mediaFilename,
      deliveryStatus,
      errorCode: isMetaConnected ? undefined : 'META_NOT_CONNECTED',
      errorMessage: isMetaConnected
        ? undefined
        : 'Meta WhatsApp Cloud API is not connected to transmit this message.',
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, newMsg]);
    setConversations((prev) =>
      prev.map((c) =>
        c.id === conversationId
          ? {
              ...c,
              lastMessagePreview: trimmed,
              lastMessageAt: newMsg.createdAt,
              unreadCount: 0,
            }
          : c
      )
    );

    return { ok: true };
  };

  const retryFailedMessage = async (messageId: string) => {
    const target = messages.find((m) => m.id === messageId);
    if (!target) return;

    if (business.metaConnectionState !== 'connected') {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? {
                ...m,
                errorMessage:
                  'Cannot retry delivery: Connect your WhatsApp account in Settings first.',
              }
            : m
        )
      );
      return;
    }

    await sendMessage({
      conversationId: target.conversationId,
      body: target.body,
      messageType: target.messageType,
      templateName: target.templateName,
      mediaFilename: target.mediaFilename,
    });
  };

  const markConversationRead = (conversationId: string) => {
    setConversations((prev) =>
      prev.map((c) => (c.id === conversationId ? { ...c, unreadCount: 0 } : c))
    );
  };

  const assignConversation = (conversationId: string, memberId: string | null) => {
    setConversations((prev) =>
      prev.map((c) => (c.id === conversationId ? { ...c, assignedToId: memberId } : c))
    );
    if (memberId) setLastAssignedMemberId(memberId);
    const memberName = teamMembers.find((m) => m.id === memberId)?.fullName ?? 'Unassigned';
    appendAudit('Assigned Conversation', 'conversation', `Assigned ${conversationId} to ${memberName}`);
  };

  const updateConversationStatus = (conversationId: string, status: ConversationStatus) => {
    setConversations((prev) =>
      prev.map((c) => (c.id === conversationId ? { ...c, status } : c))
    );
    appendAudit('Updated Conversation Status', 'conversation', `Marked ${conversationId} as ${status}`);
  };

  const toggleHumanHandoff = (conversationId: string, requested: boolean) => {
    setConversations((prev) =>
      prev.map((c) =>
        c.id === conversationId ? { ...c, humanHandoffRequested: requested } : c
      )
    );
  };

  // ============================================================================
  // CONTACTS CRUD, CSV IMPORT & TAGGING
  // ============================================================================
  const addContact: AppContextValue['addContact'] = (input) => {
    const normalized = normalizePhoneE164(input.phone);
    if (!normalized) {
      return {
        ok: false,
        error: 'Enter a valid international phone number in E.164 format (e.g., +15551234567).',
      };
    }
    if (contacts.some((c) => c.phoneE164 === normalized)) {
      return {
        ok: false,
        error: `A contact with phone number ${normalized} already exists.`,
      };
    }
    const created: Contact = {
      id: `cnt-${Date.now()}`,
      fullName: input.fullName.trim(),
      phoneE164: normalized,
      email: input.email.trim(),
      company: input.company.trim(),
      city: input.city.trim(),
      country: input.country.trim(),
      marketingOptIn: input.marketingOptIn,
      tagIds: input.tagIds,
      notes: input.notes.trim(),
      createdAt: new Date().toISOString(),
    };
    setContacts((prev) => [created, ...prev]);

    if (supabase && isSupabaseConfigured && UUID_REGEX.test(business.id)) {
      void supabase
        .from('contacts')
        .insert({
          business_id: business.id,
          full_name: created.fullName,
          phone_e164: created.phoneE164,
          email: created.email || null,
          company: created.company || null,
          city: created.city || null,
          country: created.country || null,
          marketing_opt_in: created.marketingOptIn,
          notes: created.notes,
          created_by: currentUser?.id ?? null,
        })
        .select('id')
        .single()
        .then(({ data }) => {
          if (data?.id) {
            setContacts((prev) =>
              prev.map((c) => (c.id === created.id ? { ...c, id: String(data.id) } : c))
            );
          }
        });
    }

    appendAudit('Created Contact', 'contact', `${created.fullName} (${created.phoneE164})`);
    return { ok: true, contact: created };
  };

  const updateContact: AppContextValue['updateContact'] = (id, updates) => {
    if (updates.phoneE164) {
      const normalized = normalizePhoneE164(updates.phoneE164);
      if (!normalized) {
        return { ok: false, error: 'Invalid international E.164 phone format.' };
      }
      if (contacts.some((c) => c.id !== id && c.phoneE164 === normalized)) {
        return { ok: false, error: `Phone ${normalized} belongs to another contact.` };
      }
      updates.phoneE164 = normalized;
    }

    setContacts((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c;
        const optOutStamp =
          updates.marketingOptIn === false && c.marketingOptIn
            ? new Date().toISOString()
            : updates.marketingOptIn === true
            ? undefined
            : c.optedOutAt;
        return { ...c, ...updates, optedOutAt: optOutStamp };
      })
    );
    return { ok: true };
  };

  const deleteContact = (id: string) => {
    const target = contacts.find((c) => c.id === id);
    setContacts((prev) => prev.filter((c) => c.id !== id));
    setConversations((prev) => prev.filter((cv) => cv.contactId !== id));
    if (supabase && isSupabaseConfigured && UUID_REGEX.test(id)) {
      void supabase.from('contacts').delete().eq('id', id);
    }
    if (target) {
      appendAudit('Deleted Contact', 'contact', `${target.fullName} (${target.phoneE164})`);
    }
  };

  const bulkTagContacts = (contactIds: string[], tagId: string) => {
    const idSet = new Set(contactIds);
    setContacts((prev) =>
      prev.map((c) =>
        idSet.has(c.id) && !c.tagIds.includes(tagId)
          ? { ...c, tagIds: [...c.tagIds, tagId] }
          : c
      )
    );
    const tagName = tags.find((t) => t.id === tagId)?.name ?? tagId;
    appendAudit('Bulk Tagged Contacts', 'contact', `Applied "${tagName}" to ${contactIds.length} contacts`);
  };

  const importContactsBatch: AppContextValue['importContactsBatch'] = (rows) => {
    const existing = new Set(contacts.map((c) => c.phoneE164));
    const toAdd: Contact[] = [];

    for (const row of rows) {
      if (!existing.has(row.phoneE164)) {
        existing.add(row.phoneE164);
        toAdd.push({
          id: `cnt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          fullName: row.fullName,
          phoneE164: row.phoneE164,
          email: row.email,
          company: row.company,
          city: row.city,
          country: row.country,
          marketingOptIn: row.marketingOptIn,
          tagIds: [],
          notes: 'Imported via CSV',
          createdAt: new Date().toISOString(),
        });
      }
    }

    if (toAdd.length > 0) {
      setContacts((prev) => [...toAdd, ...prev]);
      appendAudit('Imported Contacts CSV', 'contact', `Imported ${toAdd.length} normalized contacts`);
    }
    return toAdd.length;
  };

  const createTag = (name: string, color: string): Tag => {
    const existing = tags.find((t) => t.name.toLowerCase() === name.trim().toLowerCase());
    if (existing) return existing;
    const tag: Tag = {
      id: `tag-${Date.now()}`,
      name: name.trim(),
      color,
    };
    setTags((prev) => [...prev, tag]);
    return tag;
  };

  const openOrCreateConversationForContact = (contactId: string): string => {
    const existing = conversations.find((c) => c.contactId === contactId);
    if (existing) {
      setSelectedConversationId(existing.id);
      return existing.id;
    }
    const created: Conversation = {
      id: `conv-${Date.now()}`,
      contactId,
      assignedToId: currentUser?.id ?? null,
      status: 'open',
      unreadCount: 0,
      humanHandoffRequested: false,
      lastCustomerMessageAt: new Date(0).toISOString(),
      windowExpiresAt: new Date(0).toISOString(),
      lastMessagePreview: 'New conversation started — send an approved template to initiate.',
      lastMessageAt: new Date().toISOString(),
    };
    setConversations((prev) => [created, ...prev]);
    setSelectedConversationId(created.id);
    return created.id;
  };

  // ============================================================================
  // BROADCASTS & TEMPLATES
  // ============================================================================
  const createCampaign: AppContextValue['createCampaign'] = (input) => {
    const isMetaLive = business.metaConnectionState === 'connected';
    const nextStatus: Campaign['status'] =
      input.scheduleMode === 'draft'
        ? 'draft'
        : input.scheduleMode === 'scheduled'
        ? 'scheduled'
        : isMetaLive
        ? 'running'
        : 'draft';

    const campaign: Campaign = {
      id: `cmp-${Date.now()}`,
      name: input.name.trim(),
      templateId: input.templateId,
      status: nextStatus,
      audienceMode: input.audienceMode ?? 'groups',
      targetTagIds: input.targetTagIds,
      targetContactIds: input.targetContactIds,
      variableMapping: input.variableMapping,
      scheduledFor: input.scheduledFor,
      createdAt: new Date().toISOString(),
      metrics: {
        selected: input.selectedCount,
        eligible: input.eligibleCount,
        submitted: 0,
        sent: 0,
        delivered: 0,
        read: 0,
        failed: 0,
        skipped: input.skippedCount,
      },
    };
    setCampaigns((prev) => [campaign, ...prev]);
    setRecentTemplateIds((prev) =>
      [input.templateId, ...prev.filter((tid) => tid !== input.templateId)].slice(0, 5)
    );
    appendAudit('Created Broadcast Campaign', 'campaign', `${campaign.name} (${campaign.metrics.eligible} eligible)`);
    return campaign;
  };

  const duplicateCampaign = (id: string): Campaign | null => {
    const source = campaigns.find((c) => c.id === id);
    if (!source) return null;
    const copy: Campaign = {
      ...source,
      id: `cmp-${Date.now()}`,
      name: `${source.name} (Copy)`,
      status: 'draft',
      createdAt: new Date().toISOString(),
      scheduledFor: undefined,
      metrics: {
        selected: source.metrics.selected,
        eligible: source.metrics.eligible,
        submitted: 0,
        sent: 0,
        delivered: 0,
        read: 0,
        failed: 0,
        skipped: source.metrics.skipped,
      },
    };
    setCampaigns((prev) => [copy, ...prev]);
    appendAudit('Duplicated Campaign', 'campaign', `Duplicated ${source.name}`);
    return copy;
  };

  const updateCampaignStatus = (id: string, status: Campaign['status']) => {
    setCampaigns((prev) => prev.map((c) => (c.id === id ? { ...c, status } : c)));
  };

  const createTemplateDraft = (
    input: Omit<MessageTemplate, 'id' | 'approvalStatus'>
  ): MessageTemplate => {
    const draft: MessageTemplate = {
      ...input,
      id: `tpl-${Date.now()}`,
      approvalStatus: 'DRAFT',
    };
    setTemplates((prev) => [draft, ...prev]);
    appendAudit('Created Template Draft', 'template', draft.name);
    return draft;
  };

  const updateTemplateDraft = (id: string, updates: Partial<MessageTemplate>) => {
    setTemplates((prev) =>
      prev.map((t) => (t.id === id && t.approvalStatus === 'DRAFT' ? { ...t, ...updates } : t))
    );
  };

  const syncTemplatesFromMeta = async (): Promise<{ ok: boolean; message: string }> => {
    if (business.metaConnectionState !== 'connected') {
      return {
        ok: false,
        message: 'Connect your Meta WhatsApp Cloud API account in Settings before syncing templates.',
      };
    }
    if (supabase && isSupabaseConfigured) {
      const { data, error } = await supabase.functions.invoke('sync-templates');
      if (error) return { ok: false, message: error.message };
      if (currentUser?.id) {
        await loadSupabaseWorkspace(currentUser.id);
      }
      return { ok: true, message: `Synced ${data?.templatesCount ?? 0} templates from Meta.` };
    }
    return {
      ok: false,
      message: 'Supabase configuration is required to synchronize live WhatsApp templates.',
    };
  };

  // ============================================================================
  // AUTOMATION & AI ASSISTANT
  // ============================================================================
  const createAutomationRule: AppContextValue['createAutomationRule'] = (input) => {
    const created: AutomationRule = {
      id: `rule-${Date.now()}`,
      name: input.name,
      ruleType: input.ruleType,
      description: input.description,
      isEnabled: input.isEnabled,
      triggerSummary: input.triggerSummary,
      actionSummary: input.actionSummary,
      keywords: input.keywords,
      responseText: input.responseText,
      assignToMemberId: input.assignToMemberId,
      tagName: input.tagName,
      executionCount: 0,
    };
    setAutomationRules((prev) => [created, ...prev]);
    appendAudit('Created Automation Rule', 'automation_rule', created.name);
    return created;
  };

  const toggleAutomationRule = (id: string) => {
    setAutomationRules((prev) =>
      prev.map((r) => (r.id === id ? { ...r, isEnabled: !r.isEnabled } : r))
    );
  };

  const updateAutomationRule = (id: string, updates: Partial<AutomationRule>) => {
    setAutomationRules((prev) => prev.map((r) => (r.id === id ? { ...r, ...updates } : r)));
  };

  const deleteAutomationRule = (id: string) => {
    const target = automationRules.find((r) => r.id === id);
    setAutomationRules((prev) => prev.filter((r) => r.id !== id));
    if (target) {
      appendAudit('Deleted Automation Rule', 'automation_rule', target.name);
    }
  };

  const updateAiConfig = (updates: Partial<AppContextValue['aiConfig']>) => {
    setAiConfig((prev) => ({ ...prev, ...updates }));
  };

  const addAiKnowledgeItem = (item: Omit<AIKnowledgeItem, 'id' | 'updatedAt'>) => {
    setAiKnowledge((prev) => [
      {
        ...item,
        id: `kb-${Date.now()}`,
        updatedAt: new Date().toISOString(),
      },
      ...prev,
    ]);
  };

  const deleteAiKnowledgeItem = (id: string) => {
    setAiKnowledge((prev) => prev.filter((k) => k.id !== id));
  };

  const runAiSandboxTest = (prompt: string): AIAutomationLog => {
    const lower = prompt.toLowerCase();
    const matchedHandoff = aiConfig.handoffKeywords.find((kw) => lower.includes(kw.toLowerCase()));
    const matchedKb = aiKnowledge.find(
      (kb) =>
        lower.includes(kb.category.toLowerCase()) ||
        kb.title
          .toLowerCase()
          .split(/\s+/)
          .some((w) => w.length > 3 && lower.includes(w))
    );

    let generatedReply = '';
    let outcome: AIAutomationLog['outcome'] = 'sandbox_preview';

    if (matchedHandoff) {
      outcome = 'handoff_triggered';
      generatedReply = `Human handoff triggered on keyword "${matchedHandoff}". Live automated replies pause immediately and the conversation escalates to Team Inbox.`;
    } else if (matchedKb) {
      generatedReply = `[Sandbox Preview · Tone: ${aiConfig.tone}] Based on "${matchedKb.title}": ${matchedKb.content}`;
    } else if (aiKnowledge.length === 0) {
      generatedReply = `[Sandbox Preview · ${aiConfig.assistantName}] No business knowledge entries added yet. Add your policies or FAQs so the assistant can answer accurately.`;
    } else {
      generatedReply = `[Sandbox Preview · ${aiConfig.assistantName}] No matching knowledge entry found for that question. The conversation can be routed to a team member.`;
    }

    const log: AIAutomationLog = {
      id: `ailog-${Date.now()}`,
      timestamp: new Date().toISOString(),
      channel: 'sandbox_test',
      customerPrompt: prompt,
      generatedReply,
      outcome,
    };
    setAiLogs((prev) => [log, ...prev]);
    return log;
  };

  // ============================================================================
  // TEAM & SETTINGS
  // ============================================================================
  const inviteTeamMember = (
    fullName: string,
    email: string,
    role: StaffRole,
    jobTitle: string
  ) => {
    setTeamMembers((prev) => [
      ...prev,
      {
        id: `usr-${Date.now()}`,
        fullName: fullName.trim(),
        email: email.trim().toLowerCase(),
        role,
        status: 'invited',
        jobTitle: jobTitle.trim() || 'Support Specialist',
        activeConversations: 0,
        resolvedToday: 0,
      },
    ]);
    appendAudit('Invited Team Member', 'business_member', `${fullName} (${role})`);
  };

  const updateTeamMemberRole = (memberId: string, role: StaffRole) => {
    setTeamMembers((prev) => prev.map((m) => (m.id === memberId ? { ...m, role } : m)));
    appendAudit('Updated Member Role', 'business_member', `Set member ${memberId} role to ${role}`);
  };

  const toggleTeamMemberStatus = (memberId: string) => {
    setTeamMembers((prev) =>
      prev.map((m) =>
        m.id === memberId
          ? { ...m, status: m.status === 'active' ? 'suspended' : 'active' }
          : m
      )
    );
  };

  const removeTeamMember = (memberId: string) => {
    setTeamMembers((prev) => prev.filter((m) => m.id !== memberId));
    appendAudit('Removed Team Member', 'business_member', `Removed member ${memberId}`);
  };

  const updateBusinessProfile = (updates: Partial<BusinessProfile>) => {
    setBusiness((prev) => ({ ...prev, ...updates }));
    appendAudit('Updated Business Settings', 'business', 'Modified business profile configuration');
  };

  const verifyMetaConnection = async (
    phoneNumberId: string,
    wabaId: string
  ): Promise<{ ok: boolean; message: string }> => {
    const cleanPhoneId = phoneNumberId.trim();
    const cleanWabaId = wabaId.trim();

    if (!cleanPhoneId || !cleanWabaId) {
      setBusiness((prev) => ({
        ...prev,
        metaPhoneNumberId: cleanPhoneId,
        metaWabaId: cleanWabaId,
        metaConnectionState: 'configuration_required',
        metaLastError: 'Both Meta Phone Number ID and WABA ID are required.',
      }));
      return { ok: false, message: 'Phone Number ID and WABA ID are required.' };
    }

    if (!isSupabaseConfigured || !supabase) {
      setBusiness((prev) => ({
        ...prev,
        metaPhoneNumberId: cleanPhoneId,
        metaWabaId: cleanWabaId,
        metaConnectionState: 'configuration_required',
        metaLastError: 'Supabase backend configuration is required to verify Meta Cloud API.',
      }));
      return {
        ok: false,
        message: 'Supabase configuration is required before checking Meta Cloud API.',
      };
    }

    const { data, error } = await supabase.functions.invoke('sync-templates');
    if (!error) {
      setBusiness((prev) => ({
        ...prev,
        metaPhoneNumberId: cleanPhoneId,
        metaWabaId: cleanWabaId,
        metaConnectionState: 'connected',
        metaLastError: undefined,
      }));
      if (currentUser?.id) {
        await loadSupabaseWorkspace(currentUser.id);
      }
      return {
        ok: true,
        message: `Meta WhatsApp Cloud API connection verified (${data?.templatesCount ?? 0} templates synced).`,
      };
    }

    setBusiness((prev) => ({
      ...prev,
      metaPhoneNumberId: cleanPhoneId,
      metaWabaId: cleanWabaId,
      metaConnectionState: 'connection_error',
      metaLastError: error.message,
    }));
    return { ok: false, message: error.message };
  };

  const updateBusinessHours = (hours: BusinessHoursDay[]) => {
    setBusinessHours(hours);
    appendAudit('Updated Business Hours', 'business', 'Saved weekly support schedule');
  };

  const markNotificationRead = (id: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
  };

  const markAllNotificationsRead = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  };

  const value: AppContextValue = {
    isSupabaseReady: isSupabaseConfigured,
    supabaseMissingReason: supabaseConfigError,
    authStatus,
    isAuthenticated: authStatus === 'authenticated' && Boolean(currentUser),
    authLoading,
    workspaceLoading,
    authError,
    profileAccessError,
    passwordRecoveryActive,
    currentUser,
    signInWithSupabase,
    resendConfirmationEmail,
    requestPasswordReset,
    updatePassword,
    logout,
    business,
    teamMembers,
    tags,
    contacts,
    conversations,
    messages,
    templates,
    campaigns,
    automationRules,
    aiKnowledge,
    aiLogs,
    businessHours,
    auditLogs,
    notifications,
    totalUnreadCount,
    selectedConversationId,
    setSelectedConversationId,
    dateRange,
    setDateRange,
    recentTemplateIds,
    lastAssignedMemberId,
    preferredInboxFilter,
    setPreferredInboxFilter: handleSetPreferredInboxFilter,
    sendMessage,
    retryFailedMessage,
    markConversationRead,
    assignConversation,
    updateConversationStatus,
    toggleHumanHandoff,
    addContact,
    updateContact,
    deleteContact,
    bulkTagContacts,
    importContactsBatch,
    createTag,
    openOrCreateConversationForContact,
    createCampaign,
    duplicateCampaign,
    updateCampaignStatus,
    createTemplateDraft,
    updateTemplateDraft,
    syncTemplatesFromMeta,
    createAutomationRule,
    toggleAutomationRule,
    updateAutomationRule,
    deleteAutomationRule,
    aiConfig,
    updateAiConfig,
    addAiKnowledgeItem,
    deleteAiKnowledgeItem,
    runAiSandboxTest,
    inviteTeamMember,
    updateTeamMemberRole,
    toggleTeamMemberStatus,
    removeTeamMember,
    updateBusinessProfile,
    verifyMetaConnection,
    updateBusinessHours,
    markNotificationRead,
    markAllNotificationsRead,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}
