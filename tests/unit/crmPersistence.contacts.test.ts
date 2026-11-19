import { beforeEach, describe, expect, it, vi } from 'vitest';

const BUSINESS_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const TAG_ID = '33333333-3333-4333-8333-333333333333';
const CONTACT_ID = '44444444-4444-4444-8444-444444444444';

interface MockResponse {
  data: unknown;
  error: { code?: string; message: string; details?: string } | null;
}

const mockState = {
  authUser: { id: USER_ID, email: 'admin@test.local' } as { id: string; email: string } | null,
  fromHandler: null as null | ((table: string) => unknown),
  recordedCalls: [] as Array<{ table: string; op: string; payload?: unknown }>,
};

vi.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabaseConfigError: null,
  supabase: {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: mockState.authUser },
        error: mockState.authUser ? null : { message: 'Auth session missing' },
      })),
      getSession: vi.fn(async () => ({
        data: { session: mockState.authUser ? { access_token: 'mock-jwt' } : null },
        error: null,
      })),
    },
    from: vi.fn((table: string) => {
      if (!mockState.fromHandler) {
        throw new Error(`Unexpected supabase.from('${table}') without mock handler`);
      }
      return mockState.fromHandler(table);
    }),
  },
}));

import {
  buildContactInsertPayload,
  buildContactUpdatePayload,
  createContactInDb,
  createTagInDb,
  deleteContactInDb,
  formatPersistenceError,
  importContactsBatchInDb,
  mapDbContactRow,
  parsePgrst204MissingColumn,
  resetSchemaDiscoveryCache,
  seedTableColumnsFromRows,
  updateContactInDb,
  validateContactInput,
} from '@/services/crmPersistenceService';

function createChain(response: MockResponse) {
  const chain: Record<string, unknown> = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    in: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    maybeSingle: vi.fn(async () => response),
    single: vi.fn(async () => response),
    then: (resolve: (val: MockResponse) => unknown) => Promise.resolve(response).then(resolve),
  };
  return chain;
}

