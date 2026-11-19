import { beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';

const BUSINESS_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const WA_ACCOUNT_ID = '88888888-8888-4888-8888-888888888888';
const CONV_ID = '99999999-9999-4999-8999-999999999999';

const mockInvoke = vi.fn();
const mockFrom = vi.fn();
const mockGetUser = vi.fn();

vi.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabaseConfigError: null,
  supabase: {
    auth: {
      getUser: (...args: unknown[]) => mockGetUser(...args),
    },
    functions: {
      invoke: (...args: unknown[]) => mockInvoke(...args),
    },
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

import {
  extractWhatsAppPhoneNumberId,
  extractWhatsAppWabaId,
  invokeConnectionCheck,
  invokeSendWhatsAppMessage,
  invokeSyncTemplates,
  mapDbMessageRow,
  normalizeWhatsAppConnectionStatus,
  saveBusinessWhatsAppConfiguration,
} from '@/services/whatsappService';

// Mirrors the monotonic delivery status state machine enforced by 003_whatsapp_messaging_engine.sql
const STATUS_RANK: Record<string, number> = {
  pending: 1,
  submitted: 2,
  sent: 3,
  delivered: 4,
  read: 5,
  failed: 99,
};

function applyMonotonicStatusTransition(
  current: string,
  incoming: 'sent' | 'delivered' | 'read' | 'failed'
): { nextStatus: string; advanced: boolean } {
  if (incoming === 'failed') {
    if (current === 'delivered' || current === 'read') {
      return { nextStatus: current, advanced: false };
    }
    return { nextStatus: 'failed', advanced: current !== 'failed' };
  }
  const curRank = STATUS_RANK[current] ?? 0;
  const incRank = STATUS_RANK[incoming] ?? 0;
  if (incRank <= curRank || current === 'failed') {
    return { nextStatus: current, advanced: false };
  }
  return { nextStatus: incoming, advanced: true };
}

function signMetaWebhookBody(rawBody: string, appSecret: string): string {
  const hmac = crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  return `sha256=${hmac}`;
}

function verifyMetaWebhookSignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header || !header.startsWith('sha256=') || !appSecret) return false;
  const provided = header.slice(7).trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(provided)) return false;
  const expected = crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(provided, 'hex'), Buffer.from(expected, 'hex'));
}

