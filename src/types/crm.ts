export type StaffRole = 'admin' | 'agent';

export type MetaConnectionState =
  | 'not_connected'
  | 'connecting'
  | 'connected'
  | 'error';

export type MessagingMode = 'test' | 'live';

export type ConversationStatus = 'open' | 'pending' | 'resolved';

export type DeliveryStatus =
  | 'pending'
  | 'queued'
  | 'submitted'
  | 'sent'
  | 'delivered'
  | 'read'
  | 'failed'
  | 'internal';

export type MessageType =
  | 'text'
  | 'template'
  | 'image'
  | 'document'
  | 'audio'
  | 'video'
  | 'internal_note';

export interface BusinessProfile {
  id: string;
  name: string;
  slug: string;
  industry: string;
  timezone: string;
  website: string;
  whatsappAccountId?: string;
  whatsappDisplayName: string;
  whatsappPhoneE164: string;
  metaPhoneNumberId: string;
  metaWabaId: string;
  metaConnectionState: MetaConnectionState;
  metaLastError?: string;
  messagingMode: MessagingMode;
  testAllowlist: string[];
  graphApiVersion: string;
  verifiedName?: string;
  qualityRating?: 'green' | 'yellow' | 'red' | 'unknown';
  webhookVerifiedAt?: string;
}

export interface WebhookEventSummary {
  id: string;
  eventType: string;
  signatureValid: boolean;
  processed: boolean;
  processingError?: string;
  receivedAt: string;
}

export interface TeamMember {
  id: string;
  fullName: string;
  email: string;
  role: StaffRole;
  status: 'active' | 'invited' | 'suspended';
  jobTitle: string;
  activeConversations: number;
  resolvedToday: number;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
}

export interface Contact {
  id: string;
  fullName: string;
  phoneE164: string;
  waId?: string;
  email: string;
  company: string;
  city: string;
  country: string;
  marketingOptIn: boolean;
  optedOutAt?: string;
  tagIds: string[];
  notes: string;
  lastContactedAt?: string;
  createdAt: string;
}

export interface Message {
  id: string;
  conversationId: string;
  senderType: 'contact' | 'agent' | 'ai' | 'system';
  senderName: string;
  senderId?: string;
  direction: 'inbound' | 'outbound' | 'internal';
  messageType: MessageType;
  body: string;
  mediaUrl?: string;
  mediaFilename?: string;
  templateName?: string;
  clientRequestId?: string;
  metaMessageId?: string;
  deliveryStatus: DeliveryStatus;
  errorCode?: string;
  errorMessage?: string;
  submittedAt?: string;
  sentAt?: string;
  deliveredAt?: string;
  readAt?: string;
  failedAt?: string;
  lastStatusAt?: string;
  createdAt: string;
}

export interface Conversation {
  id: string;
  contactId: string;
  assignedToId: string | null;
  status: ConversationStatus;
  unreadCount: number;
  humanHandoffRequested: boolean;
  lastCustomerMessageAt: string;
  windowExpiresAt: string;
  lastMessagePreview: string;
  lastMessageAt: string;
}

export type TemplateCategory = 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';
export type TemplateApprovalStatus =
  | 'DRAFT'
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'PAUSED'
  | 'DISABLED';

export interface TemplateComponent {
  type: string;
  format?: string;
  text?: string;
  example?: {
    header_text?: string[];
    header_handle?: string[];
    body_text?: string[][];
    body_text_named_params?: Array<{ param_name?: string; example?: string }>;
    [key: string]: unknown;
  };
  buttons?: Array<{
    type?: string;
    text?: string;
    url?: string;
    phone_number?: string;
    example?: string[];
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

export interface MessageTemplate {
  id: string;
  metaTemplateId?: string | null;
  name: string;
  category: TemplateCategory;
  language: string;
  headerType: 'NONE' | 'TEXT' | 'IMAGE' | 'DOCUMENT' | 'VIDEO' | 'LOCATION';
  headerText?: string;
  bodyText: string;
  footerText?: string;
  buttons: Array<{ type: 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER'; text: string; value?: string }>;
  components?: TemplateComponent[];
  variablesCount: number;
  approvalStatus: TemplateApprovalStatus;
  rejectionReason?: string;
  lastSyncedAt?: string;
  updatedAt?: string;
  isLocalDraft?: boolean;
}

export type CampaignStatus =
  | 'draft'
  | 'scheduled'
  | 'running'
  | 'paused'
  | 'completed';

export interface Campaign {
  id: string;
  name: string;
  templateId: string;
  status: CampaignStatus;
  audienceMode?: 'all' | 'groups' | 'specific';
  targetTagIds: string[];
  targetContactIds?: string[];
  variableMapping: Record<string, string>;
  scheduledFor?: string;
  createdAt: string;
  metrics: {
    selected: number;
    eligible: number;
    submitted: number;
    sent: number;
    delivered: number;
    read: number;
    failed: number;
    skipped: number;
  };
}

export type AutomationRuleType =
  | 'welcome_message'
  | 'keyword_reply'
  | 'business_hours'
  | 'out_of_office'
  | 'auto_tagging'
  | 'conversation_assignment'
  | 'human_handoff';

export interface AutomationRule {
  id: string;
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
  executionCount: number;
}

export interface AIKnowledgeItem {
  id: string;
  title: string;
  category: string;
  content: string;
  updatedAt: string;
}

export interface AIAutomationLog {
  id: string;
  timestamp: string;
  channel: 'sandbox_test' | 'whatsapp';
  customerPrompt: string;
  generatedReply: string;
  outcome: 'sandbox_preview' | 'handoff_triggered' | 'blocked_unconfigured';
}

export interface AuditLogEntry {
  id: string;
  actorName: string;
  action: string;
  entityType: string;
  timestamp: string;
  details: string;
}

export interface BusinessHoursDay {
  day: string;
  enabled: boolean;
  open: string;
  close: string;
}

export interface AppNotification {
  id: string;
  title: string;
  description: string;
  severity: 'info' | 'warning' | 'error';
  createdAt: string;
  read: boolean;
  linkTo?: string;
}
