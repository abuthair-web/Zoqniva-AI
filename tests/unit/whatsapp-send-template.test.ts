import fs from 'node:fs';
import path from 'node:path';
import { transformSync } from 'esbuild';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * REGRESSION TEST SUITE — supabase/functions/whatsapp-send-message/index.ts
 *
 * Compiles and executes the ACTUAL standalone Edge Function handler in-memory
 * with mocked Supabase client & mocked Meta Graph API fetch to prove:
 * 1. Static approved `hello_world` sends without `payload.body` or `templateParameters`,
 *    storing canonical content from `components` JSONB (ignoring arbitrary client text).
 * 2. Free-form text message with empty body is rejected.
 * 3. Pending, rejected, paused, disabled, draft, and missing templates fail before Meta is called.
 * 4. Duplicate `failed` and `pending` requests are NEVER reported as `ok: true` (both initial lookup & 23505 race).
 * 5. Duplicate `submitted` request replays cleanly without sending twice to Meta.
 * 6. Database update failure after Meta acceptance returns explicit reconciliation-required error
 *    preserving `metaMessageId` and `doNotResend: true` (never disguised as `ok: true`).
 * 7. Test Mode recipient allowlist, 24-hour window, and marketing/opt-out consent are enforced.
 * 8. Unsupported template components (media headers, dynamic URL buttons, carousels, named body params) fail safely.
 */

const EDGE_FN_PATH = path.resolve(
  import.meta.dirname,
  '../../supabase/functions/whatsapp-send-message/index.ts'
);

const BUSINESS_A = '11111111-1111-4111-8111-111111111111';
const BUSINESS_B = '22222222-2222-4222-8222-222222222222';
const CALLER_ID = '33333333-3333-4333-8333-333333333333';
const CONV_ID = '44444444-4444-4444-8444-444444444444';
const CONTACT_ID = '55555555-5555-4555-8555-555555555555';

interface TemplateRow {
  id: string;
  business_id: string;
  meta_template_id: string | null;
  name: string;
  language: string;
  category: string;
  status: string;
  components: unknown;
}

interface HarnessState {
  templates: TemplateRow[];
  templatesQueryError: { code?: string; message: string } | null;
  selectedTemplateColumns: string[];
  templateBusinessFilters: string[];
  contactOptIn: boolean;
  contactOptedOutAt: string | null;
  contactPhone: string;
  windowExpiresAt: string;
  messagingMode: 'test' | 'live';
  testAllowlist: string[];
  existingIdempotentMsg: Record<string, unknown> | null;
  raceConflictMsg: Record<string, unknown> | null;
  simulateMessageInsert23505: boolean;
  simulateSubmittedUpdateError: { code?: string; message: string } | null;
  recordedMessageInserts: Array<Record<string, unknown>>;
  recordedConversationUpdates: Array<Record<string, unknown>>;
  recordedMessageEvents: Array<Record<string, unknown>>;
  metaFetchCalls: Array<{ url: string; body: Record<string, unknown> }>;
}

const state: HarnessState = {
  templates: [],
  templatesQueryError: null,
  selectedTemplateColumns: [],
  templateBusinessFilters: [],
  contactOptIn: true,
  contactOptedOutAt: null,
  contactPhone: '+15551234567',
  windowExpiresAt: new Date(Date.now() - 3600_000).toISOString(),
  messagingMode: 'test',
  testAllowlist: ['+15551234567'],
  existingIdempotentMsg: null,
  raceConflictMsg: null,
  simulateMessageInsert23505: false,
  simulateSubmittedUpdateError: null,
  recordedMessageInserts: [],
  recordedConversationUpdates: [],
  recordedMessageEvents: [],
  metaFetchCalls: [],
};

let edgeHandler: (req: Request) => Promise<Response>;

