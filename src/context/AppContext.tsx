import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { DEFAULT_BUSINESS_HOURS, EMPTY_BUSINESS_PROFILE } from '@/data/workspaceDefaults';
import { getWindowStatus, normalizePhoneE164 } from '@/lib/phone';
import {
  isSupabaseConfigured,
  supabase,
  supabaseConfigError,
} from '@/lib/supabase';
import {
  extractWhatsAppPhoneNumberId,
  extractWhatsAppWabaId,
  fetchBusinessWhatsAppAccount,
  fetchOlderMessagesPage,
  fetchRecentWebhookEvents,
  getWebhookCallbackUrl,
  invokeConnectionCheck,
  invokeSendWhatsAppMessage,
  invokeSyncTemplates,
  mapDbMessageRow,
  normalizeWhatsAppConnectionStatus,
  saveBusinessWhatsAppConfiguration,
} from '@/services/whatsappService';
import {
  fetchAdminTeamDirectory,
  fetchBasicWorkspaceTeamMembers,
} from '@/services/teamService';
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
  MessagingMode,
  MetaConnectionState,
  StaffRole,
  Tag,
  TeamMember,
  WebhookEventSummary,
} from '@/types/crm';

export interface AuthSessionUser {
  id: string;
  email: string;
  fullName: string;
  role: StaffRole;
  createdAt: string;
}

export interface PendingAuthAccount {
  id: string;
  email: string;
  fullName: string;
}

