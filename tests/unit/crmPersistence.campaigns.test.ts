import { beforeEach, describe, expect, it, vi } from 'vitest';

const BUSINESS_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const TEMPLATE_ID = '33333333-3333-4333-8333-333333333333';
const CAMPAIGN_ID = '66666666-6666-4666-8666-666666666666';
const TAG_ID = '77777777-7777-4777-8777-777777777777';

interface MockResponse {
  data: unknown;
  error: { code?: string; message: string; details?: string } | null;
}

const mockFunctionsInvoke = vi.fn();

const mockState = {
  authUser: { id: USER_ID, email: 'admin@test.local' } as { id: string; email: string } | null,
  fromHandler: null as null | ((table: string) => unknown),
  recordedInserts: [] as Array<Record<string, unknown>>,
};

vi.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabaseConfigError: null,
  supabase: {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: mockState.authUser },
        error: mockState.authUser ? null : { message: 'Session missing' },
      })),
      getSession: vi.fn(async () => ({
        data: { session: mockState.authUser ? { access_token: 'mock-jwt' } : null },
        error: null,
      })),
    },
    functions: {
      invoke: (...args: unknown[]) => mockFunctionsInvoke(...args),
    },
    from: vi.fn((table: string) => {
      if (!mockState.fromHandler) {
        throw new Error(`Unexpected supabase.from('${table}')`);
      }
      return mockState.fromHandler(table);
    }),
  },
}));

import {
  buildCampaignInsertPayload,
  createCampaignInDb,
  mapDbCampaignRow,
  resetSchemaDiscoveryCache,
  seedTableColumnsFromRows,
  updateCampaignStatusInDb,
  validateCampaignInput,
} from '@/services/crmPersistenceService';

function createChain(response: MockResponse) {
  const chain: Record<string, unknown> = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    maybeSingle: vi.fn(async () => response),
    single: vi.fn(async () => response),
  };
  return chain;
}

