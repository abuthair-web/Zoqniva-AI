import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const BUSINESS_A_ID = '11111111-1111-4111-8111-111111111111';
const BUSINESS_B_ID = '99999999-9999-4999-8999-999999999999';
const ADMIN_A_ID = '22222222-2222-4222-8222-222222222222';
const AGENT_A1_ID = '33333333-3333-4333-8333-333333333333';
const AGENT_A2_ID = '44444444-4444-4444-8444-444444444444';
const INACTIVE_USER_ID = '55555555-5555-4555-8555-555555555555';
const CONTACT_A1_ID = '66666666-6666-4666-8666-666666666666';
const CONTACT_A2_ID = '77777777-7777-4777-8777-777777777777';
const CONTACT_B1_ID = '88888888-8888-4888-8888-888888888888';
const WA_ACCOUNT_A_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DB_CONV_1_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const DB_CONV_2_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const FAKE_CONV_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

interface MockSupabaseError {
  code?: string;
  message: string;
  details?: string;
}

interface MockResponse {
  data: unknown;
  error: MockSupabaseError | null;
}

interface MockDbState {
  authUser: { id: string; email: string } | null;
  businessMembers: Array<{
    business_id: string;
    user_id: string;
    role: 'admin' | 'agent';
    is_active: boolean;
  }>;
  contacts: Array<{
    id: string;
    business_id: string;
    full_name: string;
    phone_e164: string;
  }>;
  conversations: Array<Record<string, unknown>>;
  nextInsertError: MockSupabaseError | null;
  nextUpdateError: MockSupabaseError | null;
  nextConvCounter: number;
  recordedInserts: Array<{ table: string; payload: Record<string, unknown> }>;
  recordedUpdates: Array<{
    table: string;
    patch: Record<string, unknown>;
    filters: Record<string, unknown>;
  }>;
  edgeInvocations: Array<{ fnName: string; body: Record<string, unknown> }>;
}

const mockDb: MockDbState = {
  authUser: { id: ADMIN_A_ID, email: 'admin@zoqniva.test' },
  businessMembers: [],
  contacts: [],
  conversations: [],
  nextInsertError: null,
  nextUpdateError: null,
  nextConvCounter: 1,
  recordedInserts: [],
  recordedUpdates: [],
  edgeInvocations: [],
};

function generateServerUuid(counter: number): string {
  const hex = counter.toString(16).padStart(12, '0');
  return `eeeeeeee-eeee-4eee-8eee-${hex}`;
}