describe('Contacts & Tags persistence service (mocked Supabase client)', () => {
  beforeEach(() => {
    resetSchemaDiscoveryCache();
    mockState.authUser = { id: USER_ID, email: 'admin@test.local' };
    mockState.recordedCalls = [];
    mockState.fromHandler = null;
  });

  it('validates contact name, E.164 phone, email, and workspace UUID', () => {
    expect(validateContactInput({ fullName: '', phone: '+15551234567' }).ok).toBe(false);
    expect(validateContactInput({ fullName: 'Amina', phone: '1234' }).ok).toBe(false);
    expect(
      validateContactInput({ fullName: 'Amina', phone: '+15551234567', email: 'invalid-email' }).ok
    ).toBe(false);
    expect(
      validateContactInput({
        businessId: 'not-a-uuid',
        fullName: 'Amina',
        phone: '+15551234567',
        requireBusinessId: true,
      }).ok
    ).toBe(false);

    const valid = validateContactInput({
      businessId: BUSINESS_ID,
      fullName: '  Amina Hassan  ',
      phone: '+1 (555) 123-4567',
      email: 'amina@example.com',
      requireBusinessId: true,
    });
    expect(valid).toEqual({
      ok: true,
      cleanName: 'Amina Hassan',
      normalizedPhone: '+15551234567',
      cleanEmail: 'amina@example.com',
    });
  });

  it('never inserts city unless explicitly confirmed in live public.contacts schema', () => {
    const liveColsWithoutCity = new Set([
      'id',
      'business_id',
      'full_name',
      'phone_e164',
      'email',
      'notes',
      'opt_in_status',
      'marketing_opt_in',
      'created_at',
    ]);

    const payload = buildContactInsertPayload(
      {
        businessId: BUSINESS_ID,
        fullName: 'Amina Hassan',
        phoneE164: '+15551234567',
        email: 'amina@example.com',
        city: 'Dubai',
        country: 'UAE',
        marketingOptIn: true,
        notes: 'VIP',
      },
      liveColsWithoutCity
    );

    expect(payload).not.toHaveProperty('city');
    expect(payload).not.toHaveProperty('country');
    expect(payload).toMatchObject({
      business_id: BUSINESS_ID,
      full_name: 'Amina Hassan',
      phone_e164: '+15551234567',
      email: 'amina@example.com',
      marketing_opt_in: true,
      opt_in_status: 'opted_in',
      notes: 'VIP',
    });
  });

  it('maps opt_in_status fallback cleanly when marketing_opt_in is absent', () => {
    const mapped = mapDbContactRow({
      id: CONTACT_ID,
      full_name: 'Test Lead',
      phone_e164: '+15550001111',
      opt_in_status: 'opted_in',
      created_at: '2026-05-01T00:00:00Z',
    });
    expect(mapped.marketingOptIn).toBe(true);

    const optedOut = mapDbContactRow({
      id: CONTACT_ID,
      full_name: 'Test Lead',
      phone_e164: '+15550001111',
      opt_in_status: 'opted_out',
    });
    expect(optedOut.marketingOptIn).toBe(false);
  });

  it('parses PGRST204 errors and strips unknown optional column on retry without sending city', async () => {
    expect(
      parsePgrst204MissingColumn({
        code: 'PGRST204',
        message: "Could not find the 'city' column of 'contacts' in the schema cache",
      })
    ).toBe('city');

    let contactInsertAttempts = 0;
    let contactsSelectCount = 0;

    mockState.fromHandler = (table: string) => {
      if (table === 'contacts') {
        return {
          select: vi.fn(() => {
            contactsSelectCount += 1;
            if (contactsSelectCount === 1) {
              // Duplicate check -> no existing match
              return createChain({ data: null, error: null });
            }
            // Read-back verification after INSERT
            return createChain({
              data: {
                id: CONTACT_ID,
                business_id: BUSINESS_ID,
                full_name: 'Amina Hassan',
                phone_e164: '+15551234567',
                email: 'amina@example.com',
                marketing_opt_in: true,
                created_at: '2026-05-01T12:00:00Z',
              },
              error: null,
            });
          }),
          insert: vi.fn((payload: Record<string, unknown>) => {
            contactInsertAttempts += 1;
            mockState.recordedCalls.push({ table, op: 'insert', payload: { ...payload } });
            if ('company' in payload) {
              return createChain({
                data: null,
                error: {
                  code: 'PGRST204',
                  message: "Could not find the 'company' column of 'contacts' in the schema cache",
                },
              });
            }
            return createChain({
              data: {
                id: CONTACT_ID,
                business_id: BUSINESS_ID,
                full_name: payload.full_name,
                phone_e164: payload.phone_e164,
                email: payload.email,
                marketing_opt_in: payload.marketing_opt_in,
                created_at: '2026-05-01T12:00:00Z',
              },
              error: null,
            });
          }),
        };
      }
      if (table === 'contact_tags') {
        return {
          insert: vi.fn((payload: unknown) => {
            mockState.recordedCalls.push({ table, op: 'insert', payload });
            return Promise.resolve({ data: payload, error: null });
          }),
        };
      }
      return createChain({ data: null, error: null });
    };

    const result = await createContactInDb({
      businessId: BUSINESS_ID,
      fullName: 'Amina Hassan',
      phone: '+15551234567',
      email: 'amina@example.com',
      company: 'Acme Corp',
      city: 'Dubai',
      marketingOptIn: true,
      tagIds: [TAG_ID],
    });

    expect(result.ok).toBe(true);
    expect(result.contact?.id).toBe(CONTACT_ID);
    expect(result.contact?.tagIds).toEqual([TAG_ID]);
    expect(contactInsertAttempts).toBe(2);

    // First payload must NEVER contain `city`
    const firstInsert = mockState.recordedCalls[0].payload as Record<string, unknown>;
    expect(firstInsert).not.toHaveProperty('city');
    // Second retry payload stripped `company` after PGRST204
    const secondInsert = mockState.recordedCalls[1].payload as Record<string, unknown>;
    expect(secondInsert).not.toHaveProperty('company');
  });

  it('rejects duplicate phone numbers cleanly and reports RLS 42501 denials honestly', async () => {
    mockState.fromHandler = () => ({
      select: vi.fn(() => createChain({ data: { id: CONTACT_ID }, error: null })),
    });

    const dupRes = await createContactInDb({
      businessId: BUSINESS_ID,
      fullName: 'Duplicate Contact',
      phone: '+15551234567',
      marketingOptIn: true,
    });
    expect(dupRes.ok).toBe(false);
    expect(dupRes.error).toContain('already exists');

    expect(
      formatPersistenceError('contact', { code: '42501', message: 'new row violates row-level security policy' })
    ).toContain('Row-Level Security');
  });

  it('updates contact fields, consent, and tags and rejects silent 0-row RLS deletes', async () => {
    seedTableColumnsFromRows('contacts', [
      {
        id: CONTACT_ID,
        business_id: BUSINESS_ID,
        full_name: 'Amina',
        phone_e164: '+15551234567',
        marketing_opt_in: true,
        opt_in_status: 'opted_in',
        opted_out_at: null,
      },
    ]);

    const patch = buildContactUpdatePayload(
      { fullName: 'Amina Updated', marketingOptIn: false, optedOutAt: '2026-05-02T00:00:00Z', city: 'Ignored' },
      new Set(['id', 'business_id', 'full_name', 'phone_e164', 'marketing_opt_in', 'opt_in_status', 'opted_out_at'])
    );
    expect(patch).not.toHaveProperty('city');
    expect(patch).toMatchObject({
      full_name: 'Amina Updated',
      marketing_opt_in: false,
      opt_in_status: 'opted_out',
    });

    mockState.fromHandler = (table: string) => {
      if (table === 'contacts') {
        return {
          update: vi.fn(() =>
            createChain({
              data: {
                id: CONTACT_ID,
                business_id: BUSINESS_ID,
                full_name: 'Amina Updated',
                phone_e164: '+15551234567',
                marketing_opt_in: false,
              },
              error: null,
            })
          ),
          delete: vi.fn(() => createChain({ data: [], error: null })),
        };
      }
      if (table === 'contact_tags') {
        return {
          delete: vi.fn(() => createChain({ data: null, error: null })),
          insert: vi.fn(() => Promise.resolve({ data: null, error: null })),
        };
      }
      return createChain({ data: null, error: null });
    };

    const updRes = await updateContactInDb({
      businessId: BUSINESS_ID,
      contactId: CONTACT_ID,
      updates: { fullName: 'Amina Updated', marketingOptIn: false, tagIds: [TAG_ID] },
      existingTagIds: [],
    });
    expect(updRes.ok).toBe(true);
    expect(updRes.contact?.fullName).toBe('Amina Updated');
    expect(updRes.contact?.marketingOptIn).toBe(false);

    // Delete returning 0 rows (typical silent RLS denial for non-admin agent) must fail honestly
    const delRes = await deleteContactInDb({ businessId: BUSINESS_ID, contactId: CONTACT_ID });
    expect(delRes.ok).toBe(false);
    expect(delRes.error).toContain('Only workspace administrators can delete contacts');
  });

  it('persists tags and batch CSV imports without unsupported city columns', async () => {
    mockState.fromHandler = (table: string) => {
      if (table === 'tags') {
        return {
          insert: vi.fn(() =>
            createChain({ data: { id: TAG_ID, name: 'VIP', color: '#2563EB' }, error: null })
          ),
        };
      }
      if (table === 'contacts') {
        return {
          insert: vi.fn((payloads: Array<Record<string, unknown>>) => {
            mockState.recordedCalls.push({ table, op: 'batch_insert', payload: payloads });
            return createChain({
              data: payloads.map((p, i) => ({
                id: `55555555-5555-4555-8555-55555555555${i}`,
                ...p,
                created_at: '2026-05-01T00:00:00Z',
              })),
              error: null,
            });
          }),
        };
      }
      return createChain({ data: null, error: null });
    };

    const tagRes = await createTagInDb({ businessId: BUSINESS_ID, name: 'VIP', color: '#2563EB' });
    expect(tagRes.ok).toBe(true);
    expect(tagRes.tag?.id).toBe(TAG_ID);

    const importRes = await importContactsBatchInDb({
      businessId: BUSINESS_ID,
      rows: [
        {
          fullName: 'CSV Lead',
          phoneE164: '+15559876543',
          email: 'csv@example.com',
          company: 'Co',
          city: 'Austin',
          country: 'US',
          marketingOptIn: true,
        },
      ],
    });
    expect(importRes.ok).toBe(true);
    expect(importRes.contacts).toHaveLength(1);
    const batchPayload = mockState.recordedCalls[0].payload as Array<Record<string, unknown>>;
    expect(batchPayload[0]).not.toHaveProperty('city');
  });
});