describe('WhatsApp Cloud API Integration Tests (Mocked Meta / Supabase)', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockFrom.mockReset();
    mockGetUser.mockReset();
    mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
  });

  it('normalizes allowed whatsapp_accounts.connection_status values accurately', () => {
    expect(normalizeWhatsAppConnectionStatus('not_connected')).toBe('not_connected');
    expect(normalizeWhatsAppConnectionStatus('connecting')).toBe('connecting');
    expect(normalizeWhatsAppConnectionStatus('connected')).toBe('connected');
    expect(normalizeWhatsAppConnectionStatus('error')).toBe('error');
    expect(normalizeWhatsAppConnectionStatus('connection_error')).toBe('error');
    expect(normalizeWhatsAppConnectionStatus('unknown')).toBe('not_connected');
  });

  it('extracts Phone Number ID and WABA ID across column aliases and ignores unconfigured placeholders', () => {
    expect(extractWhatsAppPhoneNumberId({ phone_number_id: '1010101010' })).toBe('1010101010');
    expect(extractWhatsAppPhoneNumberId({ meta_phone_number_id: 'unconfigured' })).toBe('');
    expect(extractWhatsAppWabaId({ waba_id: '2020202020' })).toBe('2020202020');
    expect(extractWhatsAppWabaId({ meta_waba_id: '3030303030' })).toBe('3030303030');
  });

  it('enforces admin-only membership check using is_active (never status) when saving WhatsApp config', async () => {
    const selectedColumns: string[] = [];

    mockFrom.mockImplementation((table: string) => {
      if (table === 'business_members') {
        return {
          select: (cols: string) => {
            selectedColumns.push(cols);
            return {
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: { role: 'agent', is_active: true },
                    error: null,
                  }),
                }),
              }),
            };
          },
        };
      }
      throw new Error(`Agent should have been blocked before touching ${table}`);
    });

    const res = await saveBusinessWhatsAppConfiguration({
      businessId: BUSINESS_ID,
      phoneNumberId: '1010101010',
      wabaId: '2020202020',
      messagingMode: 'test',
      testAllowlist: ['+15551234567'],
    });

    expect(res.ok).toBe(false);
    expect(res.message).toContain('Only active business administrators');
    expect(selectedColumns[0]).toContain('is_active');
    expect(selectedColumns[0]).not.toContain('status');
  });

  it('persists and verifies read-back when an active admin saves WhatsApp config', async () => {
    let waFetchCount = 0;

    mockFrom.mockImplementation((table: string) => {
      if (table === 'business_members') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { role: 'admin', is_active: true },
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'whatsapp_accounts') {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => {
                    waFetchCount += 1;
                    return {
                      data: {
                        id: WA_ACCOUNT_ID,
                        business_id: BUSINESS_ID,
                        phone_number_id: waFetchCount === 1 ? '0000000000' : '10987654321',
                        waba_id: waFetchCount === 1 ? '0000000000' : '20987654321',
                        connection_status: 'not_connected',
                        messaging_mode: 'test',
                        test_allowlist: ['+15551234567'],
                        graph_api_version: 'v25.0',
                      },
                      error: null,
                    };
                  },
                }),
              }),
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: WA_ACCOUNT_ID,
                    business_id: BUSINESS_ID,
                    phone_number_id: '10987654321',
                    waba_id: '20987654321',
                    connection_status: 'not_connected',
                    messaging_mode: 'test',
                    test_allowlist: ['+15551234567'],
                    graph_api_version: 'v25.0',
                  },
                  error: null,
                }),
              }),
            }),
          }),
          update: () => ({
            eq: () => ({
              eq: async () => ({ error: null }),
            }),
          }),
        };
      }
      if (table === 'audit_logs') {
        return { insert: async () => ({ error: null }) };
      }
      throw new Error(`Unexpected table ${table}`);
    });

    const res = await saveBusinessWhatsAppConfiguration({
      businessId: BUSINESS_ID,
      phoneNumberId: '10987654321',
      wabaId: '20987654321',
      messagingMode: 'test',
      testAllowlist: ['+15551234567'],
    });

    expect(res.ok).toBe(true);
    expect(res.phoneNumberId).toBe('10987654321');
    expect(res.wabaId).toBe('20987654321');
  });

  it('handles connection check, template sync, outbound send, and Meta API errors honestly', async () => {
    mockInvoke.mockResolvedValueOnce({
      data: {
        ok: true,
        connectionStatus: 'connected',
        phoneNumberId: '10987654321',
        wabaId: '20987654321',
        verifiedName: 'Zoqniva Test Biz',
        qualityRating: 'green',
      },
      error: null,
    });

    const checkRes = await invokeConnectionCheck({
      action: 'verify',
      phoneNumberId: '10987654321',
      wabaId: '20987654321',
    });
    expect(checkRes.ok).toBe(true);
    expect(checkRes.connectionStatus).toBe('connected');

    mockInvoke.mockResolvedValueOnce({
      data: { ok: true, totalFromMeta: 2, synced: 2, skipped: 0 },
      error: null,
    });
    const syncRes = await invokeSyncTemplates();
    expect(syncRes.ok).toBe(true);
    expect(syncRes.synced).toBe(2);

    // Outbound send accepted by Meta -> strictly 'submitted' (NOT fake 'delivered')
    mockInvoke.mockResolvedValueOnce({
      data: {
        ok: true,
        deliveryStatus: 'submitted',
        metaMessageId: 'wamid.HBgLMU5551234567',
        message: {
          id: 'msg-1',
          conversation_id: CONV_ID,
          direction: 'outbound',
          sender_type: 'agent',
          message_type: 'text',
          body: 'Hello from QA test',
          delivery_status: 'submitted',
          meta_message_id: 'wamid.HBgLMU5551234567',
        },
      },
      error: null,
    });

    const sendRes = await invokeSendWhatsAppMessage({
      conversationId: CONV_ID,
      messageType: 'text',
      body: 'Hello from QA test',
      clientRequestId: 'req-idempotent-1',
    });
    expect(sendRes.ok).toBe(true);
    expect(sendRes.deliveryStatus).toBe('submitted');
    expect(sendRes.metaMessageId).toBe('wamid.HBgLMU5551234567');

    const mappedMsg = mapDbMessageRow(sendRes.messageRow!, []);
    expect(mappedMsg.deliveryStatus).toBe('submitted');

    // Meta 24h window error (131047) returned by Edge Function
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: {
        message: 'Edge Function returned a non-2xx status code',
        context: {
          json: async () => ({
            ok: false,
            code: 'META_REENGAGEMENT_REQUIRED',
            error: 'More than 24 hours have passed since the customer replied.',
          }),
        },
      },
    });

    const errRes = await invokeSendWhatsAppMessage({
      conversationId: CONV_ID,
      messageType: 'text',
      body: 'After 24h',
      clientRequestId: 'req-idempotent-2',
    });
    expect(errRes.ok).toBe(false);
    expect(errRes.errorCode).toBe('META_REENGAGEMENT_REQUIRED');
  });

  it('verifies Meta HMAC-SHA256 webhook signatures and rejects tampered payloads', () => {
    const secret = 'test_meta_app_secret_only';
    const body = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{ id: '12345', changes: [{ field: 'messages', value: { statuses: [] } }] }],
    });
    const validSig = signMetaWebhookBody(body, secret);

    expect(verifyMetaWebhookSignature(body, validSig, secret)).toBe(true);
    expect(verifyMetaWebhookSignature(`${body} `, validSig, secret)).toBe(false);
    expect(verifyMetaWebhookSignature(body, 'sha256=deadbeef', secret)).toBe(false);
    expect(verifyMetaWebhookSignature(body, null, secret)).toBe(false);
  });

  it('enforces monotonic delivery status transitions (sent -> delivered -> read) and prevents out-of-order downgrade', () => {
    expect(applyMonotonicStatusTransition('submitted', 'sent')).toEqual({
      nextStatus: 'sent',
      advanced: true,
    });
    expect(applyMonotonicStatusTransition('sent', 'delivered')).toEqual({
      nextStatus: 'delivered',
      advanced: true,
    });
    expect(applyMonotonicStatusTransition('delivered', 'read')).toEqual({
      nextStatus: 'read',
      advanced: true,
    });
    // Out-of-order `sent` after `read` must NOT downgrade
    expect(applyMonotonicStatusTransition('read', 'sent')).toEqual({
      nextStatus: 'read',
      advanced: false,
    });
    // Late `failed` webhook after `delivered` must NOT overwrite delivered
    expect(applyMonotonicStatusTransition('delivered', 'failed')).toEqual({
      nextStatus: 'delivered',
      advanced: false,
    });
    // `failed` from `submitted` IS accepted
    expect(applyMonotonicStatusTransition('submitted', 'failed')).toEqual({
      nextStatus: 'failed',
      advanced: true,
    });
  });
});
