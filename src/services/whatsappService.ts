import { supabase } from '@/lib/supabase';
import type {
  DeliveryStatus,
  Message,
  MessageType,
  MessagingMode,
  MetaConnectionState,
  TeamMember,
  WebhookEventSummary,
} from '@/types/crm';

export function getWebhookCallbackUrl(): string | null {
  const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
  if (!url) return null;
  const match = url.match(/^https:\/\/([a-z0-9-]+)\.supabase\.co/i);
  if (match) {
    return `https://${match[1]}.supabase.co/functions/v1/whatsapp-webhook`;
  }
  return `${url.replace(/\/$/, '')}/functions/v1/whatsapp-webhook`;
}

async function extractFunctionErrorPayload(
  error: unknown
): Promise<Record<string, unknown> | null> {
  if (!error || typeof error !== 'object') return null;
  const ctx = (error as { context?: { json?: () => Promise<unknown> } }).context;
  if (ctx && typeof ctx.json === 'function') {
    try {
      const parsed = await ctx.json();
      if (parsed && typeof parsed === 'object') {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }
  return null;
}

export function mapDbMessageRow(
  row: Record<string, unknown>,
  teamMembers: TeamMember[]
): Message {
  const senderId = row.sender_profile_id ? String(row.sender_profile_id) : undefined;
  const senderMember = teamMembers.find((tm) => tm.id === senderId);
  const senderType = (row.sender_type as Message['senderType']) ?? 'contact';

  return {
    id: String(row.id),
    conversationId: String(row.conversation_id),
    senderType,
    senderName:
      senderMember?.fullName ??
      (senderType === 'contact' ? 'Customer' : senderType === 'ai' ? 'AI Assistant' : 'Team'),
    senderId,
    direction: (row.direction as Message['direction']) ?? 'inbound',
    messageType: (row.message_type as MessageType) ?? 'text',
    body: String(row.body ?? ''),
    mediaUrl: row.media_url ? String(row.media_url) : undefined,
    mediaFilename: row.media_filename ? String(row.media_filename) : undefined,
    templateName: row.template_name ? String(row.template_name) : undefined,
    clientRequestId: row.client_request_id ? String(row.client_request_id) : undefined,
    metaMessageId: row.meta_message_id ? String(row.meta_message_id) : undefined,
    deliveryStatus: (row.delivery_status as DeliveryStatus) ?? 'pending',
    errorCode: row.error_code ? String(row.error_code) : undefined,
    errorMessage: row.error_message ? String(row.error_message) : undefined,
    submittedAt: row.submitted_at ? String(row.submitted_at) : undefined,
    sentAt: row.sent_at ? String(row.sent_at) : undefined,
    deliveredAt: row.delivered_at ? String(row.delivered_at) : undefined,
    readAt: row.read_at ? String(row.read_at) : undefined,
    failedAt: row.failed_at ? String(row.failed_at) : undefined,
    lastStatusAt: row.last_status_at ? String(row.last_status_at) : undefined,
    createdAt: String(row.created_at ?? new Date().toISOString()),
  };
}

export interface ConnectionCheckResponse {
  ok: boolean;
  connectionStatus?: MetaConnectionState;
  phoneNumberId?: string;
  wabaId?: string;
  displayPhoneNumber?: string;
  verifiedName?: string;
  qualityRating?: 'green' | 'yellow' | 'red' | 'unknown';
  messagingMode?: MessagingMode;
  testAllowlist?: string[];
  graphApiVersion?: string;
  webhookCallbackUrl?: string;
  webhookSecretsReady?: boolean;
  message?: string;
  error?: string;
  errorCode?: string;
  diagnostic?: string;
}

export async function invokeConnectionCheck(params: {
  action: 'verify' | 'save_config';
  phoneNumberId?: string;
  wabaId?: string;
  messagingMode?: MessagingMode;
  testAllowlist?: string[];
  graphApiVersion?: string;
}): Promise<ConnectionCheckResponse> {
  if (!supabase) {
    return { ok: false, error: 'Supabase client is not configured.' };
  }

  const { data, error } = await supabase.functions.invoke('whatsapp-connection-check', {
    body: params,
  });

  if (error) {
    const errBody = await extractFunctionErrorPayload(error);
    return {
      ok: false,
      connectionStatus: (errBody?.connectionStatus as MetaConnectionState) ?? 'connection_error',
      errorCode: errBody?.errorCode ? String(errBody.errorCode) : 'EDGE_FUNCTION_ERROR',
      error: errBody?.error
        ? String(errBody.error)
        : (error as Error).message || 'Could not verify WhatsApp connection.',
      diagnostic: errBody?.diagnostic ? String(errBody.diagnostic) : undefined,
      webhookCallbackUrl: errBody?.webhookCallbackUrl
        ? String(errBody.webhookCallbackUrl)
        : getWebhookCallbackUrl() ?? undefined,
      webhookSecretsReady:
        typeof errBody?.webhookSecretsReady === 'boolean'
          ? errBody.webhookSecretsReady
          : undefined,
    };
  }

  return (data ?? { ok: false, error: 'Empty response from server.' }) as ConnectionCheckResponse;
}

export interface SendMessageServiceResult {
  ok: boolean;
  idempotentReplay?: boolean;
  deliveryStatus?: DeliveryStatus;
  metaMessageId?: string;
  errorCode?: string;
  error?: string;
  diagnostic?: string;
  messageRow?: Record<string, unknown>;
}

export async function invokeSendWhatsAppMessage(params: {
  conversationId: string;
  messageType: 'text' | 'template';
  body: string;
  templateName?: string;
  language?: string;
  templateParameters?: string[];
  clientRequestId: string;
}): Promise<SendMessageServiceResult> {
  if (!supabase) {
    return { ok: false, errorCode: 'SUPABASE_NOT_CONFIGURED', error: 'Supabase is not configured.' };
  }

  const { data, error } = await supabase.functions.invoke('whatsapp-send-message', {
    body: params,
  });

  if (error) {
    const errBody = await extractFunctionErrorPayload(error);
    return {
      ok: false,
      errorCode: errBody?.code ? String(errBody.code) : 'EDGE_FUNCTION_ERROR',
      error: errBody?.error
        ? String(errBody.error)
        : (error as Error).message || 'Failed to send message via WhatsApp Cloud API.',
      diagnostic: errBody?.diagnostic ? String(errBody.diagnostic) : undefined,
      messageRow:
        errBody?.message && typeof errBody.message === 'object'
          ? (errBody.message as Record<string, unknown>)
          : undefined,
    };
  }

  const payload = (data ?? {}) as Record<string, unknown>;
  return {
    ok: Boolean(payload.ok),
    idempotentReplay: Boolean(payload.idempotentReplay),
    deliveryStatus: payload.deliveryStatus as DeliveryStatus | undefined,
    metaMessageId: payload.metaMessageId ? String(payload.metaMessageId) : undefined,
    errorCode: payload.code ? String(payload.code) : undefined,
    error: payload.error ? String(payload.error) : undefined,
    messageRow:
      payload.message && typeof payload.message === 'object'
        ? (payload.message as Record<string, unknown>)
        : undefined,
  };
}

export async function fetchOlderMessagesPage(params: {
  businessId: string;
  conversationId: string;
  beforeIso: string;
  limit?: number;
  teamMembers: TeamMember[];
}): Promise<{ messages: Message[]; hasMore: boolean }> {
  if (!supabase) return { messages: [], hasMore: false };
  const limit = params.limit ?? 50;

  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('business_id', params.businessId)
    .eq('conversation_id', params.conversationId)
    .lt('created_at', params.beforeIso)
    .order('created_at', { ascending: false })
    .limit(limit + 1);

  if (error || !data) {
    return { messages: [], hasMore: false };
  }

  const hasMore = data.length > limit;
  const sliced = hasMore ? data.slice(0, limit) : data;
  const mapped = sliced
    .reverse()
    .map((row) => mapDbMessageRow(row as Record<string, unknown>, params.teamMembers));

  return { messages: mapped, hasMore };
}

export async function fetchRecentWebhookEvents(
  businessId: string,
  limit = 10
): Promise<WebhookEventSummary[]> {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('webhook_events')
    .select('id, event_type, signature_valid, processed, processing_error, received_at')
    .eq('business_id', businessId)
    .order('received_at', { ascending: false })
    .limit(limit);

  if (error || !data) return [];

  return (data as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    eventType: String(row.event_type ?? 'whatsapp_webhook'),
    signatureValid: Boolean(row.signature_valid),
    processed: Boolean(row.processed),
    processingError: row.processing_error ? String(row.processing_error) : undefined,
    receivedAt: String(row.received_at ?? new Date().toISOString()),
  }));
}
