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
import { buildComponentsFromDraftFields, mapDbTemplateRow } from '@/lib/templates';
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
  saveLocalTemplateDraftToDb,
  updateLocalTemplateDraftInDb,
} from '@/services/whatsappService';
import {
  fetchAdminTeamDirectory,
  fetchBasicWorkspaceTeamMembers,
} from '@/services/teamService';
import {
  bulkTagContactsInDb,
  createCampaignInDb,
  createContactInDb,
  createTagInDb,
  deleteContactInDb,
  importContactsBatchInDb,
  mapDbCampaignRow,
  mapDbContactRow,
  seedTableColumnsFromRows,
  updateCampaignStatusInDb,
  updateContactInDb,
} from '@/services/crmPersistenceService';
import {
  canUserAccessConversation,
  mapDbConversationRow,
  openOrCreateConversationInDb,
  seedConversationColumnsFromRows,
  updateConversationInDb,
  verifyConversationInDb,
} from '@/services/conversationPersistenceService';
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
    body?: string;
    messageType: MessageType;
    templateName?: string;
    language?: string;
    templateParameters?: string[];
    mediaFilename?: string;
    clientRequestId?: string;
  }) => Promise<{ ok: boolean; error?: string; code?: string }>;
  retryFailedMessage: (messageId: string) => Promise<{ ok: boolean; error?: string }>;
  loadOlderMessages: (conversationId: string) => Promise<{ loaded: number; hasMore: boolean }>;
  hasMoreMessagesMap: Record<string, boolean>;
  markConversationRead: (
    conversationId: string
  ) => Promise<{ ok: boolean; conversation?: Conversation; error?: string; code?: string }>;
  assignConversation: (
    conversationId: string,
    memberId: string | null
  ) => Promise<{ ok: boolean; conversation?: Conversation; error?: string; code?: string }>;
  updateConversationStatus: (
    conversationId: string,
    status: ConversationStatus
  ) => Promise<{ ok: boolean; conversation?: Conversation; error?: string; code?: string }>;
  toggleHumanHandoff: (
    conversationId: string,
    requested: boolean
  ) => Promise<{ ok: boolean; conversation?: Conversation; error?: string; code?: string }>;

  // Contacts Actions
  addContact: (input: {
    fullName: string;
    phone: string;
    email: string;
    company: string;
    city?: string;
    country?: string;
    marketingOptIn: boolean;
    tagIds: string[];
    notes: string;
  }) => Promise<{ ok: boolean; error?: string; warning?: string; contact?: Contact }>;
  updateContact: (
    id: string,
    updates: Partial<Contact>
  ) => Promise<{ ok: boolean; error?: string; contact?: Contact }>;
  deleteContact: (id: string) => Promise<{ ok: boolean; error?: string }>;
  bulkTagContacts: (contactIds: string[], tagId: string) => Promise<{ ok: boolean; error?: string }>;
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
  ) => Promise<{ ok: boolean; importedCount: number; error?: string }>;
  createTag: (
    name: string,
    color: string
  ) => Promise<{ ok: boolean; tag?: Tag; error?: string }>;
  openOrCreateConversationForContact: (
    contactId: string
  ) => Promise<{
    ok: boolean;
    conversation?: Conversation;
    created?: boolean;
    error?: string;
    code?: string;
  }>;

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
  }) => Promise<{ ok: boolean; campaign?: Campaign; error?: string }>;
  duplicateCampaign: (id: string) => Promise<{ ok: boolean; campaign?: Campaign; error?: string }>;
  updateCampaignStatus: (
    id: string,
    status: Campaign['status']
  ) => Promise<{ ok: boolean; error?: string }>;
  createTemplateDraft: (
    input: Omit<MessageTemplate, 'id' | 'approvalStatus'>
  ) => Promise<{ ok: boolean; template?: MessageTemplate; error?: string }>;
  updateTemplateDraft: (
    id: string,
    updates: Partial<MessageTemplate>
  ) => Promise<{ ok: boolean; error?: string }>;
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
  const currentUserRoleRef = useRef<StaffRole | null>(null);
  const selectedConversationIdRef = useRef<string | null>(null);
  const businessIdRef = useRef<string>('');
  const authStatusRef = useRef<AuthGateStatus>('loading');
  const resolvingUserPromiseRef = useRef<{ userId: string; promise: Promise<void> } | null>(null);
  const teamRefreshPromiseRef = useRef<Promise<void> | null>(null);
  const teamDirectoryLoadedKeyRef = useRef<string | null>(null);
  const teamDirectoryFailedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    currentUserIdRef.current = currentUser?.id ?? null;
    currentUserRoleRef.current = currentUser?.role ?? null;
  }, [currentUser]);
  useEffect(() => {
    selectedConversationIdRef.current = selectedConversationId;
  }, [selectedConversationId]);
  useEffect(() => {
    businessIdRef.current = business.id;
  }, [business.id]);
  useEffect(() => {
    authStatusRef.current = authStatus;
  }, [authStatus]);

  const persistSelectedConversationHint = useCallback((bizId: string, convId: string | null) => {
    if (!UUID_REGEX.test(bizId)) return;
    const key = `zoqniva_selected_conv:${bizId}`;
    try {
      if (convId && UUID_REGEX.test(convId)) {
        sessionStorage.setItem(key, convId);
      } else {
        sessionStorage.removeItem(key);
      }
    } catch {
      // Ignore storage quota / privacy mode restrictions
    }
  }, []);

  const handleSetSelectedConversationId = useCallback(
    (id: string | null) => {
      if (id !== null && !conversationsRef.current.some((c) => c.id === id)) {
        setSelectedConversationId(null);
        persistSelectedConversationHint(businessIdRef.current, null);
        return;
      }
      setSelectedConversationId(id);
      persistSelectedConversationHint(businessIdRef.current, id);
    },
    [persistSelectedConversationHint]
  );

  const removeStaleConversationFromState = useCallback(
    (conversationId: string) => {
      setConversations((prev) => prev.filter((c) => c.id !== conversationId));
      setMessages((prev) => prev.filter((m) => m.conversationId !== conversationId));
      if (selectedConversationIdRef.current === conversationId) {
        setSelectedConversationId(null);
        persistSelectedConversationHint(businessIdRef.current, null);
      }
    },
    [persistSelectedConversationHint]
  );

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
          whatsappAccountId: waData?.id ? String(waData.id) : undefined,
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

      const rawConvRows = (convsRes.data ?? []) as Array<Record<string, unknown>>;
      seedConversationColumnsFromRows(rawConvRows);
      const effectiveRole: StaffRole = callerRole ?? 'agent';
      const convList: Conversation[] = rawConvRows
        .map((c) => mapDbConversationRow(c))
        .filter((conv) => canUserAccessConversation(conv, { id: userId, role: effectiveRole }));
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

      const rawContactRows = (contactsRes.data ?? []) as Array<Record<string, unknown>>;
      seedTableColumnsFromRows('contacts', rawContactRows);
      const mappedContacts = rawContactRows.map((c) =>
        mapDbContactRow(c, tagMap.get(String(c.id)) ?? [])
      );
      setContacts(mappedContacts);

      // Preserve selected conversation ONLY if it exists in Supabase and is accessible to this user
      const authorizedConvIds = new Set(convList.map((cv) => cv.id));
      const contactIds = new Set(mappedContacts.map((ct) => ct.id));
      let savedHintId: string | null = null;
      try {
        savedHintId = sessionStorage.getItem(`zoqniva_selected_conv:${businessId}`);
      } catch {
        savedHintId = null;
      }
      const candidateSelectedId = selectedConversationIdRef.current ?? savedHintId;
      const matchingSelectedConv = candidateSelectedId
        ? convList.find((cv) => cv.id === candidateSelectedId && contactIds.has(cv.contactId))
        : null;

      if (matchingSelectedConv) {
        setSelectedConversationId(matchingSelectedConv.id);
        persistSelectedConversationHint(businessId, matchingSelectedConv.id);
      } else {
        setSelectedConversationId(null);
        persistSelectedConversationHint(businessId, null);
      }

      // Only retain messages belonging to loaded authorized DB conversations (never synthesize artificial threads)
      const loadedMsgs = [...(msgsRes.data ?? [])]
        .reverse()
        .map((m) => mapDbMessageRow(m as Record<string, unknown>, memberList))
        .filter((m) => authorizedConvIds.has(m.conversationId));
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
        (tplsRes.data ?? []).map((t) => mapDbTemplateRow(t as Record<string, unknown>))
      );

      const rawCampaignRows = (cmpsRes.data ?? []) as Array<Record<string, unknown>>;
      seedTableColumnsFromRows('campaigns', rawCampaignRows);
      setCampaigns(rawCampaignRows.map((cp) => mapDbCampaignRow(cp)));

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
          if (payload.eventType === 'DELETE') {
            const oldRow = (payload.old as Record<string, unknown> | null) ?? null;
            if (oldRow?.id) {
              removeStaleConversationFromState(String(oldRow.id));
            }
            return;
          }
          const c = (payload.new as Record<string, unknown> | null) ?? null;
          if (!c || !c.id) return;
          seedConversationColumnsFromRows([c]);
          const mappedConv = mapDbConversationRow(c);

          const activeUid = currentUserIdRef.current;
          const activeRole = currentUserRoleRef.current;
          if (
            activeUid &&
            activeRole &&
            !canUserAccessConversation(mappedConv, { id: activeUid, role: activeRole })
          ) {
            removeStaleConversationFromState(mappedConv.id);
            return;
          }

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
          if (payload.eventType === 'DELETE') {
            const oldRow = (payload.old as Record<string, unknown> | null) ?? null;
            if (oldRow?.id) {
              const removedId = String(oldRow.id);
              setContacts((prev) => prev.filter((item) => item.id !== removedId));
            }
            return;
          }
          const c = (payload.new as Record<string, unknown> | null) ?? null;
          if (!c || !c.id) return;
          seedTableColumnsFromRows('contacts', [c]);
          setContacts((prev) => {
            const existing = prev.find((item) => item.id === String(c.id));
            const mappedContact = mapDbContactRow(c, existing?.tagIds ?? []);
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
    language,
    templateParameters,
    mediaFilename,
    clientRequestId: providedRequestId,
  }) => {
    if (!UUID_REGEX.test(conversationId)) {
      return {
        ok: false,
        code: 'INVALID_CONVERSATION_ID',
        error:
          'Selected conversation does not have a valid Supabase UUID. Reopen or start a new conversation with this contact before sending.',
      };
    }

    if (!supabase || !isSupabaseConfigured || !UUID_REGEX.test(business.id)) {
      return {
        ok: false,
        code: 'SUPABASE_NOT_CONFIGURED',
        error: 'Supabase workspace configuration is required to send messages.',
      };
    }

    const trimmed = typeof body === 'string' ? body.trim() : '';
    if (messageType !== 'template') {
      if (!trimmed) return { ok: false, code: 'EMPTY_MESSAGE', error: 'Message content cannot be empty.' };
      if (trimmed.length > 4096) {
        return {
          ok: false,
          code: 'MESSAGE_TOO_LONG',
          error: 'WhatsApp messages cannot exceed 4,096 characters.',
        };
      }
    } else if (!templateName?.trim()) {
      return {
        ok: false,
        code: 'TEMPLATE_REQUIRED',
        error: 'Select an approved WhatsApp template before sending.',
      };
    }

    // Strictly verify the conversation exists in Supabase public.conversations BEFORE invoking Edge Functions or writing notes
    const convVerify = await verifyConversationInDb({
      businessId: business.id,
      conversationId,
      userId: currentUser?.id,
      role: currentUser?.role,
    });

    if (!convVerify.ok || !convVerify.exists || !convVerify.conversation) {
      if (!convVerify.exists) {
        removeStaleConversationFromState(conversationId);
      }
      return {
        ok: false,
        code: convVerify.code ?? 'CONVERSATION_NOT_FOUND',
        error:
          convVerify.error ||
          'This conversation does not exist in Supabase. Reopen or start a new conversation with this contact before sending.',
      };
    }

    const verifiedConv = convVerify.conversation;
    setConversations((prev) =>
      prev.some((c) => c.id === verifiedConv.id)
        ? prev.map((c) => (c.id === verifiedConv.id ? verifiedConv : c))
        : [verifiedConv, ...prev]
    );

    // Internal Team Note (written directly under strict RLS policy; only added to UI after DB confirms)
    if (messageType === 'internal_note') {
      const { data: insertedNote, error: noteErr } = await supabase
        .from('messages')
        .insert({
          business_id: business.id,
          conversation_id: verifiedConv.id,
          sender_type: 'agent',
          sender_profile_id: currentUser?.id ?? null,
          direction: 'internal',
          message_type: 'internal_note',
          body: trimmed,
          delivery_status: 'internal',
        })
        .select('*')
        .single();

      if (noteErr || !insertedNote) {
        return {
          ok: false,
          code: noteErr?.code ?? 'INTERNAL_NOTE_FAILED',
          error: noteErr?.message || 'Could not save internal note in Supabase.',
        };
      }

      const persistedNote = mapDbMessageRow(insertedNote as Record<string, unknown>, teamMembers);
      setMessages((prev) =>
        prev.some((m) => m.id === persistedNote.id) ? prev : [...prev, persistedNote]
      );
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

    const contact = contacts.find((c) => c.id === verifiedConv.contactId);
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

    const windowState = getWindowStatus(verifiedConv.windowExpiresAt);
    if (messageType === 'text' && !windowState.isOpen) {
      return {
        ok: false,
        code: 'WINDOW_EXPIRED',
        error:
          'The 24-hour customer service window is closed. You must send an approved WhatsApp template message.',
      };
    }

    let tplObj: MessageTemplate | undefined;
    if (messageType === 'template') {
      const cleanTemplateName = templateName!.trim();
      tplObj = templates.find(
        (t) =>
          t.name === cleanTemplateName &&
          t.approvalStatus === 'APPROVED' &&
          Boolean(t.metaTemplateId) &&
          (!language || t.language.toLowerCase() === language.trim().toLowerCase())
      );

      if (!tplObj) {
        return {
          ok: false,
          code: 'TEMPLATE_NOT_APPROVED',
          error: `Template "${cleanTemplateName}" is not synced and approved in Meta. Sync templates before sending.`,
        };
      }

      if (contact?.optedOutAt) {
        return {
          ok: false,
          code: 'CONTACT_OPTED_OUT',
          error: 'This customer has opted out of outbound WhatsApp template messages.',
        };
      }

      if (tplObj.category === 'MARKETING' && contact && !contact.marketingOptIn) {
        return {
          ok: false,
          code: 'CONTACT_OPTED_OUT',
          error: 'This customer has not opted in to marketing template messages.',
        };
      }
    }

    const clientRequestId = providedRequestId || crypto.randomUUID();
    const optimisticId = `pending-${clientRequestId}`;
    const optimisticNow = new Date().toISOString();
    const displayPreviewBody =
      messageType === 'template'
        ? trimmed || tplObj?.bodyText || `[WhatsApp Template: ${templateName}]`
        : trimmed;

    const optimisticMsg: Message = {
      id: optimisticId,
      conversationId: verifiedConv.id,
      senderType: 'agent',
      senderName: currentUser?.fullName ?? 'Agent',
      senderId: currentUser?.id,
      direction: 'outbound',
      messageType,
      body: displayPreviewBody,
      templateName,
      mediaFilename,
      clientRequestId,
      deliveryStatus: 'pending',
      createdAt: optimisticNow,
    };

    setMessages((prev) => [...prev, optimisticMsg]);

    const result = await invokeSendWhatsAppMessage({
      conversationId: verifiedConv.id,
      messageType,
      ...(messageType === 'text' ? { body: trimmed } : {}),
      templateName,
      language: language ?? tplObj?.language ?? 'en_US',
      ...(templateParameters && templateParameters.length > 0 ? { templateParameters } : {}),
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
        const seen = new Set<string>();
        return replaced.filter((m) => {
          if (seen.has(m.id)) return false;
          seen.add(m.id);
          return true;
        });
      });
    } else if (!result.ok) {
      if (result.errorCode === 'CONVERSATION_NOT_FOUND') {
        removeStaleConversationFromState(verifiedConv.id);
        return {
          ok: false,
          code: 'CONVERSATION_NOT_FOUND',
          error:
            'This conversation could not be found in Supabase. Reopen or start a new conversation with this contact before sending.',
        };
      }
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

    const previewBody =
      result.messageRow && typeof result.messageRow.body === 'string'
        ? result.messageRow.body
        : displayPreviewBody;

    setConversations((prev) =>
      prev.map((c) =>
        c.id === verifiedConv.id
          ? {
              ...c,
              lastMessagePreview: previewBody.slice(0, 140),
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

  const markConversationRead: AppContextValue['markConversationRead'] = async (conversationId) => {
    const target = conversations.find((c) => c.id === conversationId);
    if (target && target.unreadCount === 0) {
      return { ok: true, conversation: target };
    }

    if (!supabase || !isSupabaseConfigured || !UUID_REGEX.test(business.id)) {
      return {
        ok: false,
        code: 'SUPABASE_NOT_CONFIGURED',
        error: 'Supabase workspace configuration is required to update conversations.',
      };
    }

    const dbRes = await updateConversationInDb({
      businessId: business.id,
      conversationId,
      action: 'mark_read',
    });

    if (!dbRes.ok || !dbRes.conversation) {
      if (dbRes.notFound) {
        removeStaleConversationFromState(conversationId);
      }
      return {
        ok: false,
        code: dbRes.code,
        error: dbRes.error || 'Could not mark conversation as read in Supabase.',
      };
    }

    const persisted = dbRes.conversation;
    setConversations((prev) => prev.map((c) => (c.id === persisted.id ? persisted : c)));
    return { ok: true, conversation: persisted };
  };

  const assignConversation: AppContextValue['assignConversation'] = async (
    conversationId,
    memberId
  ) => {
    if (!supabase || !isSupabaseConfigured || !UUID_REGEX.test(business.id)) {
      return {
        ok: false,
        code: 'SUPABASE_NOT_CONFIGURED',
        error: 'Supabase workspace configuration is required to assign conversations.',
      };
    }

    const dbRes = await updateConversationInDb({
      businessId: business.id,
      conversationId,
      action: 'assign',
      assignedToId: memberId,
    });

    if (!dbRes.ok || !dbRes.conversation) {
      if (dbRes.notFound) {
        removeStaleConversationFromState(conversationId);
      }
      return {
        ok: false,
        code: dbRes.code,
        error: dbRes.error || 'Could not persist conversation assignment in Supabase.',
      };
    }

    const persisted = dbRes.conversation;
    if (persisted.assignedToId) setLastAssignedMemberId(persisted.assignedToId);

    if (
      currentUser &&
      !canUserAccessConversation(persisted, { id: currentUser.id, role: currentUser.role })
    ) {
      removeStaleConversationFromState(persisted.id);
    } else {
      setConversations((prev) => prev.map((c) => (c.id === persisted.id ? persisted : c)));
    }

    const memberName =
      teamMembers.find((m) => m.id === persisted.assignedToId)?.fullName ?? 'Unassigned';
    appendAudit(
      'Assigned Conversation',
      'conversation',
      `Assigned ${persisted.id} to ${memberName}`
    );
    return { ok: true, conversation: persisted };
  };

  const updateConversationStatus: AppContextValue['updateConversationStatus'] = async (
    conversationId,
    status
  ) => {
    if (!supabase || !isSupabaseConfigured || !UUID_REGEX.test(business.id)) {
      return {
        ok: false,
        code: 'SUPABASE_NOT_CONFIGURED',
        error: 'Supabase workspace configuration is required to update conversation status.',
      };
    }

    const dbRes = await updateConversationInDb({
      businessId: business.id,
      conversationId,
      action: 'status',
      status,
    });

    if (!dbRes.ok || !dbRes.conversation) {
      if (dbRes.notFound) {
        removeStaleConversationFromState(conversationId);
      }
      return {
        ok: false,
        code: dbRes.code,
        error: dbRes.error || 'Could not update conversation status in Supabase.',
      };
    }

    const persisted = dbRes.conversation;
    setConversations((prev) => prev.map((c) => (c.id === persisted.id ? persisted : c)));
    appendAudit(
      'Updated Conversation Status',
      'conversation',
      `Marked ${persisted.id} as ${persisted.status}`
    );
    return { ok: true, conversation: persisted };
  };

  const toggleHumanHandoff: AppContextValue['toggleHumanHandoff'] = async (
    conversationId,
    requested
  ) => {
    if (!supabase || !isSupabaseConfigured || !UUID_REGEX.test(business.id)) {
      return {
        ok: false,
        code: 'SUPABASE_NOT_CONFIGURED',
        error: 'Supabase workspace configuration is required to update handoff state.',
      };
    }

    const dbRes = await updateConversationInDb({
      businessId: business.id,
      conversationId,
      action: 'handoff',
      humanHandoffRequested: requested,
    });

    if (!dbRes.ok || !dbRes.conversation) {
      if (dbRes.notFound) {
        removeStaleConversationFromState(conversationId);
      }
      return {
        ok: false,
        code: dbRes.code,
        error: dbRes.error || 'Could not update human handoff flag in Supabase.',
      };
    }

    const persisted = dbRes.conversation;
    setConversations((prev) => prev.map((c) => (c.id === persisted.id ? persisted : c)));
    return { ok: true, conversation: persisted };
  };

  // ============================================================================
  // CONTACTS CRUD, CSV IMPORT & TAGGING (Real Supabase persistence + read-back)
  // ============================================================================
  const addContact: AppContextValue['addContact'] = async (input) => {
    const cleanName = input.fullName.trim();
    if (!cleanName) {
      return { ok: false, error: 'Please enter the contact full name.' };
    }
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
        error: `A contact with phone number ${normalized} already exists in this workspace.`,
      };
    }

    if (supabase && isSupabaseConfigured) {
      if (!UUID_REGEX.test(business.id)) {
        return {
          ok: false,
          error: 'Active business workspace could not be verified. Refresh and sign in again.',
        };
      }

      const dbRes = await createContactInDb({
        businessId: business.id,
        fullName: cleanName,
        phone: normalized,
        email: input.email,
        company: input.company,
        city: input.city,
        country: input.country,
        marketingOptIn: input.marketingOptIn,
        tagIds: input.tagIds,
        notes: input.notes,
        createdBy: currentUser?.id ?? null,
      });

      if (!dbRes.ok || !dbRes.contact) {
        return { ok: false, error: dbRes.error || 'Could not save contact to Supabase.' };
      }

      const persisted = dbRes.contact;
      setContacts((prev) => {
        const exists = prev.some((c) => c.id === persisted.id);
        return exists
          ? prev.map((c) => (c.id === persisted.id ? persisted : c))
          : [persisted, ...prev];
      });
      appendAudit('Created Contact', 'contact', `${persisted.fullName} (${persisted.phoneE164})`);
      return { ok: true, contact: persisted, warning: dbRes.warning };
    }

    // Non-Supabase local fallback (only when VITE_SUPABASE_* is intentionally unconfigured)
    const created: Contact = {
      id: crypto.randomUUID(),
      fullName: cleanName,
      phoneE164: normalized,
      waId: normalized.replace('+', ''),
      email: input.email.trim(),
      company: input.company.trim(),
      city: (input.city ?? '').trim(),
      country: (input.country ?? '').trim(),
      marketingOptIn: input.marketingOptIn,
      tagIds: input.tagIds,
      notes: input.notes.trim(),
      createdAt: new Date().toISOString(),
    };
    setContacts((prev) => [created, ...prev]);
    appendAudit('Created Contact', 'contact', `${created.fullName} (${created.phoneE164})`);
    return { ok: true, contact: created };
  };

  const updateContact: AppContextValue['updateContact'] = async (id, updates) => {
    const cleanUpdates: Partial<Contact> = { ...updates };
    if (cleanUpdates.phoneE164 !== undefined) {
      const normalized = normalizePhoneE164(cleanUpdates.phoneE164);
      if (!normalized) {
        return { ok: false, error: 'Invalid international E.164 phone format.' };
      }
      if (contacts.some((c) => c.id !== id && c.phoneE164 === normalized)) {
        return { ok: false, error: `Phone ${normalized} belongs to another contact.` };
      }
      cleanUpdates.phoneE164 = normalized;
      cleanUpdates.waId = normalized.replace('+', '');
    }

    const existing = contacts.find((c) => c.id === id);
    const nextOptOut =
      cleanUpdates.marketingOptIn === false && existing?.marketingOptIn
        ? new Date().toISOString()
        : cleanUpdates.marketingOptIn === true
        ? undefined
        : existing?.optedOutAt;

    if (supabase && isSupabaseConfigured) {
      if (!UUID_REGEX.test(business.id) || !UUID_REGEX.test(id)) {
        return { ok: false, error: 'Active workspace or contact identifier is invalid.' };
      }

      const dbRes = await updateContactInDb({
        businessId: business.id,
        contactId: id,
        updates: { ...cleanUpdates, optedOutAt: nextOptOut ?? null },
        existingTagIds: existing?.tagIds ?? [],
      });

      if (!dbRes.ok || !dbRes.contact) {
        return { ok: false, error: dbRes.error || 'Failed to update contact in Supabase.' };
      }

      const persisted = dbRes.contact;
      setContacts((prev) => prev.map((c) => (c.id === id ? persisted : c)));
      return { ok: true, contact: persisted };
    }

    setContacts((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c;
        return { ...c, ...cleanUpdates, optedOutAt: nextOptOut };
      })
    );
    return { ok: true };
  };

  const deleteContact: AppContextValue['deleteContact'] = async (id) => {
    const target = contacts.find((c) => c.id === id);

    if (supabase && isSupabaseConfigured) {
      if (!UUID_REGEX.test(business.id) || !UUID_REGEX.test(id)) {
        return { ok: false, error: 'Active workspace or contact identifier is invalid.' };
      }
      const dbRes = await deleteContactInDb({ businessId: business.id, contactId: id });
      if (!dbRes.ok) {
        return { ok: false, error: dbRes.error || 'Could not delete contact in Supabase.' };
      }
    }

    setContacts((prev) => prev.filter((c) => c.id !== id));
    setConversations((prev) => prev.filter((cv) => cv.contactId !== id));
    if (target) {
      appendAudit('Deleted Contact', 'contact', `${target.fullName} (${target.phoneE164})`);
    }
    return { ok: true };
  };

  const bulkTagContacts: AppContextValue['bulkTagContacts'] = async (contactIds, tagId) => {
    if (supabase && isSupabaseConfigured) {
      const dbRes = await bulkTagContactsInDb({ contactIds, tagId });
      if (!dbRes.ok) {
        return { ok: false, error: dbRes.error || 'Failed to apply tag in Supabase.' };
      }
    }

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
    return { ok: true };
  };

  const importContactsBatch: AppContextValue['importContactsBatch'] = async (rows) => {
    const existing = new Set(contacts.map((c) => c.phoneE164));
    const uniqueRows: typeof rows = [];
    for (const row of rows) {
      const normalized = normalizePhoneE164(row.phoneE164);
      if (normalized && !existing.has(normalized) && row.fullName.trim().length > 0) {
        existing.add(normalized);
        uniqueRows.push({ ...row, phoneE164: normalized, fullName: row.fullName.trim() });
      }
    }

    if (uniqueRows.length === 0) {
      return { ok: false, importedCount: 0, error: 'No new valid contacts to import.' };
    }

    if (supabase && isSupabaseConfigured) {
      if (!UUID_REGEX.test(business.id)) {
        return {
          ok: false,
          importedCount: 0,
          error: 'Active business workspace could not be verified.',
        };
      }
      const dbRes = await importContactsBatchInDb({
        businessId: business.id,
        rows: uniqueRows,
        createdBy: currentUser?.id ?? null,
      });
      if (!dbRes.ok) {
        return {
          ok: false,
          importedCount: 0,
          error: dbRes.error || 'Failed to import contacts into Supabase.',
        };
      }

      const persistedMap = new Map(dbRes.contacts.map((c) => [c.id, c]));
      setContacts((prev) => [
        ...dbRes.contacts,
        ...prev.filter((c) => !persistedMap.has(c.id)),
      ]);
      appendAudit(
        'Imported Contacts CSV',
        'contact',
        `Imported ${dbRes.contacts.length} normalized contacts`
      );
      return { ok: true, importedCount: dbRes.contacts.length };
    }

    const toAdd: Contact[] = uniqueRows.map((row) => ({
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
    }));
    setContacts((prev) => [...toAdd, ...prev]);
    appendAudit('Imported Contacts CSV', 'contact', `Imported ${toAdd.length} normalized contacts`);
    return { ok: true, importedCount: toAdd.length };
  };

  const createTag: AppContextValue['createTag'] = async (name, color) => {
    const cleanName = name.trim();
    if (!cleanName) {
      return { ok: false, error: 'Tag name cannot be empty.' };
    }
    const existing = tags.find((t) => t.name.toLowerCase() === cleanName.toLowerCase());
    if (existing) {
      return { ok: true, tag: existing };
    }

    if (supabase && isSupabaseConfigured) {
      if (!UUID_REGEX.test(business.id)) {
        return { ok: false, error: 'Active business workspace could not be verified.' };
      }
      const dbRes = await createTagInDb({
        businessId: business.id,
        name: cleanName,
        color,
      });
      if (!dbRes.ok || !dbRes.tag) {
        return { ok: false, error: dbRes.error || 'Could not create tag in Supabase.' };
      }
      const persistedTag = dbRes.tag;
      setTags((prev) =>
        prev.some((t) => t.id === persistedTag.id) ? prev : [...prev, persistedTag]
      );
      return { ok: true, tag: persistedTag };
    }

    const tag: Tag = {
      id: crypto.randomUUID(),
      name: cleanName,
      color,
    };
    setTags((prev) => [...prev, tag]);
    return { ok: true, tag };
  };

  const openOrCreateConversationForContact: AppContextValue['openOrCreateConversationForContact'] =
    async (contactId) => {
      if (!supabase || !isSupabaseConfigured || !UUID_REGEX.test(business.id)) {
        return {
          ok: false,
          code: 'SUPABASE_NOT_CONFIGURED',
          error: 'Active Supabase workspace is required to create or open a conversation.',
        };
      }

      const dbRes = await openOrCreateConversationInDb({
        businessId: business.id,
        contactId,
        whatsappAccountId: business.whatsappAccountId ?? null,
        assignToUserId: currentUser?.id ?? null,
      });

      if (!dbRes.ok || !dbRes.conversation) {
        return {
          ok: false,
          code: dbRes.code,
          error: dbRes.error || 'Could not create or open conversation in Supabase.',
        };
      }

      const persisted = dbRes.conversation;
      setConversations((prev) => {
        const exists = prev.some((c) => c.id === persisted.id);
        return exists
          ? prev.map((c) => (c.id === persisted.id ? persisted : c))
          : [persisted, ...prev];
      });
      setSelectedConversationId(persisted.id);
      persistSelectedConversationHint(business.id, persisted.id);

      if (dbRes.created) {
        appendAudit(
          'Started Conversation',
          'conversation',
          `Created conversation ${persisted.id} for contact ${contactId}`
        );
      }

      return {
        ok: true,
        conversation: persisted,
        created: dbRes.created,
      };
    };

  // ============================================================================
  // BROADCASTS & TEMPLATES (Real Supabase persistence; saving a draft NEVER sends WhatsApp)
  // ============================================================================
  const createCampaign: AppContextValue['createCampaign'] = async (input) => {
    const isMetaLive =
      business.metaConnectionState === 'connected' && business.messagingMode === 'live';
    // Never mark a draft as running or trigger any WhatsApp dispatch from campaign creation
    const nextStatus: Campaign['status'] =
      input.scheduleMode === 'draft' || !isMetaLive
        ? 'draft'
        : input.scheduleMode === 'scheduled'
        ? 'scheduled'
        : 'draft';

    const scheduledForValue = nextStatus === 'scheduled' ? input.scheduledFor : undefined;

    if (supabase && isSupabaseConfigured) {
      if (!UUID_REGEX.test(business.id)) {
        return {
          ok: false,
          error: 'Active business workspace could not be verified. Refresh and sign in again.',
        };
      }

      const dbRes = await createCampaignInDb({
        businessId: business.id,
        name: input.name,
        templateId: input.templateId,
        status: nextStatus,
        audienceMode: input.audienceMode ?? 'groups',
        targetTagIds: input.targetTagIds,
        targetContactIds: input.targetContactIds,
        variableMapping: input.variableMapping,
        scheduledFor: scheduledForValue,
        selectedCount: input.selectedCount,
        eligibleCount: input.eligibleCount,
        skippedCount: input.skippedCount,
        createdBy: currentUser?.id ?? null,
      });

      if (!dbRes.ok || !dbRes.campaign) {
        return {
          ok: false,
          error: dbRes.error || 'Could not save campaign draft to Supabase.',
        };
      }

      const persisted = dbRes.campaign;
      setCampaigns((prev) => [persisted, ...prev.filter((c) => c.id !== persisted.id)]);
      setRecentTemplateIds((prev) =>
        [input.templateId, ...prev.filter((tid) => tid !== input.templateId)].slice(0, 5)
      );
      appendAudit(
        persisted.status === 'draft' ? 'Saved Campaign Draft' : 'Created Broadcast Campaign',
        'campaign',
        `${persisted.name} (${persisted.metrics.eligible} eligible)`
      );
      return { ok: true, campaign: persisted };
    }

    const campaign: Campaign = {
      id: crypto.randomUUID(),
      name: input.name.trim(),
      templateId: input.templateId,
      status: nextStatus,
      audienceMode: input.audienceMode ?? 'groups',
      targetTagIds: input.targetTagIds,
      targetContactIds: input.targetContactIds,
      variableMapping: input.variableMapping,
      scheduledFor: scheduledForValue,
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
    appendAudit(
      'Saved Campaign Draft',
      'campaign',
      `${campaign.name} (${campaign.metrics.eligible} eligible)`
    );
    return { ok: true, campaign };
  };

  const duplicateCampaign: AppContextValue['duplicateCampaign'] = async (id) => {
    const source = campaigns.find((c) => c.id === id);
    if (!source) {
      return { ok: false, error: 'Source campaign not found.' };
    }

    if (supabase && isSupabaseConfigured) {
      if (!UUID_REGEX.test(business.id)) {
        return { ok: false, error: 'Active business workspace could not be verified.' };
      }
      const dbRes = await createCampaignInDb({
        businessId: business.id,
        name: `${source.name} (Copy)`,
        templateId: source.templateId,
        status: 'draft',
        audienceMode: source.audienceMode,
        targetTagIds: source.targetTagIds,
        targetContactIds: source.targetContactIds,
        variableMapping: source.variableMapping,
        selectedCount: source.metrics.selected,
        eligibleCount: source.metrics.eligible,
        skippedCount: source.metrics.skipped,
        createdBy: currentUser?.id ?? null,
      });

      if (!dbRes.ok || !dbRes.campaign) {
        return { ok: false, error: dbRes.error || 'Could not duplicate campaign in Supabase.' };
      }

      const persisted = dbRes.campaign;
      setCampaigns((prev) => [persisted, ...prev.filter((c) => c.id !== persisted.id)]);
      appendAudit('Duplicated Campaign', 'campaign', `Duplicated ${source.name}`);
      return { ok: true, campaign: persisted };
    }

    const copy: Campaign = {
      ...source,
      id: crypto.randomUUID(),
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
    return { ok: true, campaign: copy };
  };

  const updateCampaignStatus: AppContextValue['updateCampaignStatus'] = async (id, status) => {
    if (supabase && isSupabaseConfigured) {
      if (!UUID_REGEX.test(business.id) || !UUID_REGEX.test(id)) {
        return { ok: false, error: 'Active workspace or campaign identifier is invalid.' };
      }
      const dbRes = await updateCampaignStatusInDb({
        businessId: business.id,
        campaignId: id,
        status,
      });
      if (!dbRes.ok) {
        return { ok: false, error: dbRes.error || 'Could not update campaign status in Supabase.' };
      }
      setCampaigns((prev) =>
        prev.map((c) => (c.id === id ? { ...c, status: dbRes.campaign?.status ?? status } : c))
      );
      return { ok: true };
    }

    setCampaigns((prev) => prev.map((c) => (c.id === id ? { ...c, status } : c)));
    return { ok: true };
  };

  const createTemplateDraft: AppContextValue['createTemplateDraft'] = async (input) => {
    const duplicate = templates.find(
      (t) => t.name === input.name && t.language === input.language
    );
    if (duplicate) {
      return {
        ok: false,
        error: `A template named "${input.name}" (${input.language}) already exists in this workspace.`,
      };
    }

    const components = buildComponentsFromDraftFields({
      headerType: input.headerType,
      headerText: input.headerText,
      bodyText: input.bodyText,
      footerText: input.footerText,
      buttons: input.buttons,
    });
    const draftId = crypto.randomUUID();
    const nowIso = new Date().toISOString();

    const draft: MessageTemplate = {
      ...input,
      id: draftId,
      metaTemplateId: null,
      components,
      approvalStatus: 'DRAFT',
      isLocalDraft: true,
      updatedAt: nowIso,
    };

    if (supabase && isSupabaseConfigured && UUID_REGEX.test(business.id)) {
      const saved = await saveLocalTemplateDraftToDb({
        id: draftId,
        businessId: business.id,
        name: draft.name,
        category: draft.category,
        language: draft.language,
        headerType: draft.headerType,
        headerText: draft.headerText,
        bodyText: draft.bodyText,
        footerText: draft.footerText,
        buttons: draft.buttons,
        components,
        variablesCount: draft.variablesCount,
        createdBy: currentUser?.id ?? null,
      });
      if (!saved.ok) {
        return { ok: false, error: saved.error || 'Could not save template draft to database.' };
      }
      const mapped = saved.row ? mapDbTemplateRow(saved.row) : draft;
      setTemplates((prev) => [mapped, ...prev]);
      appendAudit('Created Template Draft', 'template', mapped.name);
      return { ok: true, template: mapped };
    }

    setTemplates((prev) => [draft, ...prev]);
    appendAudit('Created Template Draft', 'template', draft.name);
    return { ok: true, template: draft };
  };

  const updateTemplateDraft: AppContextValue['updateTemplateDraft'] = async (id, updates) => {
    const target = templates.find((t) => t.id === id);
    if (!target || target.approvalStatus !== 'DRAFT' || target.metaTemplateId) {
      return { ok: false, error: 'Only local drafts can be edited here.' };
    }

    const nextHeaderType = updates.headerType ?? target.headerType;
    const nextHeaderText =
      updates.headerText !== undefined ? updates.headerText : target.headerText;
    const nextBodyText = updates.bodyText !== undefined ? updates.bodyText : target.bodyText;
    const nextFooterText =
      updates.footerText !== undefined ? updates.footerText : target.footerText;
    const nextButtons = updates.buttons ?? target.buttons;
    const nextComponents = buildComponentsFromDraftFields({
      headerType: nextHeaderType,
      headerText: nextHeaderText,
      bodyText: nextBodyText,
      footerText: nextFooterText,
      buttons: nextButtons,
    });

    if (supabase && isSupabaseConfigured && UUID_REGEX.test(business.id) && UUID_REGEX.test(id)) {
      const saved = await updateLocalTemplateDraftInDb({
        id,
        businessId: business.id,
        name: updates.name,
        category: updates.category,
        language: updates.language,
        headerType: nextHeaderType,
        headerText: nextHeaderText,
        bodyText: nextBodyText,
        footerText: nextFooterText,
        buttons: nextButtons,
        components: nextComponents,
        variablesCount: updates.variablesCount,
      });
      if (!saved.ok) {
        return { ok: false, error: saved.error || 'Failed to update local draft.' };
      }
    }

    setTemplates((prev) =>
      prev.map((t) =>
        t.id === id && t.approvalStatus === 'DRAFT' && !t.metaTemplateId
          ? {
              ...t,
              ...updates,
              components: nextComponents,
              updatedAt: new Date().toISOString(),
            }
          : t
      )
    );
    return { ok: true };
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
        const detail = res.errors?.length
          ? ` (${res.errors.map((e) => `${e.name}: ${e.error}`).join('; ')})`
          : res.diagnostic
          ? ` (${res.diagnostic})`
          : '';
        return {
          ok: false,
          message: `${res.error || 'Could not sync templates from Meta.'}${detail}`,
        };
      }
      if (currentUser?.id) {
        await loadSupabaseWorkspace(currentUser.id, business.id, {
          role: currentUser.role,
          email: currentUser.email,
          fullName: currentUser.fullName,
        });
      }
      const parts = [
        `Synced ${res.synced} of ${res.totalFromMeta} template(s) from Meta.`,
      ];
      if (res.skipped > 0) {
        const skipNotes = res.skippedItems?.map((s) => `${s.name} (${s.language})`).join(', ');
        parts.push(
          `${res.skipped} skipped${skipNotes ? `: ${skipNotes}` : ''}.`
        );
      }
      if (res.errors && res.errors.length > 0) {
        parts.push(
          `${res.errors.length} failed (${res.errors.map((e) => `${e.name}: ${e.error}`).join('; ')}).`
        );
      }
      return { ok: true, message: parts.join(' ') };
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
    setSelectedConversationId: handleSetSelectedConversationId,
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