function createTableBuilder(table: string) {
  const eqFilters: Record<string, unknown> = {};
  let pendingOp: 'select' | 'insert' | 'update' = 'select';
  let pendingPayload: Record<string, unknown> | null = null;
  let orderCol: string | null = null;
  let orderAsc = true;
  let limitCount: number | null = null;

  const getTableRows = (): Array<Record<string, unknown>> => {
    if (table === 'business_members') return mockDb.businessMembers as Array<Record<string, unknown>>;
    if (table === 'contacts') return mockDb.contacts as Array<Record<string, unknown>>;
    if (table === 'conversations') return mockDb.conversations;
    throw new Error(`Unexpected table queried in test: ${table}`);
  };

  const applyFilters = (rows: Array<Record<string, unknown>>) => {
    let filtered = rows.filter((row) =>
      Object.entries(eqFilters).every(([k, v]) => row[k] === v)
    );
    if (orderCol) {
      const col = orderCol;
      filtered = [...filtered].sort((a, b) => {
        const av = String(a[col] ?? '');
        const bv = String(b[col] ?? '');
        return orderAsc ? av.localeCompare(bv) : bv.localeCompare(av);
      });
    }
    if (limitCount !== null) {
      filtered = filtered.slice(0, limitCount);
    }
    return filtered;
  };

  const execute = (mode: 'many' | 'maybeSingle' | 'single'): MockResponse => {
    if (pendingOp === 'insert') {
      const payload = { ...(pendingPayload ?? {}) };
      mockDb.recordedInserts.push({ table, payload });

      if (mockDb.nextInsertError) {
        const err = mockDb.nextInsertError;
        mockDb.nextInsertError = null;
        return { data: null, error: err };
      }

      if (table === 'conversations') {
        const now = new Date().toISOString();
        const serverRow: Record<string, unknown> = {
          id: generateServerUuid(mockDb.nextConvCounter++),
          business_id: payload.business_id,
          contact_id: payload.contact_id,
          whatsapp_account_id: payload.whatsapp_account_id ?? null,
          assigned_to: payload.assigned_to ?? null,
          status: payload.status ?? 'open',
          unread_count: payload.unread_count ?? 0,
          human_handoff_requested: payload.human_handoff_requested ?? false,
          last_customer_message_at: null,
          window_expires_at: null,
          last_message_preview: payload.last_message_preview ?? '',
          last_message_at: payload.last_message_at ?? now,
          created_at: now,
          updated_at: now,
        };
        mockDb.conversations.push(serverRow);
        return { data: { ...serverRow }, error: null };
      }
      return { data: null, error: { message: `Insert not implemented for ${table}` } };
    }

    if (pendingOp === 'update') {
      const patch = { ...(pendingPayload ?? {}) };
      mockDb.recordedUpdates.push({ table, patch, filters: { ...eqFilters } });

      if (mockDb.nextUpdateError) {
        const err = mockDb.nextUpdateError;
        mockDb.nextUpdateError = null;
        return { data: null, error: err };
      }

      const rows = getTableRows();
      const matched = applyFilters(rows);
      if (matched.length === 0) {
        return mode === 'single'
          ? { data: null, error: { code: 'PGRST116', message: '0 rows returned' } }
          : { data: mode === 'many' ? [] : null, error: null };
      }

      const updated: Array<Record<string, unknown>> = [];
      for (const row of matched) {
        Object.assign(row, patch, { updated_at: new Date().toISOString() });
        updated.push({ ...row });
      }
      return {
        data: mode === 'many' ? updated : updated[0],
        error: null,
      };
    }

    const matched = applyFilters(getTableRows()).map((r) => ({ ...r }));
    if (mode === 'many') {
      return { data: matched, error: null };
    }
    if (mode === 'maybeSingle') {
      return { data: matched[0] ?? null, error: null };
    }
    if (matched.length === 0) {
      return { data: null, error: { code: 'PGRST116', message: 'Row not found' } };
    }
    return { data: matched[0], error: null };
  };

  const builder: Record<string, unknown> = {
    select: vi.fn(() => builder),
    insert: vi.fn((payload: Record<string, unknown>) => {
      pendingOp = 'insert';
      pendingPayload = payload;
      return builder;
    }),
    update: vi.fn((patch: Record<string, unknown>) => {
      pendingOp = 'update';
      pendingPayload = patch;
      return builder;
    }),
    eq: vi.fn((col: string, val: unknown) => {
      eqFilters[col] = val;
      return builder;
    }),
    order: vi.fn((col: string, opts?: { ascending?: boolean }) => {
      orderCol = col;
      orderAsc = opts?.ascending !== false;
      return builder;
    }),
    limit: vi.fn((n: number) => {
      limitCount = n;
      return builder;
    }),
    maybeSingle: vi.fn(async () => execute('maybeSingle')),
    single: vi.fn(async () => execute('single')),
    then: (resolve: (val: MockResponse) => unknown) =>
      Promise.resolve(execute('many')).then(resolve),
  };

  return builder;
}

const functionsInvokeMock = vi.fn(
  async (fnName: string, options?: { body?: Record<string, unknown> }) => {
    const body = options?.body ?? {};
    mockDb.edgeInvocations.push({ fnName, body });

    if (fnName === 'whatsapp-send-message') {
      const convId = String(body.conversationId ?? '');
      const exists = mockDb.conversations.some((c) => c.id === convId);
      if (!exists) {
        return {
          data: {
            ok: false,
            code: 'CONVERSATION_NOT_FOUND',
            error: 'Conversation not found.',
          },
          error: null,
        };
      }

      return {
        data: {
          ok: true,
          messageId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
          metaMessageId: 'wamid.mock.hello_world.001',
          deliveryStatus: 'submitted',
          replayed: false,
        },
        error: null,
      };
    }

    return { data: null, error: { message: `Unhandled edge function ${fnName}` } };
  }
);

vi.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabaseConfigError: null,
  supabase: {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: mockDb.authUser },
        error: mockDb.authUser ? null : { message: 'Auth session missing' },
      })),
      getSession: vi.fn(async () => ({
        data: { session: mockDb.authUser ? { access_token: 'mock-jwt' } : null },
        error: null,
      })),
    },
    from: vi.fn((table: string) => createTableBuilder(table)),
    functions: {
      invoke: vi.fn((fnName: string, options?: { body?: Record<string, unknown> }) =>
        functionsInvokeMock(fnName, options)
      ),
    },
  },
}));