export type AuthGateStatus =
  | 'loading'
  | 'unauthenticated'
  | 'awaiting_access'
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
  pendingAccount: PendingAuthAccount | null;

  // Auth Actions
  signInWithSupabase: (
    email: string,
    password: string
  ) => Promise<{ ok: boolean; emailNotConfirmed?: boolean; error?: string }>;
  signUpWithSupabase: (input: {
    fullName: string;
    email: string;
    password: string;
  }) => Promise<{ ok: boolean; requiresEmailConfirmation?: boolean; error?: string }>;
  refreshWorkspaceAccess: () => Promise<void>;
  resendConfirmationEmail: (email: string) => Promise<{ ok: boolean; error?: string }>;
  requestPasswordReset: (email: string) => Promise<{ ok: boolean; error?: string }>;
  updatePassword: (newPassword: string) => Promise<{ ok: boolean; error?: string }>;
  logout: () => Promise<void>;

  // Core Data
  business: BusinessProfile;
  teamMembers: TeamMember[];
  teamMembersLoading: boolean;
  teamMembersError: string | null;
  ensureTeamDirectoryLoaded: () => Promise<void>;
  refreshTeamMembers: () => Promise<void>;
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
  webhookEvents: WebhookEventSummary[];
  webhookCallbackUrl: string | null;
  webhookSecretsReady: boolean | null;

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
    clientRequestId?: string;
  }) => Promise<{ ok: boolean; error?: string; code?: string }>;
  retryFailedMessage: (messageId: string) => Promise<{ ok: boolean; error?: string }>;
  loadOlderMessages: (conversationId: string) => Promise<{ loaded: number; hasMore: boolean }>;
  hasMoreMessagesMap: Record<string, boolean>;
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
  verifyMetaConnection: (
    phoneNumberId: string,
    wabaId: string,
    options?: {
      messagingMode?: MessagingMode;
      testAllowlist?: string[];
      graphApiVersion?: string;
    }
  ) => Promise<{ ok: boolean; message: string; diagnostic?: string }>;
  saveWhatsAppConfig: (options: {
    messagingMode: MessagingMode;
    testAllowlist: string[];
    phoneNumberId?: string;
    wabaId?: string;
    graphApiVersion?: string;
  }) => Promise<{ ok: boolean; message: string }>;
  refreshWhatsAppAccount: () => Promise<void>;
  refreshWebhookDiagnostics: () => Promise<void>;
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
  const [pendingAccount, setPendingAccount] = useState<PendingAuthAccount | null>(null);

  // Clean empty workspace state (hydrated exclusively from real Supabase tables when signed in)
  const [business, setBusiness] = useState<BusinessProfile>(EMPTY_BUSINESS_PROFILE);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [teamMembersLoading, setTeamMembersLoading] = useState<boolean>(false);
  const [teamMembersError, setTeamMembersError] = useState<string | null>(null);
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
  const [webhookEvents, setWebhookEvents] = useState<WebhookEventSummary[]>([]);
  const [webhookSecretsReady, setWebhookSecretsReady] = useState<boolean | null>(null);
  const [hasMoreMessagesMap, setHasMoreMessagesMap] = useState<Record<string, boolean>>({});
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

  const teamMembersRef = useRef<TeamMember[]>([]);
  useEffect(() => {
    teamMembersRef.current = teamMembers;
  }, [teamMembers]);

  const conversationsRef = useRef<Conversation[]>([]);
  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  const currentUserIdRef = useRef<string | null>(null);
  const authStatusRef = useRef<AuthGateStatus>('loading');
  const resolvingUserPromiseRef = useRef<{ userId: string; promise: Promise<void> } | null>(null);
  const teamRefreshPromiseRef = useRef<Promise<void> | null>(null);
  const teamDirectoryLoadedKeyRef = useRef<string | null>(null);
  const teamDirectoryFailedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    currentUserIdRef.current = currentUser?.id ?? null;
  }, [currentUser]);
  useEffect(() => {
    authStatusRef.current = authStatus;
  }, [authStatus]);

  const webhookCallbackUrl = useMemo(() => getWebhookCallbackUrl(), []);

  const resetWorkspaceState = useCallback(() => {
    setBusiness(EMPTY_BUSINESS_PROFILE);
    setTeamMembers([]);
    setTeamMembersLoading(false);
    setTeamMembersError(null);
    teamDirectoryLoadedKeyRef.current = null;
    teamDirectoryFailedKeyRef.current = null;
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
    setWebhookEvents([]);
    setWebhookSecretsReady(null);
    setHasMoreMessagesMap({});
    setSelectedConversationId(null);
    setRecentTemplateIds([]);
    setLastAssignedMemberId(null);
  }, []);

  // Load real Supabase records for the authenticated user without inventing any mock data
  const loadSupabaseWorkspace = useCallback(
    async (
      userId: string,
      knownBusinessId?: string,
      callerMeta?: { role?: StaffRole; email?: string; fullName?: string }
    ) => {
      if (!supabase || !isSupabaseConfigured) return;
      const client = supabase;
      setWorkspaceLoading(true);
      setTeamMembersLoading(true);

      try {
        let businessId = knownBusinessId;
        let callerRole: StaffRole | undefined = callerMeta?.role;

        if (!businessId || !callerRole) {
          const { data: memberRows } = await client
            .from('business_members')
            .select('business_id, role, is_active')
            .eq('user_id', userId)
            .eq('is_active', true);

          const activeRow = ((memberRows ?? []) as Array<Record<string, unknown>>).find(
            (m) => m.is_active === true
          );
          if (!businessId && activeRow?.business_id) {
            businessId = String(activeRow.business_id);
          }
          if (!callerRole && (activeRow?.role === 'admin' || activeRow?.role === 'agent')) {
            callerRole = activeRow.role;
          }
        }

        if (!businessId) {
          setWorkspaceLoading(false);
          setTeamMembersLoading(false);
          return;
        }

        const [
          bizRes,
          waRes,
          teamRes,
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
          client
            .from('whatsapp_accounts')
            .select('*')
            .eq('business_id', businessId)
            .order('created_at', { ascending: true })
            .limit(1)
            .maybeSingle(),
          fetchBasicWorkspaceTeamMembers({
            businessId,
            currentUserId: userId,
            currentUserEmail: callerMeta?.email,
            currentUserFullName: callerMeta?.fullName,
          }),
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
          .order('created_at', { ascending: false })
          .limit(300),
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
        const loadedPhoneId = extractWhatsAppPhoneNumberId(waData);
        const loadedWabaId = extractWhatsAppWabaId(waData);
        const loadedStatus = normalizeWhatsAppConnectionStatus(
          waData?.connection_status ?? waData?.status
        );

        setBusiness({
          id: String(bizData.id ?? ''),
          name: String(bizData.name ?? 'Your Business'),
          slug: String(bizData.slug ?? 'workspace'),
          industry: String(bizData.industry ?? ''),
          timezone: String(bizData.timezone ?? 'UTC'),
          website: String(bizData.website ?? ''),
          whatsappDisplayName: String(waData?.display_name ?? ''),
          whatsappPhoneE164: String(waData?.phone_number_e164 ?? waData?.phone_number ?? ''),
          metaPhoneNumberId: loadedPhoneId,
          metaWabaId: loadedWabaId,
          metaConnectionState: loadedStatus,
          metaLastError: waData?.last_error_message ? String(waData.last_error_message) : undefined,
          messagingMode: waData?.messaging_mode === 'live' ? 'live' : 'test',
          testAllowlist: Array.isArray(waData?.test_allowlist)
            ? waData.test_allowlist.map(String)
            : [],
          graphApiVersion: String(waData?.graph_api_version ?? 'v25.0'),
          verifiedName: waData?.verified_name ? String(waData.verified_name) : undefined,
          qualityRating:
            (waData?.quality_rating as BusinessProfile['qualityRating']) ?? 'unknown',
          webhookVerifiedAt: waData?.webhook_verified_at
            ? String(waData.webhook_verified_at)
            : undefined,
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

      const dirKey = `${businessId}:${userId}`;
      const prevById =
        teamDirectoryLoadedKeyRef.current === dirKey
          ? new Map(teamMembersRef.current.map((m) => [m.id, m]))
          : null;

      const memberList: TeamMember[] = teamRes.members.map((tm) => {
        const cached = prevById?.get(tm.id);
        return {
          ...tm,
          fullName: cached?.fullName || tm.fullName,
          email: tm.email || cached?.email || '',
          activeConversations: convList.filter(
            (cv) => cv.assignedToId === tm.id && cv.status !== 'resolved'
          ).length,
          resolvedToday: convList.filter(
            (cv) => cv.assignedToId === tm.id && cv.status === 'resolved'
          ).length,
        };
      });
      setTeamMembers(memberList);
      setTeamMembersError(teamRes.error);

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
          waId: c.wa_id ? String(c.wa_id) : undefined,
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

      const loadedMsgs = [...(msgsRes.data ?? [])]
        .reverse()
        .map((m) => mapDbMessageRow(m as Record<string, unknown>, memberList));
      setMessages(loadedMsgs);

      const hasMoreInitial: Record<string, boolean> = {};
      if ((msgsRes.data ?? []).length >= 300) {
        for (const cv of convList) {
          hasMoreInitial[cv.id] = true;
        }
      }
      setHasMoreMessagesMap(hasMoreInitial);

      // Load admin-only webhook diagnostics cleanly
      const activeCallerMember = memberList.find((m) => m.id === userId);
      if (activeCallerMember?.role === 'admin') {
        const events = await fetchRecentWebhookEvents(businessId, 10);
        setWebhookEvents(events);
      } else {
        setWebhookEvents([]);
      }

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
      setTeamMembersLoading(false);
    }
  }, []);

  const resolveAuthenticatedUser = useCallback(
    async (authUser: User) => {
      if (!supabase || !isSupabaseConfigured) return;

      if (resolvingUserPromiseRef.current?.userId === authUser.id) {
        return resolvingUserPromiseRef.current.promise;
      }

      const client = supabase;

      const task = (async () => {
        const metadataName =
          typeof authUser.user_metadata?.full_name === 'string'
            ? authUser.user_metadata.full_name.trim()
            : '';

        // Step 1: Load signed-in user's profile from public.profiles (actual columns only; email lives in auth.users)
        const { data: profileData } = await client
          .from('profiles')
          .select('id, full_name, role, created_at, updated_at')
          .eq('id', authUser.id)
          .maybeSingle();

        const profile = (profileData as Record<string, unknown> | null) ?? null;

        const resolvedEmail = String(authUser.email || '');
        const resolvedName = String(
          profile?.full_name || metadataName || authUser.email || 'Staff Member'
        );

        // Step 2: Check business membership and authoritative role from business_members
        const { data: memberRows, error: memberErr } = await client
          .from('business_members')
          .select('business_id, user_id, role, is_active, created_at')
          .eq('user_id', authUser.id);

        if (memberErr) {
          setCurrentUser(null);
          resetWorkspaceState();
          if (memberErr.code === '42501') {
            setPendingAccount({
              id: authUser.id,
              email: resolvedEmail,
              fullName: resolvedName,
            });
            setProfileAccessError(
              'Database table read permissions for authenticated users are pending setup by your project administrator.'
            );
            setAuthStatus('awaiting_access');
            return;
          }
          setPendingAccount(null);
          setProfileAccessError(`Unable to verify business membership: ${memberErr.message}`);
          setAuthStatus('unauthorized_access');
          return;
        }

      const rows = (memberRows ?? []) as Array<Record<string, unknown>>;

      const activeMember = rows.find((m) => m.is_active === true);
      if (!activeMember) {
        const suspended = rows.some((m) => m.is_active === false);
        setCurrentUser(null);
        resetWorkspaceState();

        if (suspended) {
          setPendingAccount(null);
          setProfileAccessError(
            'Access denied: your business membership has been suspended by an administrator.'
          );
          setAuthStatus('unauthorized_access');
          return;
        }

        // Newly registered or invited user without an active workspace membership yet
        setProfileAccessError(null);
        setPendingAccount({
          id: authUser.id,
          email: resolvedEmail,
          fullName: resolvedName,
        });
        setAuthStatus('awaiting_access');
        return;
      }

      const roleValue = String(activeMember.role ?? '');
      const validRole: StaffRole | null =
        roleValue === 'admin' || roleValue === 'agent' ? (roleValue as StaffRole) : null;

      if (!validRole) {
        setCurrentUser(null);
        setPendingAccount(null);
        resetWorkspaceState();
        setProfileAccessError(
          'Access denied: your business membership does not have an authorized CRM role (admin or agent).'
        );
        setAuthStatus('unauthorized_access');
        return;
      }

      const activeBusinessId = String(activeMember.business_id ?? '');

      // Step 3: Verify associated business record is accessible under RLS
      const { data: bizRaw, error: bizErr } = await client
        .from('businesses')
        .select('*')
        .eq('id', activeBusinessId)
        .maybeSingle();

      const bizData = (bizRaw as Record<string, unknown> | null) ?? null;

      if (bizErr || !bizData) {
        setCurrentUser(null);
        setPendingAccount(null);
        resetWorkspaceState();
        setProfileAccessError(
          bizErr
            ? `Unable to load business workspace: ${bizErr.message}`
            : 'Access denied: associated business workspace could not be loaded.'
        );
        setAuthStatus('unauthorized_access');
        return;
      }

      // Step 4: Set authoritative user profile, role from business_members, and business workspace
      setPendingAccount(null);
      setProfileAccessError(null);
      setBusiness((prev) => ({
        ...prev,
        id: String(bizData.id ?? activeBusinessId),
        name: String(bizData.name ?? 'Your Business'),
        slug: String(bizData.slug ?? 'workspace'),
        industry: String(bizData.industry ?? ''),
        timezone: String(bizData.timezone ?? 'UTC'),
        website: String(bizData.website ?? ''),
      }));
      setCurrentUser({
        id: String(profile?.id || authUser.id),
        email: resolvedEmail,
        fullName: resolvedName,
        role: validRole,
        createdAt: String(profile?.created_at || authUser.created_at || new Date().toISOString()),
      });
      setAuthStatus('authenticated');
      await loadSupabaseWorkspace(authUser.id, activeBusinessId, {
        role: validRole,
        email: resolvedEmail,
        fullName: resolvedName,
      });
      })();

      resolvingUserPromiseRef.current = { userId: authUser.id, promise: task };
      try {
        await task;
      } finally {
        if (resolvingUserPromiseRef.current?.promise === task) {
          resolvingUserPromiseRef.current = null;
        }
      }
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
        setPendingAccount(null);
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
        setPendingAccount(null);
        setProfileAccessError(null);
        setPasswordRecoveryActive(false);
        setAuthStatus('unauthenticated');
        resetWorkspaceState();
        setAuthLoading(false);
        return;
      }

      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
        const sameAuthenticatedUser =
          currentUserIdRef.current === session.user.id &&
          authStatusRef.current === 'authenticated';

        // Avoid blowing away active form inputs or duplicating queries on background refreshes / concurrent sign-in
        if (resolvingUserPromiseRef.current?.userId === session.user.id) {
          return;
        }
        if ((event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') && sameAuthenticatedUser) {
          return;
        }

        void (async () => {
          const { data: userRes, error: userErr } = await client.auth.getUser();
          if (!active) return;
          if (userErr || !userRes.user) {
            setCurrentUser(null);
            setPendingAccount(null);
            setAuthStatus('unauthenticated');
            resetWorkspaceState();
          } else {
            await resolveAuthenticatedUser(userRes.user);
          }
          if (active) setAuthLoading(false);
        })();
      }
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [resetWorkspaceState, resolveAuthenticatedUser]);

  // Scoped, incremental Supabase Realtime subscription for live 1-to-1 messaging & delivery statuses
  useEffect(() => {
    if (
      !supabase ||
      !isSupabaseConfigured ||
      authStatus !== 'authenticated' ||
      !UUID_REGEX.test(business.id)
    ) {
      return;
    }

    const client = supabase;
    const businessId = business.id;

    const channel = client
      .channel(`zoqniva-business-${businessId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'messages',
          filter: `business_id=eq.${businessId}`,
        },
        (payload) => {
          const row = (payload.new as Record<string, unknown> | null) ?? null;
          if (!row) return;
          const mapped = mapDbMessageRow(row, teamMembersRef.current);

          setMessages((prev) => {
            const idx = prev.findIndex(
              (m) =>
                m.id === mapped.id ||
                (Boolean(mapped.clientRequestId) && m.clientRequestId === mapped.clientRequestId)
            );
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = mapped;
              return next;
            }
            return [...prev, mapped].sort(
              (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
            );
          });
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'conversations',
          filter: `business_id=eq.${businessId}`,
        },
        (payload) => {
          const c = (payload.new as Record<string, unknown> | null) ?? null;
          if (!c) return;
          const mappedConv: Conversation = {
            id: String(c.id),
            contactId: String(c.contact_id),
            assignedToId: c.assigned_to ? String(c.assigned_to) : null,
            status: (c.status as ConversationStatus) ?? 'open',
            unreadCount: Number(c.unread_count ?? 0),
            humanHandoffRequested: Boolean(c.human_handoff_requested),
            lastCustomerMessageAt: String(
              c.last_customer_message_at ?? c.created_at ?? new Date().toISOString()
            ),
            windowExpiresAt: String(c.window_expires_at ?? new Date(0).toISOString()),
            lastMessagePreview: String(c.last_message_preview ?? ''),
            lastMessageAt: String(c.last_message_at ?? c.created_at ?? new Date().toISOString()),
          };

          setConversations((prev) => {
            const exists = prev.some((item) => item.id === mappedConv.id);
            if (exists) {
              return prev.map((item) => (item.id === mappedConv.id ? mappedConv : item));
            }
            return [mappedConv, ...prev];
          });
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'contacts',
          filter: `business_id=eq.${businessId}`,
        },
        (payload) => {
          const c = (payload.new as Record<string, unknown> | null) ?? null;
          if (!c) return;
          setContacts((prev) => {
            const existing = prev.find((item) => item.id === String(c.id));
            const mappedContact: Contact = {
              id: String(c.id),
              fullName: String(c.full_name),
              phoneE164: String(c.phone_e164),
              waId: c.wa_id ? String(c.wa_id) : undefined,
              email: String(c.email ?? ''),
              company: String(c.company ?? ''),
              city: String(c.city ?? ''),
              country: String(c.country ?? ''),
              marketingOptIn: Boolean(c.marketing_opt_in),
              optedOutAt: c.opted_out_at ? String(c.opted_out_at) : undefined,
              tagIds: existing?.tagIds ?? [],
              notes: String(c.notes ?? ''),
              lastContactedAt: c.last_contacted_at ? String(c.last_contacted_at) : undefined,
              createdAt: String(c.created_at ?? new Date().toISOString()),
            };
            if (existing) {
              return prev.map((item) => (item.id === mappedContact.id ? mappedContact : item));
            }
            return [mappedContact, ...prev];
          });
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'whatsapp_accounts',
          filter: `business_id=eq.${businessId}`,
        },
        (payload) => {
          const wa = (payload.new as Record<string, unknown> | null) ?? null;
          if (!wa) return;
          const nextPhone = extractWhatsAppPhoneNumberId(wa);
          const nextWaba = extractWhatsAppWabaId(wa);
          setBusiness((prev) => ({
            ...prev,
            whatsappDisplayName: String(wa.display_name ?? prev.whatsappDisplayName),
            whatsappPhoneE164: String(wa.phone_number_e164 ?? wa.phone_number ?? prev.whatsappPhoneE164),
            metaPhoneNumberId: nextPhone || prev.metaPhoneNumberId,
            metaWabaId: nextWaba || prev.metaWabaId,
            metaConnectionState:
              wa.connection_status !== undefined || wa.status !== undefined
                ? normalizeWhatsAppConnectionStatus(wa.connection_status ?? wa.status)
                : prev.metaConnectionState,
            metaLastError: wa.last_error_message ? String(wa.last_error_message) : undefined,
            messagingMode: wa.messaging_mode === 'live' ? 'live' : wa.messaging_mode === 'test' ? 'test' : prev.messagingMode,
            testAllowlist: Array.isArray(wa.test_allowlist)
              ? wa.test_allowlist.map(String)
              : prev.testAllowlist,
            graphApiVersion: String(wa.graph_api_version ?? prev.graphApiVersion),
            verifiedName: wa.verified_name ? String(wa.verified_name) : prev.verifiedName,
            qualityRating:
              (wa.quality_rating as BusinessProfile['qualityRating']) ?? prev.qualityRating,
            webhookVerifiedAt: wa.webhook_verified_at
              ? String(wa.webhook_verified_at)
              : prev.webhookVerifiedAt,
          }));
        }
      )
      .subscribe();

    return () => {
      void client.removeChannel(channel);
    };
  }, [authStatus, business.id]);

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

  const signUpWithSupabase: AppContextValue['signUpWithSupabase'] = async ({
    fullName,
    email,
    password,
  }) => {
    if (!supabase || !isSupabaseConfigured) {
      const msg = supabaseConfigError || 'Supabase configuration is required to create an account.';
      setAuthError(msg);
      return { ok: false, error: msg };
    }

    setAuthError(null);
    setProfileAccessError(null);
    setAuthLoading(true);

    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: {
          full_name: fullName.trim(),
        },
        emailRedirectTo: `${window.location.origin}/login`,
      },
    });

    if (error) {
      setAuthLoading(false);
      setAuthError(error.message);
      return { ok: false, error: error.message };
    }

    // Retrieve active Supabase session immediately (when email confirmation is disabled)
    let activeSession = data.session;
    if (!activeSession) {
      const { data: sessionRes } = await supabase.auth.getSession();
      activeSession = sessionRes.session;
    }

    // Compatible fallback if email confirmation is later enabled in Supabase
    if (!activeSession?.user) {
      setAuthLoading(false);
      return { ok: true, requiresEmailConfirmation: true };
    }

    await resolveAuthenticatedUser(activeSession.user);
    setAuthLoading(false);
    return { ok: true, requiresEmailConfirmation: false };
  };

  const refreshWorkspaceAccess: AppContextValue['refreshWorkspaceAccess'] = async () => {
    if (!supabase || !isSupabaseConfigured) return;
    setAuthLoading(true);
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      setCurrentUser(null);
      setPendingAccount(null);
      setAuthStatus('unauthenticated');
      resetWorkspaceState();
    } else {
      await resolveAuthenticatedUser(data.user);
    }
    setAuthLoading(false);
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
      redirectTo: `${window.location.origin}/update-password`,
    });
    if (error) {
      const lower = error.message.toLowerCase();
      const friendlyError =
        error.status === 429 ||
        lower.includes('rate limit') ||
        lower.includes('security purposes') ||
        lower.includes('too many requests')
          ? `Email rate limit reached. Please wait a minute before requesting another reset link. (${error.message})`
          : error.message;
      setAuthError(friendlyError);
      return { ok: false, error: friendlyError };
    }
    return { ok: true };
  };

  const updatePassword: AppContextValue['updatePassword'] = async (newPassword) => {
    if (!supabase || !isSupabaseConfigured) {
      return { ok: false, error: 'Supabase configuration is required.' };
    }
    setAuthError(null);
    const { data, error } = await supabase.auth.updateUser({ password: newPassword });
    if (error || !data.user) {
      const msg = error?.message || 'Unable to update password. Please request a new reset link.';
      setAuthError(msg);
      return { ok: false, error: msg };
    }

    // Password is confirmed updated by Supabase; sign out temporary recovery session cleanly
    setPasswordRecoveryActive(false);
    await supabase.auth.signOut();
    setCurrentUser(null);
    setPendingAccount(null);
    setAuthStatus('unauthenticated');
    resetWorkspaceState();
    return { ok: true };
  };

  const logout = async () => {
    sessionStorage.removeItem('zoqniva_demo_role');
    sessionStorage.removeItem('zoqniva_pending_setup');
    if (supabase && isSupabaseConfigured) {
      await supabase.auth.signOut();
    }
    setCurrentUser(null);
    setPendingAccount(null);
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
  // INBOX OPERATIONS (Respecting 24h Window, Test Mode & Honest Delivery States)
  // ============================================================================
  const sendMessage: AppContextValue['sendMessage'] = async ({
    conversationId,
    body,
    messageType,
    templateName,
    mediaFilename,
    clientRequestId: providedRequestId,
  }) => {
    const conv = conversations.find((c) => c.id === conversationId);
    if (!conv) return { ok: false, error: 'Conversation not found.' };

    const trimmed = body.trim();
    if (!trimmed) return { ok: false, error: 'Message content cannot be empty.' };
    if (trimmed.length > 4096) {
      return { ok: false, error: 'WhatsApp messages cannot exceed 4,096 characters.' };
    }

    // Internal Team Note (written directly under strict RLS policy)
    if (messageType === 'internal_note') {
      const noteId = crypto.randomUUID();
      const nowIso = new Date().toISOString();
      const noteMsg: Message = {
        id: noteId,
        conversationId,
        senderType: 'agent',
        senderName: currentUser?.fullName ?? 'Agent',
        senderId: currentUser?.id,
        direction: 'internal',
        messageType: 'internal_note',
        body: trimmed,
        deliveryStatus: 'internal',
        createdAt: nowIso,
      };
      setMessages((prev) => [...prev, noteMsg]);

      if (supabase && isSupabaseConfigured && UUID_REGEX.test(business.id)) {
        const { error: noteErr } = await supabase.from('messages').insert({
          id: noteId,
          business_id: business.id,
          conversation_id: conversationId,
          sender_type: 'agent',
          sender_profile_id: currentUser?.id ?? null,
          direction: 'internal',
          message_type: 'internal_note',
          body: trimmed,
          delivery_status: 'internal',
          created_at: nowIso,
        });
        if (noteErr) {
          setMessages((prev) => prev.filter((m) => m.id !== noteId));
          return { ok: false, error: noteErr.message };
        }
      }
      return { ok: true };
    }

    // Only text replies and approved templates can be sent via WhatsApp Cloud API right now
    if (messageType !== 'text' && messageType !== 'template') {
      return {
        ok: false,
        code: 'MEDIA_UPLOAD_NOT_ENABLED',
        error:
          'Sending image or document attachments requires media upload integration first. Send a text reply or approved template.',
      };
    }

    if (business.metaConnectionState !== 'connected') {
      return {
        ok: false,
        code: 'WHATSAPP_NOT_CONNECTED',
        error: 'Verify your WhatsApp Business connection in Settings before sending live messages.',
      };
    }

    const contact = contacts.find((c) => c.id === conv.contactId);
    if (business.messagingMode === 'test' && contact) {
      const normalizedRecipient = normalizePhoneE164(contact.phoneE164);
      const allowed = business.testAllowlist
        .map((p) => normalizePhoneE164(p))
        .filter((p): p is string => Boolean(p));
      if (!normalizedRecipient || !allowed.includes(normalizedRecipient)) {
        return {
          ok: false,
          code: 'TEST_MODE_RECIPIENT_NOT_ALLOWED',
          error:
            'Test Mode is active. Add this customer phone number to your Test Allowlist in Settings before sending.',
        };
      }
    }

    const windowState = getWindowStatus(conv.windowExpiresAt);
    if (messageType === 'text' && !windowState.isOpen) {
      return {
        ok: false,
        code: 'WINDOW_EXPIRED',
        error:
          'The 24-hour customer service window is closed. You must send an approved WhatsApp template message.',
      };
    }

    if (!supabase || !isSupabaseConfigured) {
      return { ok: false, error: 'Supabase configuration is required to send WhatsApp messages.' };
    }

    const clientRequestId = providedRequestId || crypto.randomUUID();
    const optimisticId = `pending-${clientRequestId}`;
    const optimisticNow = new Date().toISOString();

    const optimisticMsg: Message = {
      id: optimisticId,
      conversationId,
      senderType: 'agent',
      senderName: currentUser?.fullName ?? 'Agent',
      senderId: currentUser?.id,
      direction: 'outbound',
      messageType,
      body: trimmed,
      templateName,
      mediaFilename,
      clientRequestId,
      deliveryStatus: 'pending',
      createdAt: optimisticNow,
    };

    setMessages((prev) => [...prev, optimisticMsg]);

    const tplObj = templateName
      ? templates.find((t) => t.name === templateName && t.approvalStatus === 'APPROVED')
      : undefined;

    const result = await invokeSendWhatsAppMessage({
      conversationId,
      messageType,
      body: trimmed,
      templateName,
      language: tplObj?.language ?? 'en_US',
      clientRequestId,
    });

    if (result.messageRow) {
      const authoritativeMsg = mapDbMessageRow(result.messageRow, teamMembers);
      setMessages((prev) => {
        const replaced = prev.map((m) =>
          m.id === optimisticId ||
          (m.clientRequestId && m.clientRequestId === clientRequestId)
            ? authoritativeMsg
            : m
        );
        // Deduplicate if Realtime inserted it concurrently
        const seen = new Set<string>();
        return replaced.filter((m) => {
          if (seen.has(m.id)) return false;
          seen.add(m.id);
          return true;
        });
      });
    } else if (!result.ok) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === optimisticId
            ? {
                ...m,
                deliveryStatus: 'failed',
                failedAt: new Date().toISOString(),
                errorCode: result.errorCode ?? 'SEND_FAILED',
                errorMessage: result.error ?? 'Could not send message via WhatsApp Cloud API.',
              }
            : m
        )
      );
    }

    if (!result.ok) {
      return {
        ok: false,
        code: result.errorCode,
        error: result.error ?? 'Failed to send message via WhatsApp Cloud API.',
      };
    }

    setConversations((prev) =>
      prev.map((c) =>
        c.id === conversationId
          ? {
              ...c,
              lastMessagePreview: trimmed.slice(0, 140),
              lastMessageAt: optimisticNow,
              unreadCount: 0,
            }
          : c
      )
    );

    return { ok: true };
  };

  const retryFailedMessage: AppContextValue['retryFailedMessage'] = async (messageId) => {
    const target = messages.find((m) => m.id === messageId);
    if (!target || target.deliveryStatus !== 'failed') {
      return { ok: false, error: 'Only failed messages can be retried.' };
    }

    if (target.metaMessageId) {
      return {
        ok: false,
        error:
          'This message already received a Meta message ID and cannot be blindly resent to avoid duplicates.',
      };
    }

    if (business.metaConnectionState !== 'connected') {
      const errMsg = 'Cannot retry delivery: Connect your WhatsApp account in Settings first.';
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, errorMessage: errMsg } : m))
      );
      return { ok: false, error: errMsg };
    }

    return sendMessage({
      conversationId: target.conversationId,
      body: target.body,
      messageType: target.messageType,
      templateName: target.templateName,
      mediaFilename: target.mediaFilename,
    });
  };

  const loadOlderMessages: AppContextValue['loadOlderMessages'] = async (conversationId) => {
    if (!supabase || !isSupabaseConfigured || !UUID_REGEX.test(business.id)) {
      return { loaded: 0, hasMore: false };
    }
    const convMessages = messages
      .filter((m) => m.conversationId === conversationId && !m.id.startsWith('pending-'))
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    const beforeIso = convMessages[0]?.createdAt ?? new Date().toISOString();
    const { messages: older, hasMore } = await fetchOlderMessagesPage({
      businessId: business.id,
      conversationId,
      beforeIso,
      limit: 50,
      teamMembers,
    });

    if (older.length > 0) {
      setMessages((prev) => {
        const existingIds = new Set(prev.map((m) => m.id));
        const merged = [...older.filter((m) => !existingIds.has(m.id)), ...prev];
        return merged.sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );
      });
    }

    setHasMoreMessagesMap((prev) => ({ ...prev, [conversationId]: hasMore }));
    return { loaded: older.length, hasMore };
  };

  const markConversationRead = (conversationId: string) => {
    const target = conversations.find((c) => c.id === conversationId);
    setConversations((prev) =>
      prev.map((c) => (c.id === conversationId ? { ...c, unreadCount: 0 } : c))
    );
    if (
      target &&
      target.unreadCount > 0 &&
      supabase &&
      isSupabaseConfigured &&
      UUID_REGEX.test(conversationId)
    ) {
      void supabase.from('conversations').update({ unread_count: 0 }).eq('id', conversationId);
    }
  };

  const assignConversation = (conversationId: string, memberId: string | null) => {
    setConversations((prev) =>
      prev.map((c) => (c.id === conversationId ? { ...c, assignedToId: memberId } : c))
    );
    if (memberId) setLastAssignedMemberId(memberId);
    if (supabase && isSupabaseConfigured && UUID_REGEX.test(conversationId)) {
      void supabase.from('conversations').update({ assigned_to: memberId }).eq('id', conversationId);
    }
    const memberName = teamMembers.find((m) => m.id === memberId)?.fullName ?? 'Unassigned';
    appendAudit('Assigned Conversation', 'conversation', `Assigned ${conversationId} to ${memberName}`);
  };

  const updateConversationStatus = (conversationId: string, status: ConversationStatus) => {
    setConversations((prev) =>
      prev.map((c) => (c.id === conversationId ? { ...c, status } : c))
    );
    if (supabase && isSupabaseConfigured && UUID_REGEX.test(conversationId)) {
      void supabase.from('conversations').update({ status }).eq('id', conversationId);
    }
    appendAudit('Updated Conversation Status', 'conversation', `Marked ${conversationId} as ${status}`);
  };

  const toggleHumanHandoff = (conversationId: string, requested: boolean) => {
    setConversations((prev) =>
      prev.map((c) =>
        c.id === conversationId ? { ...c, humanHandoffRequested: requested } : c
      )
    );
    if (supabase && isSupabaseConfigured && UUID_REGEX.test(conversationId)) {
      void supabase
        .from('conversations')
        .update({ human_handoff_requested: requested })
        .eq('id', conversationId);
    }
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
    const contactId = crypto.randomUUID();
    const created: Contact = {
      id: contactId,
      fullName: input.fullName.trim(),
      phoneE164: normalized,
      waId: normalized.replace('+', ''),
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
      const client = supabase;
      void client
        .from('contacts')
        .insert({
          id: contactId,
          business_id: business.id,
          full_name: created.fullName,
          phone_e164: created.phoneE164,
          wa_id: created.waId,
          email: created.email || null,
          company: created.company || null,
          city: created.city || null,
          country: created.country || null,
          marketing_opt_in: created.marketingOptIn,
          notes: created.notes,
          created_by: currentUser?.id ?? null,
        })
        .then(({ error }) => {
          if (!error && created.tagIds.length > 0) {
            void client.from('contact_tags').insert(
              created.tagIds
                .filter((tid) => UUID_REGEX.test(tid))
                .map((tid) => ({ contact_id: contactId, tag_id: tid }))
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
      updates.waId = normalized.replace('+', '');
    }

    const existing = contacts.find((c) => c.id === id);
    const nextOptOut =
      updates.marketingOptIn === false && existing?.marketingOptIn
        ? new Date().toISOString()
        : updates.marketingOptIn === true
        ? undefined
        : existing?.optedOutAt;

    setContacts((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c;
        return { ...c, ...updates, optedOutAt: nextOptOut };
      })
    );

    if (supabase && isSupabaseConfigured && UUID_REGEX.test(id)) {
      const client = supabase;
      const dbPatch: Record<string, unknown> = {};
      if (updates.fullName !== undefined) dbPatch.full_name = updates.fullName;
      if (updates.phoneE164 !== undefined) {
        dbPatch.phone_e164 = updates.phoneE164;
        dbPatch.wa_id = updates.phoneE164.replace('+', '');
      }
      if (updates.email !== undefined) dbPatch.email = updates.email || null;
      if (updates.company !== undefined) dbPatch.company = updates.company || null;
      if (updates.city !== undefined) dbPatch.city = updates.city || null;
      if (updates.country !== undefined) dbPatch.country = updates.country || null;
      if (updates.notes !== undefined) dbPatch.notes = updates.notes;
      if (updates.marketingOptIn !== undefined) {
        dbPatch.marketing_opt_in = updates.marketingOptIn;
        dbPatch.opted_out_at = nextOptOut ?? null;
      }

      if (Object.keys(dbPatch).length > 0) {
        void client.from('contacts').update(dbPatch).eq('id', id);
      }

      if (updates.tagIds !== undefined) {
        const validTags = updates.tagIds.filter((tid) => UUID_REGEX.test(tid));
        void client
          .from('contact_tags')
          .delete()
          .eq('contact_id', id)
          .then(() => {
            if (validTags.length > 0) {
              void client
                .from('contact_tags')
                .insert(validTags.map((tid) => ({ contact_id: id, tag_id: tid })));
            }
          });
      }
    }

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
    if (supabase && isSupabaseConfigured && UUID_REGEX.test(tagId)) {
      const pairs = contactIds
        .filter((cid) => UUID_REGEX.test(cid))
        .map((cid) => ({ contact_id: cid, tag_id: tagId }));
      if (pairs.length > 0) {
        void supabase.from('contact_tags').upsert(pairs, { onConflict: 'contact_id,tag_id' });
      }
    }
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
          id: crypto.randomUUID(),
          fullName: row.fullName,
          phoneE164: row.phoneE164,
          waId: row.phoneE164.replace('+', ''),
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
      if (supabase && isSupabaseConfigured && UUID_REGEX.test(business.id)) {
        void supabase.from('contacts').insert(
          toAdd.map((c) => ({
            id: c.id,
            business_id: business.id,
            full_name: c.fullName,
            phone_e164: c.phoneE164,
            wa_id: c.waId,
            email: c.email || null,
            company: c.company || null,
            city: c.city || null,
            country: c.country || null,
            marketing_opt_in: c.marketingOptIn,
            notes: c.notes,
            created_by: currentUser?.id ?? null,
          }))
        );
      }
      appendAudit('Imported Contacts CSV', 'contact', `Imported ${toAdd.length} normalized contacts`);
    }
    return toAdd.length;
  };

  const createTag = (name: string, color: string): Tag => {
    const existing = tags.find((t) => t.name.toLowerCase() === name.trim().toLowerCase());
    if (existing) return existing;
    const tag: Tag = {
      id: crypto.randomUUID(),
      name: name.trim(),
      color,
    };
    setTags((prev) => [...prev, tag]);
    if (supabase && isSupabaseConfigured && UUID_REGEX.test(business.id)) {
      void supabase.from('tags').insert({
        id: tag.id,
        business_id: business.id,
        name: tag.name,
        color: tag.color,
      });
    }
    return tag;
  };

  const openOrCreateConversationForContact = (contactId: string): string => {
    const existing = conversations.find((c) => c.contactId === contactId);
    if (existing) {
      setSelectedConversationId(existing.id);
      return existing.id;
    }
    const convId = crypto.randomUUID();
    const nowIso = new Date().toISOString();
    const created: Conversation = {
      id: convId,
      contactId,
      assignedToId: currentUser?.id ?? null,
      status: 'open',
      unreadCount: 0,
      humanHandoffRequested: false,
      lastCustomerMessageAt: new Date(0).toISOString(),
      windowExpiresAt: new Date(0).toISOString(),
      lastMessagePreview: 'New conversation started — send an approved template to initiate.',
      lastMessageAt: nowIso,
    };
    setConversations((prev) => [created, ...prev]);
    setSelectedConversationId(created.id);

    if (
      supabase &&
      isSupabaseConfigured &&
      UUID_REGEX.test(business.id) &&
      UUID_REGEX.test(contactId)
    ) {
      void supabase.from('conversations').insert({
        id: convId,
        business_id: business.id,
        contact_id: contactId,
        assigned_to: currentUser?.id ?? null,
        status: 'open',
        unread_count: 0,
        last_message_preview: created.lastMessagePreview,
        last_message_at: nowIso,
      });
    }
    return created.id;
  };

  // ============================================================================
  // BROADCASTS & TEMPLATES (Disabled from live execution in Test Mode)
  // ============================================================================
  const createCampaign: AppContextValue['createCampaign'] = (input) => {
    const isMetaLive =
      business.metaConnectionState === 'connected' && business.messagingMode === 'live';
    const nextStatus: Campaign['status'] =
      input.scheduleMode === 'draft' || !isMetaLive
        ? 'draft'
        : input.scheduleMode === 'scheduled'
        ? 'scheduled'
        : 'running';

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
      const res = await invokeSyncTemplates();
      if (!res.ok) {
        return { ok: false, message: res.error || 'Could not sync templates from Meta.' };
      }
      if (currentUser?.id) {
        await loadSupabaseWorkspace(currentUser.id, business.id, {
          role: currentUser.role,
          email: currentUser.email,
          fullName: currentUser.fullName,
        });
      }
      return { ok: true, message: `Synced ${res.templatesCount} template(s) from Meta.` };
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
  const ensureTeamDirectoryLoaded = useCallback(async () => {
    if (
      !supabase ||
      !isSupabaseConfigured ||
      !currentUser?.id ||
      !UUID_REGEX.test(business.id) ||
      currentUser.role !== 'admin'
    ) {
      return;
    }

    const dirKey = `${business.id}:${currentUser.id}`;
    if (
      teamDirectoryLoadedKeyRef.current === dirKey ||
      teamDirectoryFailedKeyRef.current === dirKey
    ) {
      return;
    }
    if (teamRefreshPromiseRef.current) {
      return teamRefreshPromiseRef.current;
    }

    const task = (async () => {
      setTeamMembersLoading(true);
      try {
        const res = await fetchAdminTeamDirectory({
          businessId: business.id,
          currentUserId: currentUser.id,
          currentUserRole: currentUser.role,
          currentUserEmail: currentUser.email,
          currentUserFullName: currentUser.fullName,
          conversations: conversationsRef.current,
        });
        if (res.ok) {
          teamDirectoryLoadedKeyRef.current = dirKey;
          teamDirectoryFailedKeyRef.current = null;
        } else {
          teamDirectoryFailedKeyRef.current = dirKey;
        }
        if (res.members.length > 0 || res.ok) {
          setTeamMembers(res.members);
        }
        setTeamMembersError(res.error);
      } finally {
        setTeamMembersLoading(false);
      }
    })();

    teamRefreshPromiseRef.current = task;
    try {
      await task;
    } finally {
      if (teamRefreshPromiseRef.current === task) {
        teamRefreshPromiseRef.current = null;
      }
    }
  }, [business.id, currentUser]);

  const refreshTeamMembers = useCallback(async () => {
    if (
      !supabase ||
      !isSupabaseConfigured ||
      !currentUser?.id ||
      !UUID_REGEX.test(business.id)
    ) {
      return;
    }
    if (teamRefreshPromiseRef.current) {
      return teamRefreshPromiseRef.current;
    }

    const dirKey = `${business.id}:${currentUser.id}`;
    teamDirectoryLoadedKeyRef.current = null;
    teamDirectoryFailedKeyRef.current = null;

    const task = (async () => {
      setTeamMembersLoading(true);
      try {
        const res =
          currentUser.role === 'admin'
            ? await fetchAdminTeamDirectory({
                businessId: business.id,
                currentUserId: currentUser.id,
                currentUserRole: currentUser.role,
                currentUserEmail: currentUser.email,
                currentUserFullName: currentUser.fullName,
                conversations: conversationsRef.current,
              })
            : await fetchBasicWorkspaceTeamMembers({
                businessId: business.id,
                currentUserId: currentUser.id,
                currentUserEmail: currentUser.email,
                currentUserFullName: currentUser.fullName,
                conversations: conversationsRef.current,
              });

        if (res.ok) {
          if (currentUser.role === 'admin') {
            teamDirectoryLoadedKeyRef.current = dirKey;
          }
          teamDirectoryFailedKeyRef.current = null;
        } else if (currentUser.role === 'admin') {
          teamDirectoryFailedKeyRef.current = dirKey;
        }
        setTeamMembers(res.members);
        setTeamMembersError(res.error);
      } finally {
        setTeamMembersLoading(false);
      }
    })();

    teamRefreshPromiseRef.current = task;
    try {
      await task;
    } finally {
      if (teamRefreshPromiseRef.current === task) {
        teamRefreshPromiseRef.current = null;
      }
    }
  }, [business.id, currentUser]);

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
    if (supabase && isSupabaseConfigured && UUID_REGEX.test(business.id)) {
      const patch: Record<string, unknown> = {};
      if (updates.name !== undefined) patch.name = updates.name;
      if (updates.industry !== undefined) patch.industry = updates.industry;
      if (updates.timezone !== undefined) patch.timezone = updates.timezone;
      if (updates.website !== undefined) patch.website = updates.website;
      if (Object.keys(patch).length > 0) {
        void supabase.from('businesses').update(patch).eq('id', business.id);
      }
    }
    appendAudit('Updated Business Settings', 'business', 'Modified business profile configuration');
  };

  const refreshWhatsAppAccount = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase || !UUID_REGEX.test(business.id)) return;
    const res = await fetchBusinessWhatsAppAccount(business.id);
    if (!res.ok || !res.row) return;
    const waData = res.row;
    const nextPhone = extractWhatsAppPhoneNumberId(waData);
    const nextWaba = extractWhatsAppWabaId(waData);
    setBusiness((prev) => ({
      ...prev,
      whatsappDisplayName: String(waData.display_name ?? prev.whatsappDisplayName),
      whatsappPhoneE164: String(
        waData.phone_number_e164 ?? waData.phone_number ?? prev.whatsappPhoneE164
      ),
      metaPhoneNumberId: nextPhone || prev.metaPhoneNumberId,
      metaWabaId: nextWaba || prev.metaWabaId,
      metaConnectionState:
        waData.connection_status !== undefined || waData.status !== undefined
          ? normalizeWhatsAppConnectionStatus(waData.connection_status ?? waData.status)
          : prev.metaConnectionState,
      metaLastError: waData.last_error_message ? String(waData.last_error_message) : prev.metaLastError,
      messagingMode:
        waData.messaging_mode === 'live'
          ? 'live'
          : waData.messaging_mode === 'test'
          ? 'test'
          : prev.messagingMode,
      testAllowlist: Array.isArray(waData.test_allowlist)
        ? waData.test_allowlist.map(String)
        : prev.testAllowlist,
      graphApiVersion: String(waData.graph_api_version ?? prev.graphApiVersion),
      verifiedName: waData.verified_name ? String(waData.verified_name) : prev.verifiedName,
      qualityRating:
        (waData.quality_rating as BusinessProfile['qualityRating']) ?? prev.qualityRating,
      webhookVerifiedAt: waData.webhook_verified_at
        ? String(waData.webhook_verified_at)
        : prev.webhookVerifiedAt,
    }));
  }, [business.id]);

  const verifyMetaConnection: AppContextValue['verifyMetaConnection'] = async (
    phoneNumberId,
    wabaId,
    options
  ) => {
    const cleanPhoneId = phoneNumberId.trim();
    const cleanWabaId = wabaId.trim();

    if (!cleanPhoneId || !cleanWabaId) {
      return { ok: false, message: 'Phone Number ID and WABA ID are required.' };
    }

    if (!isSupabaseConfigured || !supabase) {
      return {
        ok: false,
        message: 'Supabase configuration is required before checking Meta Cloud API.',
      };
    }

    const res = await invokeConnectionCheck({
      action: 'verify',
      phoneNumberId: cleanPhoneId,
      wabaId: cleanWabaId,
      messagingMode: options?.messagingMode ?? business.messagingMode,
      testAllowlist: options?.testAllowlist ?? business.testAllowlist,
      graphApiVersion: options?.graphApiVersion,
    });

    if (typeof res.webhookSecretsReady === 'boolean') {
      setWebhookSecretsReady(res.webhookSecretsReady);
    }

    if (res.ok) {
      setBusiness((prev) => ({
        ...prev,
        metaPhoneNumberId: res.phoneNumberId?.trim() || cleanPhoneId || prev.metaPhoneNumberId,
        metaWabaId: res.wabaId?.trim() || cleanWabaId || prev.metaWabaId,
        whatsappPhoneE164: res.displayPhoneNumber || prev.whatsappPhoneE164,
        whatsappDisplayName: res.verifiedName || prev.whatsappDisplayName,
        verifiedName: res.verifiedName || prev.verifiedName,
        qualityRating: res.qualityRating ?? prev.qualityRating,
        messagingMode: res.messagingMode ?? prev.messagingMode,
        testAllowlist: res.testAllowlist ?? prev.testAllowlist,
        graphApiVersion: res.graphApiVersion ?? prev.graphApiVersion,
        metaConnectionState: 'connected',
        metaLastError: undefined,
      }));
      await refreshWhatsAppAccount();
      return {
        ok: true,
        message: res.message || 'Meta WhatsApp Cloud API connection verified.',
      };
    }

    // Preserve entered/saved credentials on verification failure
    setBusiness((prev) => ({
      ...prev,
      metaPhoneNumberId: cleanPhoneId || prev.metaPhoneNumberId,
      metaWabaId: cleanWabaId || prev.metaWabaId,
      metaConnectionState: res.connectionStatus ?? 'error',
      metaLastError: res.error || 'Meta WhatsApp connection check failed.',
      messagingMode: res.messagingMode ?? prev.messagingMode,
      testAllowlist: res.testAllowlist ?? prev.testAllowlist,
      graphApiVersion: res.graphApiVersion ?? prev.graphApiVersion,
    }));

    return {
      ok: false,
      message: res.error || 'Could not verify Meta WhatsApp Cloud API connection.',
      diagnostic: res.diagnostic,
    };
  };

  const saveWhatsAppConfig: AppContextValue['saveWhatsAppConfig'] = async (options) => {
    if (!isSupabaseConfigured || !supabase) {
      return { ok: false, message: 'Supabase configuration is required.' };
    }

    const cleanPhoneId = (options.phoneNumberId ?? business.metaPhoneNumberId).trim();
    const cleanWabaId = (options.wabaId ?? business.metaWabaId).trim();

    const saveRes = await saveBusinessWhatsAppConfiguration({
      businessId: business.id,
      phoneNumberId: cleanPhoneId,
      wabaId: cleanWabaId,
      messagingMode: options.messagingMode,
      testAllowlist: options.testAllowlist,
      graphApiVersion: options.graphApiVersion ?? business.graphApiVersion,
    });

    if (!saveRes.ok) {
      return { ok: false, message: saveRes.message };
    }

    setBusiness((prev) => ({
      ...prev,
      metaPhoneNumberId: saveRes.phoneNumberId || cleanPhoneId,
      metaWabaId: saveRes.wabaId || cleanWabaId,
      messagingMode: saveRes.messagingMode ?? options.messagingMode,
      testAllowlist: saveRes.testAllowlist ?? options.testAllowlist,
      graphApiVersion: saveRes.graphApiVersion ?? prev.graphApiVersion,
      metaConnectionState:
        prev.metaConnectionState === 'connected' ? 'connected' : 'not_connected',
      metaLastError: undefined,
    }));

    return { ok: true, message: saveRes.message };
  };

  const refreshWebhookDiagnostics = async () => {
    if (!UUID_REGEX.test(business.id) || currentUser?.role !== 'admin') return;
    const events = await fetchRecentWebhookEvents(business.id, 10);
    setWebhookEvents(events);
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
    pendingAccount,
    signInWithSupabase,
    signUpWithSupabase,
    refreshWorkspaceAccess,
    resendConfirmationEmail,
    requestPasswordReset,
    updatePassword,
    logout,
    business,
    teamMembers,
    teamMembersLoading,
    teamMembersError,
    ensureTeamDirectoryLoaded,
    refreshTeamMembers,
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
    webhookEvents,
    webhookCallbackUrl,
    webhookSecretsReady,
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
    loadOlderMessages,
    hasMoreMessagesMap,
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
    saveWhatsAppConfig,
    refreshWhatsAppAccount,
    refreshWebhookDiagnostics,
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