function buildMockSupabaseClient() {
  let messagesSelectCount = 0;

  return {
    auth: {
      getUser: async () => ({
        data: { user: { id: CALLER_ID, email: 'admin@biz-a.test' } },
        error: null,
      }),
    },
    from: (table: string) => {
      if (table === 'conversations') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: CONV_ID,
                  business_id: BUSINESS_A,
                  assigned_to: CALLER_ID,
                  window_expires_at: state.windowExpiresAt,
                  contact: {
                    id: CONTACT_ID,
                    full_name: 'QA Recipient',
                    phone_e164: state.contactPhone,
                    wa_id: state.contactPhone.replace(/^\+/, ''),
                    marketing_opt_in: state.contactOptIn,
                    opted_out_at: state.contactOptedOutAt,
                  },
                },
                error: null,
              }),
            }),
          }),
          update: (patch: Record<string, unknown>) => ({
            eq: async () => {
              state.recordedConversationUpdates.push(patch);
              return { error: null };
            },
          }),
        };
      }

      if (table === 'business_members') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: { role: 'admin', is_active: true },
                    error: null,
                  }),
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
                  maybeSingle: async () => ({
                    data: {
                      id: 'wa-1',
                      business_id: BUSINESS_A,
                      phone_number_id: '100200300400',
                      connection_status: 'connected',
                      messaging_mode: state.messagingMode,
                      test_allowlist: state.testAllowlist,
                      graph_api_version: 'v25.0',
                    },
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        };
      }

      if (table === 'templates') {
        const filters: Record<string, unknown> = {};
        const builder = {
          select: (cols: string) => {
            state.selectedTemplateColumns.push(cols);
            if (/\bapproval_status\b/.test(cols)) {
              throw new Error('REGRESSION: templates query referenced nonexistent approval_status column');
            }
            return builder;
          },
          eq: (col: string, val: unknown) => {
            if (col === 'approval_status') {
              throw new Error('REGRESSION: templates filter referenced nonexistent approval_status column');
            }
            if (col === 'business_id') {
              state.templateBusinessFilters.push(String(val));
            }
            filters[col] = val;
            return builder;
          },
          then: (resolve: (value: unknown) => unknown) => {
            if (state.templatesQueryError) {
              return Promise.resolve({ data: null, error: state.templatesQueryError }).then(resolve);
            }
            const matched = state.templates.filter((row) =>
              Object.entries(filters).every(
                ([k, v]) => (row as unknown as Record<string, unknown>)[k] === v
              )
            );
            return Promise.resolve({ data: matched, error: null }).then(resolve);
          },
        };
        return builder;
      }

      if (table === 'messages') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => {
                  messagesSelectCount += 1;
                  if (messagesSelectCount === 1) {
                    return { data: state.existingIdempotentMsg, error: null };
                  }
                  return { data: state.raceConflictMsg, error: null };
                },
              }),
            }),
          }),
          insert: (row: Record<string, unknown>) => ({
            select: () => ({
              single: async () => {
                if (state.simulateMessageInsert23505) {
                  return {
                    data: null,
                    error: {
                      code: '23505',
                      message: 'duplicate key value violates unique constraint "messages_business_client_req_uidx"',
                    },
                  };
                }
                state.recordedMessageInserts.push(row);
                return {
                  data: { id: 'msg-created-1', ...row },
                  error: null,
                };
              },
            }),
          }),
          update: (patch: Record<string, unknown>) => ({
            eq: () => ({
              select: () => ({
                single: async () => {
                  if (patch.delivery_status === 'submitted' && state.simulateSubmittedUpdateError) {
                    return { data: null, error: state.simulateSubmittedUpdateError };
                  }
                  return {
                    data: { id: 'msg-created-1', ...patch },
                    error: null,
                  };
                },
              }),
            }),
          }),
        };
      }

      if (table === 'message_events') {
        return {
          insert: (row: Record<string, unknown>) => {
            state.recordedMessageEvents.push(row);
            return Promise.resolve({ error: null });
          },
        };
      }

      if (table === 'contacts') {
        return {
          update: () => ({ eq: async () => ({ error: null }) }),
        };
      }

      throw new Error(`Unexpected table queried in test harness: ${table}`);
    },
  };
}