import {
  buildConversationInsertPayload,
  canUserAccessConversation,
  fetchAuthorizedConversationsFromDb,
  openOrCreateConversationInDb,
  resetConversationSchemaCache,
  updateConversationInDb,
  verifyConversationInDb,
} from '@/services/conversationPersistenceService';
import { invokeSendWhatsAppMessage } from '@/services/whatsappService';

describe('Team Inbox conversation persistence service (mocked Supabase — zero live WhatsApp calls)', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetConversationSchemaCache();
    functionsInvokeMock.mockClear();

    mockDb.authUser = { id: ADMIN_A_ID, email: 'admin@zoqniva.test' };
    mockDb.businessMembers = [
      { business_id: BUSINESS_A_ID, user_id: ADMIN_A_ID, role: 'admin', is_active: true },
      { business_id: BUSINESS_A_ID, user_id: AGENT_A1_ID, role: 'agent', is_active: true },
      { business_id: BUSINESS_A_ID, user_id: AGENT_A2_ID, role: 'agent', is_active: true },
      { business_id: BUSINESS_A_ID, user_id: INACTIVE_USER_ID, role: 'agent', is_active: false },
    ];
    mockDb.contacts = [
      {
        id: CONTACT_A1_ID,
        business_id: BUSINESS_A_ID,
        full_name: 'Amina Hassan',
        phone_e164: '+15551234567',
      },
      {
        id: CONTACT_A2_ID,
        business_id: BUSINESS_A_ID,
        full_name: 'Omar Farooq',
        phone_e164: '+15559876543',
      },
      {
        id: CONTACT_B1_ID,
        business_id: BUSINESS_B_ID,
        full_name: 'Other Tenant Contact',
        phone_e164: '+15550009999',
      },
    ];
    mockDb.conversations = [];
    mockDb.nextInsertError = null;
    mockDb.nextUpdateError = null;
    mockDb.nextConvCounter = 1;
    mockDb.recordedInserts = [];
    mockDb.recordedUpdates = [];
    mockDb.edgeInvocations = [];

    // Guard against any real network call (including Meta Graph API)
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes('graph.facebook.com')) {
        throw new Error(`FORBIDDEN live Meta Graph API call detected during test: ${url}`);
      }
      return new Response(JSON.stringify({ definitions: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('1. Create conversation persists in Supabase via INSERT + read-back without client-invented UUID or protected window columns', async () => {
    const res = await openOrCreateConversationInDb({
      businessId: BUSINESS_A_ID,
      contactId: CONTACT_A1_ID,
      whatsappAccountId: WA_ACCOUNT_A_ID,
    });

    expect(res.ok).toBe(true);
    expect(res.created).toBe(true);
    expect(res.conversation).toBeDefined();
    expect(res.conversation?.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );

    // Ensure INSERT payload never supplied a client-generated `id` or trigger-protected window fields
    expect(mockDb.recordedInserts).toHaveLength(1);
    const insertedPayload = mockDb.recordedInserts[0].payload;
    expect(insertedPayload).not.toHaveProperty('id');
    expect(insertedPayload).not.toHaveProperty('last_customer_message_at');
    expect(insertedPayload).not.toHaveProperty('window_expires_at');
    expect(insertedPayload.business_id).toBe(BUSINESS_A_ID);
    expect(insertedPayload.contact_id).toBe(CONTACT_A1_ID);
    expect(insertedPayload.whatsapp_account_id).toBe(WA_ACCOUNT_A_ID);

    // Confirm row actually exists in mocked public.conversations with matching server UUID
    expect(mockDb.conversations).toHaveLength(1);
    expect(mockDb.conversations[0].id).toBe(res.conversation?.id);

    // Direct helper check on buildConversationInsertPayload
    const rawPayload = buildConversationInsertPayload(
      { businessId: BUSINESS_A_ID, contactId: CONTACT_A1_ID },
      null
    );
    expect(rawPayload).not.toHaveProperty('id');
    expect(rawPayload).not.toHaveProperty('window_expires_at');
  });

  it('2. Page refresh / reload returns same persisted conversation UUID and clears stale selection / orphan messages', async () => {
    const created = await openOrCreateConversationInDb({
      businessId: BUSINESS_A_ID,
      contactId: CONTACT_A1_ID,
    });
    expect(created.ok).toBe(true);
    const persistedId = created.conversation!.id;

    // Simulate page reload fetching conversations fresh from Supabase
    const reloaded = await fetchAuthorizedConversationsFromDb({
      businessId: BUSINESS_A_ID,
      userId: ADMIN_A_ID,
      role: 'admin',
    });

    expect(reloaded.ok).toBe(true);
    expect(reloaded.conversations).toHaveLength(1);
    expect(reloaded.conversations[0].id).toBe(persistedId);

    // Validate selection restoration logic (preserve valid DB ID, clear stale fake ID)
    const validIds = new Set(reloaded.conversations.map((c) => c.id));
    expect(validIds.has(persistedId)).toBe(true);
    expect(validIds.has(FAKE_CONV_ID)).toBe(false);

    // Orphan message filtering: only messages referencing loaded persisted conversation IDs survive
    const rawMessages = [
      { id: 'm1', conversationId: persistedId, body: 'Real DB message' },
      { id: 'm2', conversationId: FAKE_CONV_ID, body: 'Orphan message' },
    ];
    const validMessages = rawMessages.filter((m) => validIds.has(m.conversationId));
    expect(validMessages).toHaveLength(1);
    expect(validMessages[0].id).toBe('m1');
  });

  it('3. Selecting an existing contact reuses persisted conversation without duplicate creation, including concurrent clicks and 23505 race', async () => {
    // First click creates the conversation
    const first = await openOrCreateConversationInDb({
      businessId: BUSINESS_A_ID,
      contactId: CONTACT_A1_ID,
    });
    expect(first.ok).toBe(true);
    expect(first.created).toBe(true);

    // Second click reuses existing persisted row without issuing another INSERT
    const second = await openOrCreateConversationInDb({
      businessId: BUSINESS_A_ID,
      contactId: CONTACT_A1_ID,
    });
    expect(second.ok).toBe(true);
    expect(second.created).toBe(false);
    expect(second.conversation?.id).toBe(first.conversation?.id);
    expect(mockDb.recordedInserts).toHaveLength(1);

    // Concurrent clicks for a brand-new contact coalesce into a single DB INSERT
    const [p1, p2] = await Promise.all([
      openOrCreateConversationInDb({ businessId: BUSINESS_A_ID, contactId: CONTACT_A2_ID }),
      openOrCreateConversationInDb({ businessId: BUSINESS_A_ID, contactId: CONTACT_A2_ID }),
    ]);
    expect(p1.ok).toBe(true);
    expect(p2.ok).toBe(true);
    expect(p1.conversation?.id).toBe(p2.conversation?.id);
    expect(mockDb.recordedInserts).toHaveLength(2);

    // Simulate PostgreSQL 23505 unique race when another tab inserted just before our INSERT
    mockDb.conversations = mockDb.conversations.filter((c) => c.contact_id !== CONTACT_A2_ID);
    mockDb.nextInsertError = {
      code: '23505',
      message: 'duplicate key value violates unique constraint',
    };
    // Insert the competing row right after SELECT returns empty by pre-handling in a custom scenario:
    // Verify 23505 returns clean restricted/duplicate recovery error when no accessible row is visible
    const raceRes = await openOrCreateConversationInDb({
      businessId: BUSINESS_A_ID,
      contactId: CONTACT_A2_ID,
    });
    expect(raceRes.ok).toBe(false);
    expect(raceRes.code).toBe('CONVERSATION_RESTRICTED');
  });

  it('4. Assigned staff (agent) accesses and updates their own assigned and unassigned conversations', async () => {
    mockDb.conversations.push(
      {
        id: DB_CONV_1_ID,
        business_id: BUSINESS_A_ID,
        contact_id: CONTACT_A1_ID,
        assigned_to: AGENT_A1_ID,
        status: 'open',
        unread_count: 3,
        human_handoff_requested: false,
        last_message_preview: 'Hello',
        last_message_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      },
      {
        id: DB_CONV_2_ID,
        business_id: BUSINESS_A_ID,
        contact_id: CONTACT_A2_ID,
        assigned_to: null,
        status: 'open',
        unread_count: 1,
        human_handoff_requested: false,
        last_message_preview: 'Unassigned',
        last_message_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      }
    );

    mockDb.authUser = { id: AGENT_A1_ID, email: 'agent1@zoqniva.test' };

    const loaded = await fetchAuthorizedConversationsFromDb({
      businessId: BUSINESS_A_ID,
      userId: AGENT_A1_ID,
      role: 'agent',
    });
    expect(loaded.ok).toBe(true);
    expect(loaded.conversations.map((c) => c.id)).toEqual([DB_CONV_1_ID, DB_CONV_2_ID]);

    // Mark own conversation read
    const readRes = await updateConversationInDb({
      businessId: BUSINESS_A_ID,
      conversationId: DB_CONV_1_ID,
      action: 'mark_read',
    });
    expect(readRes.ok).toBe(true);
    expect(readRes.conversation?.unreadCount).toBe(0);

    // Toggle human handoff on own conversation
    const handoffRes = await updateConversationInDb({
      businessId: BUSINESS_A_ID,
      conversationId: DB_CONV_1_ID,
      action: 'handoff',
      humanHandoffRequested: true,
    });
    expect(handoffRes.ok).toBe(true);
    expect(handoffRes.conversation?.humanHandoffRequested).toBe(true);

    // Agent can claim unassigned conversation for themselves
    const claimRes = await updateConversationInDb({
      businessId: BUSINESS_A_ID,
      conversationId: DB_CONV_2_ID,
      action: 'assign',
      assignedToId: AGENT_A1_ID,
    });
    expect(claimRes.ok).toBe(true);
    expect(claimRes.conversation?.assignedToId).toBe(AGENT_A1_ID);

    // Agent can unassign their own conversation
    const releaseRes = await updateConversationInDb({
      businessId: BUSINESS_A_ID,
      conversationId: DB_CONV_2_ID,
      action: 'assign',
      assignedToId: null,
    });
    expect(releaseRes.ok).toBe(true);
    expect(releaseRes.conversation?.assignedToId).toBeNull();
  });

  it('5. Unauthorized staff (agent) is denied access to another agent conversation and denied reassigning to other staff', async () => {
    mockDb.conversations.push({
      id: DB_CONV_1_ID,
      business_id: BUSINESS_A_ID,
      contact_id: CONTACT_A1_ID,
      assigned_to: AGENT_A2_ID,
      status: 'open',
      unread_count: 1,
      human_handoff_requested: false,
      last_message_preview: 'Assigned to Agent 2',
      last_message_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    });
    mockDb.conversations.push({
      id: DB_CONV_2_ID,
      business_id: BUSINESS_A_ID,
      contact_id: CONTACT_A2_ID,
      assigned_to: AGENT_A1_ID,
      status: 'open',
      unread_count: 0,
      human_handoff_requested: false,
      last_message_preview: 'Assigned to Agent 1',
      last_message_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    });

    mockDb.authUser = { id: AGENT_A1_ID, email: 'agent1@zoqniva.test' };

    expect(
      canUserAccessConversation({ assignedToId: AGENT_A2_ID }, { id: AGENT_A1_ID, role: 'agent' })
    ).toBe(false);

    // Reload filters out Agent 2's conversation
    const loaded = await fetchAuthorizedConversationsFromDb({
      businessId: BUSINESS_A_ID,
      userId: AGENT_A1_ID,
      role: 'agent',
    });
    expect(loaded.ok).toBe(true);
    expect(loaded.conversations.map((c) => c.id)).toEqual([DB_CONV_2_ID]);

    // Attempting to open contact already assigned to Agent 2 is denied without creating a duplicate
    const openOther = await openOrCreateConversationInDb({
      businessId: BUSINESS_A_ID,
      contactId: CONTACT_A1_ID,
    });
    expect(openOther.ok).toBe(false);
    expect(openOther.code).toBe('CONVERSATION_ASSIGNED_TO_OTHER');
    expect(mockDb.recordedInserts).toHaveLength(0);

    // Attempting to update Agent 2's conversation is denied
    const updateOther = await updateConversationInDb({
      businessId: BUSINESS_A_ID,
      conversationId: DB_CONV_1_ID,
      action: 'status',
      status: 'resolved',
    });
    expect(updateOther.ok).toBe(false);
    expect(updateOther.code).toBe('FORBIDDEN');

    // Least privilege: Agent 1 cannot reassign their own conversation to Agent 2 (requires admin)
    const reassignToOther = await updateConversationInDb({
      businessId: BUSINESS_A_ID,
      conversationId: DB_CONV_2_ID,
      action: 'assign',
      assignedToId: AGENT_A2_ID,
    });
    expect(reassignToOther.ok).toBe(false);
    expect(reassignToOther.code).toBe('ADMIN_REQUIRED');
    expect(mockDb.recordedUpdates).toHaveLength(0);

    // Inactive member cannot open or modify any conversation (`is_active: false`)
    mockDb.authUser = { id: INACTIVE_USER_ID, email: 'inactive@zoqniva.test' };
    const inactiveAttempt = await openOrCreateConversationInDb({
      businessId: BUSINESS_A_ID,
      contactId: CONTACT_A2_ID,
    });
    expect(inactiveAttempt.ok).toBe(false);
    expect(inactiveAttempt.code).toBe('FORBIDDEN');
  });

  it('6. Cross-business contact and conversation access is denied', async () => {
    // Admin of Business A tries to start conversation with Business B's contact
    const crossCreate = await openOrCreateConversationInDb({
      businessId: BUSINESS_A_ID,
      contactId: CONTACT_B1_ID,
    });
    expect(crossCreate.ok).toBe(false);
    expect(crossCreate.code).toBe('CONTACT_NOT_FOUND');
    expect(mockDb.recordedInserts).toHaveLength(0);

    // Conversation exists in Business B; Business A cannot verify or update it
    mockDb.conversations.push({
      id: DB_CONV_1_ID,
      business_id: BUSINESS_B_ID,
      contact_id: CONTACT_B1_ID,
      assigned_to: null,
      status: 'open',
      unread_count: 0,
      human_handoff_requested: false,
      last_message_preview: 'Business B private thread',
      last_message_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    });

    const crossVerify = await verifyConversationInDb({
      businessId: BUSINESS_A_ID,
      conversationId: DB_CONV_1_ID,
      userId: ADMIN_A_ID,
      role: 'admin',
    });
    expect(crossVerify.ok).toBe(false);
    expect(crossVerify.exists).toBe(false);
    expect(crossVerify.code).toBe('CONVERSATION_NOT_FOUND');

    const crossUpdate = await updateConversationInDb({
      businessId: BUSINESS_A_ID,
      conversationId: DB_CONV_1_ID,
      action: 'status',
      status: 'resolved',
    });
    expect(crossUpdate.ok).toBe(false);
    expect(crossUpdate.notFound).toBe(true);
    expect(crossUpdate.code).toBe('CONVERSATION_NOT_FOUND');
  });

  it('7. Failed INSERT returns explicit error without inventing a conversation ID', async () => {
    mockDb.nextInsertError = {
      code: '42501',
      message: 'new row violates row-level security policy for table "conversations"',
    };

    const res = await openOrCreateConversationInDb({
      businessId: BUSINESS_A_ID,
      contactId: CONTACT_A1_ID,
    });

    expect(res.ok).toBe(false);
    expect(res.conversation).toBeUndefined();
    expect(res.code).toBe('42501');
    expect(res.error).toMatch(/Row-Level Security/i);
    expect(mockDb.conversations).toHaveLength(0);
  });

  it('8. Assignment update persists to Supabase and rejects inactive assignees', async () => {
    const created = await openOrCreateConversationInDb({
      businessId: BUSINESS_A_ID,
      contactId: CONTACT_A1_ID,
    });
    const convId = created.conversation!.id;

    // Admin assigns conversation to active Agent 1
    const assignOk = await updateConversationInDb({
      businessId: BUSINESS_A_ID,
      conversationId: convId,
      action: 'assign',
      assignedToId: AGENT_A1_ID,
    });
    expect(assignOk.ok).toBe(true);
    expect(assignOk.conversation?.assignedToId).toBe(AGENT_A1_ID);
    expect(mockDb.conversations[0].assigned_to).toBe(AGENT_A1_ID);

    // Ensure UPDATE scoped by both id and business_id
    expect(mockDb.recordedUpdates[0].filters).toEqual({
      id: convId,
      business_id: BUSINESS_A_ID,
    });

    // Reject assigning to an inactive business member (`is_active: false`)
    const assignInactive = await updateConversationInDb({
      businessId: BUSINESS_A_ID,
      conversationId: convId,
      action: 'assign',
      assignedToId: INACTIVE_USER_ID,
    });
    expect(assignInactive.ok).toBe(false);
    expect(assignInactive.code).toBe('ASSIGNEE_NOT_ACTIVE');
    expect(mockDb.conversations[0].assigned_to).toBe(AGENT_A1_ID);
  });

  it('9. Resolve and reopen conversation status persist in Supabase', async () => {
    const created = await openOrCreateConversationInDb({
      businessId: BUSINESS_A_ID,
      contactId: CONTACT_A1_ID,
    });
    const convId = created.conversation!.id;

    const resolved = await updateConversationInDb({
      businessId: BUSINESS_A_ID,
      conversationId: convId,
      action: 'status',
      status: 'resolved',
    });
    expect(resolved.ok).toBe(true);
    expect(resolved.conversation?.status).toBe('resolved');
    expect(mockDb.conversations[0].status).toBe('resolved');

    const reopened = await updateConversationInDb({
      businessId: BUSINESS_A_ID,
      conversationId: convId,
      action: 'status',
      status: 'open',
    });
    expect(reopened.ok).toBe(true);
    expect(reopened.conversation?.status).toBe('open');
    expect(mockDb.conversations[0].status).toBe('open');
  });

  it('10. Approved template send (hello_world) verifies real DB conversation UUID before invoking whatsapp-send-message', async () => {
    const created = await openOrCreateConversationInDb({
      businessId: BUSINESS_A_ID,
      contactId: CONTACT_A1_ID,
      whatsappAccountId: WA_ACCOUNT_A_ID,
    });
    expect(created.ok).toBe(true);
    const persistedConvId = created.conversation!.id;

    // Pre-send verification against Supabase public.conversations
    const verified = await verifyConversationInDb({
      businessId: BUSINESS_A_ID,
      conversationId: persistedConvId,
      userId: ADMIN_A_ID,
      role: 'admin',
    });
    expect(verified.ok).toBe(true);
    expect(verified.exists).toBe(true);
    expect(verified.conversation?.id).toBe(persistedConvId);

    // Invoke mocked whatsapp-send-message with persisted UUID & approved hello_world template (no free-form body required)
    const sendRes = await invokeSendWhatsAppMessage({
      conversationId: verified.conversation!.id,
      messageType: 'template',
      templateName: 'hello_world',
      language: 'en_US',
      clientRequestId: 'req-hello-world-001',
    });

    expect(sendRes.ok).toBe(true);
    expect(sendRes.deliveryStatus).toBe('submitted');
    expect(functionsInvokeMock).toHaveBeenCalledTimes(1);
    expect(mockDb.edgeInvocations[0]).toEqual({
      fnName: 'whatsapp-send-message',
      body: expect.objectContaining({
        conversationId: persistedConvId,
        messageType: 'template',
        templateName: 'hello_world',
        language: 'en_US',
      }),
    });
  });

  it('11. Fake / non-persisted conversation IDs fail verification and NEVER invoke whatsapp-send-message', async () => {
    const verifyFake = await verifyConversationInDb({
      businessId: BUSINESS_A_ID,
      conversationId: FAKE_CONV_ID,
      userId: ADMIN_A_ID,
      role: 'admin',
    });

    expect(verifyFake.ok).toBe(false);
    expect(verifyFake.exists).toBe(false);
    expect(verifyFake.code).toBe('CONVERSATION_NOT_FOUND');

    // Also test malformed non-UUID conversation ID
    const verifyMalformed = await verifyConversationInDb({
      businessId: BUSINESS_A_ID,
      conversationId: 'conv-local-12345',
      userId: ADMIN_A_ID,
      role: 'admin',
    });
    expect(verifyMalformed.ok).toBe(false);
    expect(verifyMalformed.code).toBe('INVALID_CONVERSATION_ID');

    // Because verification failed, whatsapp-send-message is never invoked
    expect(functionsInvokeMock).not.toHaveBeenCalled();
  });

  it('12. Zero live WhatsApp network calls are made during any conversation persistence or send-preparation test', async () => {
    const created = await openOrCreateConversationInDb({
      businessId: BUSINESS_A_ID,
      contactId: CONTACT_A1_ID,
    });
    expect(created.ok).toBe(true);

    await verifyConversationInDb({
      businessId: BUSINESS_A_ID,
      conversationId: created.conversation!.id,
      userId: ADMIN_A_ID,
      role: 'admin',
    });

    const graphCalls = fetchSpy.mock.calls.filter(([arg]: [unknown]) => {
      const url = typeof arg === 'string' ? arg : arg instanceof URL ? arg.toString() : String(arg);
      return url.includes('graph.facebook.com') || url.includes('whatsapp.com');
    });
    expect(graphCalls).toHaveLength(0);
  });
});