describe('Campaigns draft persistence service (mocked Supabase client)', () => {
  beforeEach(() => {
    resetSchemaDiscoveryCache();
    mockState.authUser = { id: USER_ID, email: 'admin@test.local' };
    mockState.recordedInserts = [];
    mockState.fromHandler = null;
    mockFunctionsInvoke.mockReset();
  });

  it('validates campaign name length, template UUID, workspace UUID, and scheduled timestamp', () => {
    expect(
      validateCampaignInput({
        businessId: BUSINESS_ID,
        name: 'A',
        templateId: TEMPLATE_ID,
        status: 'draft',
        requireBusinessId: true,
      }).ok
    ).toBe(false);

    expect(
      validateCampaignInput({
        businessId: BUSINESS_ID,
        name: 'Spring Promo',
        templateId: 'local-draft-1',
        status: 'draft',
        requireBusinessId: true,
      }).ok
    ).toBe(false);

    expect(
      validateCampaignInput({
        businessId: BUSINESS_ID,
        name: 'Spring Promo',
        templateId: TEMPLATE_ID,
        status: 'scheduled',
        scheduledFor: 'not-a-date',
        requireBusinessId: true,
      }).ok
    ).toBe(false);

    const valid = validateCampaignInput({
      businessId: BUSINESS_ID,
      name: 'Spring Promo',
      templateId: TEMPLATE_ID,
      status: 'draft',
      requireBusinessId: true,
    });
    expect(valid.ok).toBe(true);
    expect(valid.cleanName).toBe('Spring Promo');
  });

  it('adapts to live public.campaigns columns (scheduled_at + audience_filter JSONB)', () => {
    const liveCampaignCols = new Set([
      'id',
      'business_id',
      'name',
      'template_id',
      'audience_filter',
      'status',
      'scheduled_at',
      'created_at',
    ]);

    const payload = buildCampaignInsertPayload(
      {
        businessId: BUSINESS_ID,
        name: 'Ramadan Welcome',
        templateId: TEMPLATE_ID,
        status: 'draft',
        audienceMode: 'groups',
        targetTagIds: [TAG_ID],
        targetContactIds: [],
        variableMapping: { '1': 'full_name' },
        scheduledIso: null,
        selectedCount: 25,
        eligibleCount: 20,
        skippedCount: 5,
      },
      liveCampaignCols
    );

    expect(payload).toMatchObject({
      business_id: BUSINESS_ID,
      name: 'Ramadan Welcome',
      template_id: TEMPLATE_ID,
      status: 'draft',
      scheduled_at: null,
      audience_filter: {
        mode: 'groups',
        tag_ids: [TAG_ID],
        contact_ids: [],
      },
    });
    expect(payload).not.toHaveProperty('scheduled_for');
    expect(payload).not.toHaveProperty('target_tag_ids');

    // Verify mapDbCampaignRow reads back audience_filter + scheduled_at accurately
    const mapped = mapDbCampaignRow({
      id: CAMPAIGN_ID,
      ...payload,
      created_at: '2026-05-01T00:00:00Z',
    });
    expect(mapped.audienceMode).toBe('groups');
    expect(mapped.targetTagIds).toEqual([TAG_ID]);
    expect(mapped.status).toBe('draft');
  });

  it('persists campaign draft via INSERT + read-back verification and NEVER sends WhatsApp messages', async () => {
    seedTableColumnsFromRows('campaigns', [
      {
        id: CAMPAIGN_ID,
        business_id: BUSINESS_ID,
        name: 'Seed',
        template_id: TEMPLATE_ID,
        audience_filter: {},
        status: 'draft',
        scheduled_at: null,
        created_at: '2026-05-01T00:00:00Z',
      },
    ]);

    mockState.fromHandler = (table: string) => {
      if (table === 'campaigns') {
        return {
          insert: vi.fn((payload: Record<string, unknown>) => {
            mockState.recordedInserts.push({ ...payload });
            return createChain({
              data: { id: CAMPAIGN_ID, ...payload, created_at: '2026-05-01T10:00:00Z' },
              error: null,
            });
          }),
          select: vi.fn(() =>
            createChain({
              data: {
                id: CAMPAIGN_ID,
                business_id: BUSINESS_ID,
                name: 'QA Draft Campaign',
                template_id: TEMPLATE_ID,
                audience_filter: { mode: 'groups', tag_ids: [TAG_ID], contact_ids: [] },
                status: 'draft',
                scheduled_at: null,
                created_at: '2026-05-01T10:00:00Z',
              },
              error: null,
            })
          ),
        };
      }
      return createChain({ data: null, error: null });
    };

    const res = await createCampaignInDb({
      businessId: BUSINESS_ID,
      name: 'QA Draft Campaign',
      templateId: TEMPLATE_ID,
      status: 'draft',
      audienceMode: 'groups',
      targetTagIds: [TAG_ID],
      variableMapping: { '1': 'full_name' },
      selectedCount: 12,
      eligibleCount: 10,
      skippedCount: 2,
    });

    expect(res.ok).toBe(true);
    expect(res.campaign?.id).toBe(CAMPAIGN_ID);
    expect(res.campaign?.status).toBe('draft');
    expect(res.campaign?.targetTagIds).toEqual([TAG_ID]);
    // Critical safety invariant: creating a campaign draft must NEVER call any WhatsApp Edge Function
    expect(mockFunctionsInvoke).not.toHaveBeenCalled();
  });

  it('surfaces template FK (23503) and RLS (42501) errors honestly and updates campaign status', async () => {
    mockState.fromHandler = () => ({
      insert: vi.fn(() =>
        createChain({
          data: null,
          error: { code: '23503', message: 'violates foreign key constraint "campaigns_template_id_fkey"' },
        })
      ),
      update: vi.fn(() =>
        createChain({
          data: {
            id: CAMPAIGN_ID,
            business_id: BUSINESS_ID,
            name: 'QA Draft Campaign',
            template_id: TEMPLATE_ID,
            status: 'paused',
          },
          error: null,
        })
      ),
    });

    const fkRes = await createCampaignInDb({
      businessId: BUSINESS_ID,
      name: 'Bad Template Campaign',
      templateId: TEMPLATE_ID,
      status: 'draft',
      targetTagIds: [],
      variableMapping: {},
      selectedCount: 1,
      eligibleCount: 1,
      skippedCount: 0,
    });

    expect(fkRes.ok).toBe(false);
    expect(fkRes.error).toContain('selected WhatsApp template could not be found');

    const statusRes = await updateCampaignStatusInDb({
      businessId: BUSINESS_ID,
      campaignId: CAMPAIGN_ID,
      status: 'paused',
    });
    expect(statusRes.ok).toBe(true);
    expect(statusRes.campaign?.status).toBe('paused');
  });
});