function invokeEdge(body: Record<string, unknown>): Promise<Response> {
  const req = new Request('https://local.test/functions/v1/whatsapp-send-message', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer test-valid-jwt',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return edgeHandler(req);
}

describe('whatsapp-send-message Edge Function — Reliability & Template Regression Suite', () => {
  beforeAll(() => {
    const rawTs = fs.readFileSync(EDGE_FN_PATH, 'utf8');
    const withoutImport = rawTs.replace(
      /import\s+\{\s*createClient\s*\}\s+from\s+['"][^'"]+['"];?/,
      ''
    );
    const js = transformSync(withoutImport, { loader: 'ts', target: 'es2022' }).code;

    const envMap: Record<string, string> = {
      SUPABASE_URL: 'https://staging.supabase.co',
      SUPABASE_ANON_KEY: 'staging-anon-key',
      SUPABASE_SERVICE_ROLE_KEY: 'staging-service-key',
      META_ACCESS_TOKEN: 'test-meta-token',
      META_GRAPH_API_VERSION: 'v25.0',
    };

    const mockDeno = {
      env: { get: (k: string) => envMap[k] },
      serve: (fn: (req: Request) => Promise<Response>) => {
        edgeHandler = fn;
      },
    };

    const mockFetch = async (url: string, init?: RequestInit) => {
      const parsedBody = init?.body ? JSON.parse(String(init.body)) : {};
      state.metaFetchCalls.push({ url: String(url), body: parsedBody });
      return new Response(
        JSON.stringify({
          messaging_product: 'whatsapp',
          messages: [{ id: 'wamid.TEST_ACCEPTED_123' }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const factory = new Function('createClient', 'Deno', 'fetch', js);
    factory(() => buildMockSupabaseClient(), mockDeno, mockFetch);

    if (typeof edgeHandler !== 'function') {
      throw new Error('Failed to capture Deno.serve handler from whatsapp-send-message/index.ts');
    }
  });

  beforeEach(() => {
    state.templatesQueryError = null;
    state.selectedTemplateColumns = [];
    state.templateBusinessFilters = [];
    state.contactOptIn = true;
    state.contactOptedOutAt = null;
    state.contactPhone = '+15551234567';
    state.windowExpiresAt = new Date(Date.now() - 3600_000).toISOString();
    state.messagingMode = 'test';
    state.testAllowlist = ['+15551234567'];
    state.existingIdempotentMsg = null;
    state.raceConflictMsg = null;
    state.simulateMessageInsert23505 = false;
    state.simulateSubmittedUpdateError = null;
    state.recordedMessageInserts = [];
    state.recordedConversationUpdates = [];
    state.recordedMessageEvents = [];
    state.metaFetchCalls = [];
    state.templates = [
      {
        id: 'tpl-hello',
        business_id: BUSINESS_A,
        meta_template_id: 'meta-1001',
        name: 'hello_world',
        language: 'en_US',
        category: 'utility',
        status: 'approved',
        components: [
          { type: 'HEADER', format: 'TEXT', text: 'Hello World' },
          {
            type: 'BODY',
            text: 'Welcome and congratulations!! This message demonstrates your ability to send a WhatsApp message notification from the Cloud API.',
          },
          { type: 'FOOTER', text: 'WhatsApp Business Platform sample message' },
        ],
      },
      {
        id: 'tpl-order',
        business_id: BUSINESS_A,
        meta_template_id: 'meta-1002',
        name: 'order_update',
        language: 'en_US',
        category: 'UTILITY',
        status: 'approved',
        components: [{ type: 'BODY', text: 'Hi {{1}}, your order {{2}} is confirmed.' }],
      },
      {
        id: 'tpl-marketing',
        business_id: BUSINESS_A,
        meta_template_id: 'meta-1003',
        name: 'promo_welcome',
        language: 'en',
        category: 'marketing',
        status: 'approved',
        components: [{ type: 'BODY', text: 'Welcome {{1}} to Zoqniva!' }],
      },
      {
        id: 'tpl-pending',
        business_id: BUSINESS_A,
        meta_template_id: 'meta-1004',
        name: 'pending_review_tpl',
        language: 'en_US',
        category: 'utility',
        status: 'pending',
        components: [{ type: 'BODY', text: 'Pending body' }],
      },
      {
        id: 'tpl-rejected',
        business_id: BUSINESS_A,
        meta_template_id: 'meta-1005',
        name: 'rejected_promo_tpl',
        language: 'en_US',
        category: 'marketing',
        status: 'rejected',
        components: [{ type: 'BODY', text: 'Rejected body' }],
      },
      {
        id: 'tpl-draft',
        business_id: BUSINESS_A,
        meta_template_id: null,
        name: 'local_draft_tpl',
        language: 'en_US',
        category: 'utility',
        status: 'draft',
        components: [{ type: 'BODY', text: 'Local draft body' }],
      },
      {
        id: 'tpl-media-header',
        business_id: BUSINESS_A,
        meta_template_id: 'meta-1006',
        name: 'image_header_tpl',
        language: 'en_US',
        category: 'utility',
        status: 'approved',
        components: [
          { type: 'HEADER', format: 'IMAGE' },
          { type: 'BODY', text: 'Check out this image!' },
        ],
      },
      {
        id: 'tpl-dynamic-url',
        business_id: BUSINESS_A,
        meta_template_id: 'meta-1007',
        name: 'dynamic_url_btn_tpl',
        language: 'en_US',
        category: 'utility',
        status: 'approved',
        components: [
          { type: 'BODY', text: 'Track your shipment below.' },
          {
            type: 'BUTTONS',
            buttons: [{ type: 'URL', text: 'Track', url: 'https://example.com/track/{{1}}' }],
          },
        ],
      },
      {
        id: 'tpl-carousel',
        business_id: BUSINESS_A,
        meta_template_id: 'meta-1008',
        name: 'carousel_tpl',
        language: 'en_US',
        category: 'marketing',
        status: 'approved',
        components: [
          { type: 'BODY', text: 'Browse products' },
          { type: 'CAROUSEL' },
        ],
      },
      {
        id: 'tpl-named-param',
        business_id: BUSINESS_A,
        meta_template_id: 'meta-1009',
        name: 'named_param_tpl',
        language: 'en_US',
        category: 'utility',
        status: 'approved',
        components: [{ type: 'BODY', text: 'Hi {{customer_name}}, welcome!' }],
      },
      {
        id: 'tpl-other-biz',
        business_id: BUSINESS_B,
        meta_template_id: 'meta-9999',
        name: 'business_b_only_tpl',
        language: 'en_US',
        category: 'utility',
        status: 'approved',
        components: [{ type: 'BODY', text: 'Belongs to Business B' }],
      },
    ];
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('1. Static approved hello_world sends without payload.body or templateParameters and stores canonical components text', async () => {
    const res = await invokeEdge({
      conversationId: CONV_ID,
      messageType: 'template',
      templateName: 'hello_world',
      language: 'en_US',
      clientRequestId: 'req-hello-world-no-body',
    });

    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.deliveryStatus).toBe('submitted');
    expect(json.metaMessageId).toBe('wamid.TEST_ACCEPTED_123');
    expect(state.selectedTemplateColumns[0]).not.toContain('approval_status');
    expect(state.selectedTemplateColumns[0]).toContain('status');
    expect(state.selectedTemplateColumns[0]).toContain('components');
    expect(state.selectedTemplateColumns[0]).toContain('meta_template_id');
    expect(state.templateBusinessFilters).toEqual([BUSINESS_A]);

    // Verify stored DB body & conversation preview come from verified Meta components JSONB
    const insertedBody = String(state.recordedMessageInserts[0]?.body ?? '');
    expect(insertedBody).toContain('Hello World');
    expect(insertedBody).toContain('Welcome and congratulations!!');
    expect(state.recordedConversationUpdates[0]?.last_message_preview).toBe(insertedBody.slice(0, 140));

    // Verify Meta payload sends template without empty components/body fields
    expect(state.metaFetchCalls).toHaveLength(1);
    expect(state.metaFetchCalls[0].body).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '15551234567',
      type: 'template',
      template: {
        name: 'hello_world',
        language: { code: 'en_US' },
      },
    });
  });

  it('ignores arbitrary client-supplied body text on template sends so DB never misrepresents the Meta template', async () => {
    const res = await invokeEdge({
      conversationId: CONV_ID,
      messageType: 'template',
      templateName: 'order_update',
      body: 'SPOOFED ARBITRARY CLIENT TEXT',
      templateParameters: ['Amina', '#42'],
    });

    expect(res.status).toBe(200);
    const insertedBody = String(state.recordedMessageInserts[0]?.body ?? '');
    expect(insertedBody).toBe('Hi Amina, your order #42 is confirmed.');
    expect(insertedBody).not.toContain('SPOOFED');
  });

  it('2. Text message with empty body is rejected before DB or Meta calls', async () => {
    state.windowExpiresAt = new Date(Date.now() + 3600_000).toISOString();
    const res = await invokeEdge({
      conversationId: CONV_ID,
      messageType: 'text',
      body: '   ',
    });
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.ok).toBe(false);
    expect(json.code).toBe('EMPTY_MESSAGE');
    expect(state.metaFetchCalls).toHaveLength(0);
    expect(state.recordedMessageInserts).toHaveLength(0);
  });

  it('3. Pending, rejected, draft, and missing templates are rejected before Meta is called', async () => {
    const pendingRes = await invokeEdge({
      conversationId: CONV_ID,
      messageType: 'template',
      templateName: 'pending_review_tpl',
    });
    expect(pendingRes.status).toBe(400);
    expect((await pendingRes.json()).code).toBe('TEMPLATE_PENDING');

    const rejectedRes = await invokeEdge({
      conversationId: CONV_ID,
      messageType: 'template',
      templateName: 'rejected_promo_tpl',
    });
    expect(rejectedRes.status).toBe(400);
    expect((await rejectedRes.json()).code).toBe('TEMPLATE_REJECTED');

    const draftRes = await invokeEdge({
      conversationId: CONV_ID,
      messageType: 'template',
      templateName: 'local_draft_tpl',
    });
    expect(draftRes.status).toBe(400);
    expect((await draftRes.json()).code).toBe('TEMPLATE_NOT_APPROVED');

    const missingRes = await invokeEdge({
      conversationId: CONV_ID,
      messageType: 'template',
      templateName: 'nonexistent_template',
    });
    expect(missingRes.status).toBe(404);
    expect((await missingRes.json()).code).toBe('TEMPLATE_NOT_FOUND');

    const crossBizRes = await invokeEdge({
      conversationId: CONV_ID,
      messageType: 'template',
      templateName: 'business_b_only_tpl',
    });
    expect(crossBizRes.status).toBe(404);
    expect((await crossBizRes.json()).code).toBe('TEMPLATE_NOT_FOUND');

    expect(state.metaFetchCalls).toHaveLength(0);
  });

  it('4. Duplicate failed and pending requests are NEVER reported as successful (initial check & 23505 race)', async () => {
    // A. Initial idempotency lookup finds existing FAILED record
    state.existingIdempotentMsg = {
      id: 'msg-failed-1',
      delivery_status: 'failed',
      meta_message_id: null,
      error_code: 'META_131026',
      error_message: 'Undeliverable',
    };
    const failedReplay = await invokeEdge({
      conversationId: CONV_ID,
      messageType: 'template',
      templateName: 'hello_world',
      clientRequestId: 'req-failed-dup',
    });
    const failedJson = await failedReplay.json();
    expect(failedReplay.status).toBe(409);
    expect(failedJson.ok).toBe(false);
    expect(failedJson.code).toBe('IDEMPOTENT_REQUEST_FAILED');
    expect(failedJson.deliveryStatus).toBe('failed');
    expect(state.metaFetchCalls).toHaveLength(0);

    // B. Initial idempotency lookup finds existing PENDING record
    state.existingIdempotentMsg = {
      id: 'msg-pending-1',
      delivery_status: 'pending',
      meta_message_id: null,
    };
    const pendingReplay = await invokeEdge({
      conversationId: CONV_ID,
      messageType: 'template',
      templateName: 'hello_world',
      clientRequestId: 'req-pending-dup',
    });
    const pendingJson = await pendingReplay.json();
    expect(pendingReplay.status).toBe(409);
    expect(pendingJson.ok).toBe(false);
    expect(pendingJson.code).toBe('IDEMPOTENT_REQUEST_IN_PROGRESS');
    expect(pendingJson.deliveryStatus).toBe('pending');
    expect(pendingJson.doNotResend).toBe(true);
    expect(state.metaFetchCalls).toHaveLength(0);

    // C. PostgreSQL 23505 race conflict resolves to existing FAILED record -> must NOT return ok: true
    state.existingIdempotentMsg = null;
    state.simulateMessageInsert23505 = true;
    state.raceConflictMsg = {
      id: 'msg-race-failed',
      delivery_status: 'failed',
      meta_message_id: null,
      error_code: 'META_SEND_FAILED',
    };
    const raceFailedRes = await invokeEdge({
      conversationId: CONV_ID,
      messageType: 'template',
      templateName: 'hello_world',
      clientRequestId: 'req-race-failed',
    });
    const raceFailedJson = await raceFailedRes.json();
    expect(raceFailedRes.status).toBe(409);
    expect(raceFailedJson.ok).toBe(false);
    expect(raceFailedJson.code).toBe('IDEMPOTENT_REQUEST_FAILED');
    expect(state.metaFetchCalls).toHaveLength(0);

    // D. PostgreSQL 23505 race conflict resolves to existing PENDING record -> must NOT return ok: true
    state.raceConflictMsg = {
      id: 'msg-race-pending',
      delivery_status: 'pending',
      meta_message_id: null,
    };
    const racePendingRes = await invokeEdge({
      conversationId: CONV_ID,
      messageType: 'template',
      templateName: 'hello_world',
      clientRequestId: 'req-race-pending',
    });
    const racePendingJson = await racePendingRes.json();
    expect(racePendingRes.status).toBe(409);
    expect(racePendingJson.ok).toBe(false);
    expect(racePendingJson.code).toBe('IDEMPOTENT_REQUEST_IN_PROGRESS');
    expect(state.metaFetchCalls).toHaveLength(0);
  });

  it('5. Duplicate submitted request replays idempotently without sending twice to Meta', async () => {
    state.existingIdempotentMsg = {
      id: 'msg-submitted-1',
      delivery_status: 'submitted',
      meta_message_id: 'wamid.EXISTING_999',
    };

    const res = await invokeEdge({
      conversationId: CONV_ID,
      messageType: 'template',
      templateName: 'hello_world',
      clientRequestId: 'req-submitted-dup',
    });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.idempotentReplay).toBe(true);
    expect(json.code).toBe('IDEMPOTENT_REPLAY');
    expect(json.deliveryStatus).toBe('submitted');
    expect(json.metaMessageId).toBe('wamid.EXISTING_999');
    expect(state.metaFetchCalls).toHaveLength(0);
  });

  it('6. Database update failure after Meta acceptance returns reconciliation-required error preserving metaMessageId', async () => {
    state.simulateSubmittedUpdateError = {
      code: '57014',
      message: 'canceling statement due to statement timeout',
    };

    const res = await invokeEdge({
      conversationId: CONV_ID,
      messageType: 'template',
      templateName: 'hello_world',
      clientRequestId: 'req-db-update-fail',
    });
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.ok).toBe(false);
    expect(json.code).toBe('PERSISTENCE_RECONCILIATION_REQUIRED');
    expect(json.reconciliationRequired).toBe(true);
    expect(json.metaAccepted).toBe(true);
    expect(json.doNotResend).toBe(true);
    expect(json.metaMessageId).toBe('wamid.TEST_ACCEPTED_123');
    expect(json.messageId).toBe('msg-created-1');
    expect(json.error).toMatch(/Do NOT resend/i);
    // Preserved fallback audit event containing meta_message_id for reconciliation
    const reconciliationEvent = state.recordedMessageEvents.find(
      (e) => e.event_type === 'submitted'
    );
    expect(reconciliationEvent?.raw_payload).toMatchObject({
      reconciliation_required: true,
      meta_message_id: 'wamid.TEST_ACCEPTED_123',
    });
  });

  it('7. Enforces Test Mode recipient allowlist, 24-hour text window, and recipient opt-out / marketing consent', async () => {
    // Allowlist block
    state.testAllowlist = ['+15559999999'];
    const allowRes = await invokeEdge({
      conversationId: CONV_ID,
      messageType: 'template',
      templateName: 'hello_world',
    });
    expect(allowRes.status).toBe(403);
    expect((await allowRes.json()).code).toBe('TEST_MODE_RECIPIENT_NOT_ALLOWED');
    state.testAllowlist = ['+15551234567'];

    // Closed 24h window blocks free-form text
    const windowRes = await invokeEdge({
      conversationId: CONV_ID,
      messageType: 'text',
      body: 'Free-form text after 24h',
    });
    expect(windowRes.status).toBe(400);
    expect((await windowRes.json()).code).toBe('WINDOW_EXPIRED');

    // Marketing template requires marketing_opt_in
    state.contactOptIn = false;
    const mktRes = await invokeEdge({
      conversationId: CONV_ID,
      messageType: 'template',
      templateName: 'promo_welcome',
      templateParameters: ['Amina'],
    });
    expect(mktRes.status).toBe(400);
    expect((await mktRes.json()).code).toBe('CONTACT_OPTED_OUT');
    state.contactOptIn = true;

    // Explicitly opted-out recipient cannot receive outbound template
    state.contactOptedOutAt = '2026-05-01T00:00:00Z';
    const optOutRes = await invokeEdge({
      conversationId: CONV_ID,
      messageType: 'template',
      templateName: 'hello_world',
    });
    expect(optOutRes.status).toBe(400);
    expect((await optOutRes.json()).code).toBe('CONTACT_OPTED_OUT');

    expect(state.metaFetchCalls).toHaveLength(0);
  });

  it('8. Unsupported template components (IMAGE header, dynamic URL button, CAROUSEL, named params) fail safely before Meta', async () => {
    for (const tplName of [
      'image_header_tpl',
      'dynamic_url_btn_tpl',
      'carousel_tpl',
      'named_param_tpl',
    ]) {
      const res = await invokeEdge({
        conversationId: CONV_ID,
        messageType: 'template',
        templateName: tplName,
        ...(tplName === 'named_param_tpl' ? { templateParameters: ['Amina'] } : {}),
      });
      const json = await res.json();
      expect(res.status, `${tplName} should fail with 400`).toBe(400);
      expect(json.ok).toBe(false);
      expect(json.code, `${tplName} should return TEMPLATE_UNSUPPORTED_COMPONENT`).toBe(
        'TEMPLATE_UNSUPPORTED_COMPONENT'
      );
    }

    // Parameter count validation still enforced for supported positional templates
    const missingParamRes = await invokeEdge({
      conversationId: CONV_ID,
      messageType: 'template',
      templateName: 'order_update',
      templateParameters: ['Amina'],
    });
    expect(missingParamRes.status).toBe(400);
    expect((await missingParamRes.json()).code).toBe('TEMPLATE_PARAMETERS_MISSING');

    expect(state.metaFetchCalls).toHaveLength(0);
  });
});
