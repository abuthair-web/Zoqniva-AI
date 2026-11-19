import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const BIZ_A = '11111111-1111-4111-8111-111111111111';
const BIZ_B = '22222222-2222-4222-8222-222222222222';
const ADMIN_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const AGENT_A = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const INACTIVE_ADMIN = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const TPL_APPROVED = '33333333-3333-4333-8333-333333333333';
const TPL_PARAMS = '33333333-3333-4333-8333-333333333334';
const TPL_DRAFT = '33333333-3333-4333-8333-333333333335';
const TPL_BIZ_B = '33333333-3333-4333-8333-333333333336';
const TAG_VIP_A = '44444444-4444-4444-8444-444444444441';
const TAG_BIZ_B = '44444444-4444-4444-8444-444444444442';
const CAMP_A = '55555555-5555-4555-8555-555555555551';
const CAMP_B = '55555555-5555-4555-8555-555555555552';

const CONTACT_1 = '66666666-6666-4666-8666-666666666601';
const CONTACT_2 = '66666666-6666-4666-8666-666666666602';
const CONTACT_3 = '66666666-6666-4666-8666-666666666603';
const CONTACT_4 = '66666666-6666-4666-8666-666666666604';
const CONTACT_5 = '66666666-6666-4666-8666-666666666605';
const CONTACT_6 = '66666666-6666-4666-8666-666666666606';
const CONTACT_BIZ_B = '66666666-6666-4666-8666-666666666699';

const { mockState, mockSupabase } = vi.hoisted(() => {
  interface MockDbState {
    authUser: { id: string } | null;
    tables: Record<string, Array<Record<string, unknown>>>;
    invokedFunctions: Array<{ name: string; body: unknown }>;
    insertedCampaigns: Array<Record<string, unknown>>;
  }

  const state: MockDbState = {
    authUser: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    tables: {},
    invokedFunctions: [],
    insertedCampaigns: [],
  };

  function createQueryBuilder(table: string) {
    const filters: Array<{ op: 'eq' | 'in'; col: string; val: unknown }> = [];
    let limitCount: number | null = null;
    let pendingInsert: Record<string, unknown> | null = null;

    const evaluateRows = () => {
      const rows = (state.tables[table] ?? []).filter((row) =>
        filters.every((f) => {
          if (f.op === 'eq') return row[f.col] === f.val;
          if (f.op === 'in') return Array.isArray(f.val) && f.val.includes(row[f.col]);
          return true;
        })
      );
      return limitCount !== null ? rows.slice(0, limitCount) : rows;
    };

    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (col: string, val: unknown) => {
        filters.push({ op: 'eq', col, val });
        return builder;
      },
      in: (col: string, val: unknown[]) => {
        filters.push({ op: 'in', col, val });
        return builder;
      },
      limit: (n: number) => {
        limitCount = n;
        return builder;
      },
      insert: (payload: Record<string, unknown>) => {
        pendingInsert = {
          id: '99999999-9999-4999-8999-999999999901',
          created_at: new Date().toISOString(),
          ...payload,
        };
        state.insertedCampaigns.push(pendingInsert);
        state.tables[table] = [...(state.tables[table] ?? []), pendingInsert];
        return builder;
      },
      maybeSingle: async () => {
        if (pendingInsert) {
          return { data: pendingInsert, error: null };
        }
        const rows = evaluateRows();
        return { data: rows[0] ?? null, error: null };
      },
      single: async () => {
        if (pendingInsert) {
          return { data: pendingInsert, error: null };
        }
        const rows = evaluateRows();
        return { data: rows[0] ?? null, error: rows[0] ? null : { message: 'Row not found' } };
      },
      then: (resolve: (val: { data: unknown[]; error: null }) => void) => {
        resolve({ data: evaluateRows(), error: null });
      },
    };

    return builder;
  }

  const client = {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: state.authUser },
        error: null,
      })),
      getSession: vi.fn(async () => ({
        data: { session: null },
        error: null,
      })),
    },
    from: vi.fn((table: string) => createQueryBuilder(table)),
    functions: {
      invoke: vi.fn(async (name: string, opts?: { body?: unknown }) => {
        state.invokedFunctions.push({ name, body: opts?.body });
        if (name === 'campaign-preflight') {
          const body = (opts?.body ?? {}) as Record<string, unknown>;
          if (body.action === 'create_snapshot') {
            return {
              data: {
                ok: true,
                replayed: false,
                runId: '88888888-8888-4888-8888-888888888801',
                runNumber: 1,
                status: 'validated',
                eligibleCount: 2,
                excludedCount: 3,
              },
              error: null,
            };
          }
        }
        return { data: null, error: { message: 'Unexpected function invocation' } };
      }),
    },
  };

  return { mockState: state, mockSupabase: client };
});

vi.mock('@/lib/supabase', () => ({
  supabase: mockSupabase,
  isSupabaseConfigured: true,
  supabaseConfigError: null,
}));

import {
  createCampaignSnapshotViaEdge,
  evaluateAudienceRows,
  evaluateContactConsent,
  resetCampaignPreflightEdgeCircuit,
  resolveCampaignAudienceFromDb,
  runCampaignGuardianPreflight,
  validateTemplateComponentsForCampaign,
  verifyActiveBusinessAdmin,
} from '@/services/campaignEngineService';
import {
  createCampaignInDb,
  seedTableColumnsFromRows,
} from '@/services/crmPersistenceService';

function seedDefaultWorkspace() {
  mockState.authUser = { id: ADMIN_A };
  mockState.invokedFunctions = [];
  mockState.insertedCampaigns = [];
  mockState.tables = {
    business_members: [
      { business_id: BIZ_A, user_id: ADMIN_A, role: 'admin', is_active: true },
      { business_id: BIZ_A, user_id: AGENT_A, role: 'agent', is_active: true },
      { business_id: BIZ_A, user_id: INACTIVE_ADMIN, role: 'admin', is_active: false },
    ],
    whatsapp_accounts: [
      {
        id: '77777777-7777-4777-8777-777777777701',
        business_id: BIZ_A,
        connection_status: 'connected',
        messaging_mode: 'test',
        test_allowlist: ['+14155550101'],
        meta_phone_number_id: '104928374650123',
        phone_number_e164: '+14155550199',
      },
    ],
    templates: [
      {
        id: TPL_APPROVED,
        business_id: BIZ_A,
        meta_template_id: 'meta_hello_world_001',
        name: 'hello_world',
        language: 'en_US',
        category: 'UTILITY',
        status: 'approved',
        components: [
          { type: 'HEADER', format: 'TEXT', text: 'Hello World' },
          { type: 'BODY', text: 'Welcome and congratulations! This message demonstrates your ability to send a WhatsApp message.' },
        ],
      },
      {
        id: TPL_PARAMS,
        business_id: BIZ_A,
        meta_template_id: 'meta_promo_002',
        name: 'spring_offer',
        language: 'en',
        category: 'MARKETING',
        status: 'approved',
        components: [
          { type: 'BODY', text: 'Hi {{1}}, enjoy {{2}} off your next order!' },
        ],
      },
      {
        id: TPL_DRAFT,
        business_id: BIZ_A,
        meta_template_id: null,
        name: 'local_only_draft',
        language: 'en',
        category: 'MARKETING',
        status: 'draft',
        components: [{ type: 'BODY', text: 'Draft text' }],
      },
      {
        id: TPL_BIZ_B,
        business_id: BIZ_B,
        meta_template_id: 'meta_biz_b_999',
        name: 'other_tenant_tpl',
        language: 'en_US',
        category: 'UTILITY',
        status: 'approved',
        components: [{ type: 'BODY', text: 'Tenant B template' }],
      },
    ],
    campaigns: [
      {
        id: CAMP_A,
        business_id: BIZ_A,
        name: 'Q2 Retention Draft',
        template_id: TPL_APPROVED,
        audience_filter: { mode: 'all', tag_ids: [], contact_ids: [] },
        status: 'draft',
        scheduled_at: null,
        created_by: ADMIN_A,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
      {
        id: CAMP_B,
        business_id: BIZ_B,
        name: 'Business B Campaign',
        template_id: TPL_BIZ_B,
        audience_filter: { mode: 'all', tag_ids: [], contact_ids: [] },
        status: 'draft',
        scheduled_at: null,
        created_by: ADMIN_A,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
    ],
    tags: [
      { id: TAG_VIP_A, business_id: BIZ_A, name: 'VIP' },
      { id: TAG_BIZ_B, business_id: BIZ_B, name: 'Other Biz Tag' },
    ],
    contact_tags: [
      { contact_id: CONTACT_1, tag_id: TAG_VIP_A },
      { contact_id: CONTACT_2, tag_id: TAG_VIP_A },
      { contact_id: CONTACT_3, tag_id: TAG_VIP_A },
      { contact_id: CONTACT_4, tag_id: TAG_VIP_A },
      { contact_id: CONTACT_5, tag_id: TAG_VIP_A },
      { contact_id: CONTACT_6, tag_id: TAG_VIP_A },
    ],
    contacts: [
      {
        id: CONTACT_1,
        business_id: BIZ_A,
        full_name: 'Amina Hassan',
        phone_e164: '+14155550101',
        marketing_opt_in: true,
        opt_in_status: 'opted_in',
        opted_out_at: null,
        created_at: '2026-01-01T00:00:01Z',
      },
      {
        id: CONTACT_2,
        business_id: BIZ_A,
        full_name: 'Ravi Kumar',
        phone_e164: '+919876543210',
        marketing_opt_in: true,
        opt_in_status: 'opted_in',
        opted_out_at: null,
        created_at: '2026-01-01T00:00:02Z',
      },
      {
        id: CONTACT_3,
        business_id: BIZ_A,
        full_name: 'Duplicate Ravi',
        phone_e164: '+91 98765-43210',
        marketing_opt_in: true,
        opt_in_status: 'opted_in',
        opted_out_at: null,
        created_at: '2026-01-01T00:00:03Z',
      },
      {
        id: CONTACT_4,
        business_id: BIZ_A,
        full_name: 'No Consent Contact',
        phone_e164: '+14155550104',
        marketing_opt_in: false,
        opt_in_status: 'unknown',
        opted_out_at: null,
        created_at: '2026-01-01T00:00:04Z',
      },
      {
        id: CONTACT_5,
        business_id: BIZ_A,
        full_name: 'Opted Out Contact',
        phone_e164: '+14155550105',
        marketing_opt_in: true,
        opt_in_status: 'opted_out',
        opted_out_at: '2026-01-05T10:00:00Z',
        created_at: '2026-01-01T00:00:05Z',
      },
      {
        id: CONTACT_6,
        business_id: BIZ_A,
        full_name: 'Bad Phone Contact',
        phone_e164: '12345',
        marketing_opt_in: true,
        opt_in_status: 'opted_in',
        opted_out_at: null,
        created_at: '2026-01-01T00:00:06Z',
      },
      {
        id: CONTACT_BIZ_B,
        business_id: BIZ_B,
        full_name: 'Tenant B Contact',
        phone_e164: '+14155550198',
        marketing_opt_in: true,
        opt_in_status: 'opted_in',
        opted_out_at: null,
        created_at: '2026-01-01T00:00:07Z',
      },
    ],
  };
}

/**
 * In-memory deterministic simulator mirroring Migration 004 PostgreSQL RPC contracts:
 * - create_campaign_run_snapshot (advisory lock, idempotency_key, single active run, Test Mode block, frozen snapshot)
 * - claim_campaign_recipients (FOR UPDATE SKIP LOCKED atomic batch lease)
 * - reclaim_expired_campaign_leases
 */
class SimulatedCampaignSnapshotStore {
  runs: Array<{
    id: string;
    businessId: string;
    campaignId: string;
    runNumber: number;
    idempotencyKey: string;
    status: 'draft_snapshot' | 'validated' | 'queued' | 'running' | 'paused' | 'completed';
    messagingMode: 'test' | 'live';
    eligibleCount: number;
    excludedCount: number;
  }> = [];

  recipients: Array<{
    id: string;
    runId: string;
    contactId: string | null;
    phoneE164: string;
    fullName: string;
    status: 'pending' | 'excluded' | 'claimed' | 'sent';
    exclusionReason: string | null;
    leaseOwner: string | null;
    leaseToken: string | null;
    leaseExpiresAt: number | null;
    attemptCount: number;
    maxAttempts: number;
  }> = [];

  createSnapshot(params: {
    businessId: string;
    campaignId: string;
    idempotencyKey: string;
    requestedStatus: 'draft_snapshot' | 'validated' | 'queued';
    messagingMode: 'test' | 'live';
    eligible: Array<{ contactId: string; fullName: string; phoneE164: string }>;
    excluded: Array<{ contactId: string | null; fullName: string; phoneE164: string; reason: string }>;
  }) {
    // 1. Idempotency replay
    const existing = this.runs.find(
      (r) =>
        r.businessId === params.businessId &&
        r.campaignId === params.campaignId &&
        r.idempotencyKey === params.idempotencyKey
    );
    if (existing) {
      return { ok: true, replayed: true, runId: existing.id, runNumber: existing.runNumber };
    }

    // 2. Test Mode guard
    if (params.messagingMode === 'test' && params.requestedStatus === 'queued') {
      return { ok: false, code: 'TEST_MODE_BULK_DISABLED' };
    }

    // 3. Single active run guard (mirrors partial unique index uq_campaign_runs_single_active_per_campaign)
    const active = this.runs.find(
      (r) =>
        r.campaignId === params.campaignId &&
        (r.status === 'queued' || r.status === 'running' || r.status === 'paused')
    );
    if (active) {
      return { ok: false, code: 'CONCURRENT_RUN_ACTIVE', existingRunId: active.id };
    }

    const runNumber =
      this.runs
        .filter((r) => r.campaignId === params.campaignId)
        .reduce((max, r) => Math.max(max, r.runNumber), 0) + 1;

    const runId = `run-${params.campaignId.slice(0, 8)}-${runNumber}`;

    // Deduplicate eligible recipients by phone (mirrors uq_campaign_recipients_run_phone_eligible)
    const seenPhones = new Set<string>();
    let eligibleCount = 0;
    let excludedCount = 0;

    for (const item of params.eligible) {
      if (seenPhones.has(item.phoneE164)) {
        excludedCount += 1;
        this.recipients.push({
          id: `rec-${runId}-dup-${excludedCount}`,
          runId,
          contactId: item.contactId,
          phoneE164: item.phoneE164,
          fullName: item.fullName,
          status: 'excluded',
          exclusionReason: 'duplicate_phone',
          leaseOwner: null,
          leaseToken: null,
          leaseExpiresAt: null,
          attemptCount: 0,
          maxAttempts: 3,
        });
        continue;
      }
      seenPhones.add(item.phoneE164);
      eligibleCount += 1;
      this.recipients.push({
        id: `rec-${runId}-el-${eligibleCount}`,
        runId,
        contactId: item.contactId,
        phoneE164: item.phoneE164,
        fullName: item.fullName,
        status: 'pending',
        exclusionReason: null,
        leaseOwner: null,
        leaseToken: null,
        leaseExpiresAt: null,
        attemptCount: 0,
        maxAttempts: 3,
      });
    }

    for (const ex of params.excluded) {
      excludedCount += 1;
      this.recipients.push({
        id: `rec-${runId}-ex-${excludedCount}`,
        runId,
        contactId: ex.contactId,
        phoneE164: ex.phoneE164,
        fullName: ex.fullName,
        status: 'excluded',
        exclusionReason: ex.reason,
        leaseOwner: null,
        leaseToken: null,
        leaseExpiresAt: null,
        attemptCount: 0,
        maxAttempts: 3,
      });
    }

    this.runs.push({
      id: runId,
      businessId: params.businessId,
      campaignId: params.campaignId,
      runNumber,
      idempotencyKey: params.idempotencyKey,
      status: params.requestedStatus,
      messagingMode: params.messagingMode,
      eligibleCount,
      excludedCount,
    });

    return { ok: true, replayed: false, runId, runNumber, eligibleCount, excludedCount };
  }

  claimRecipients(runId: string, workerId: string, batchSize: number, leaseMs = 60_000, nowMs = Date.now()) {
    const run = this.runs.find((r) => r.id === runId);
    if (!run || run.status !== 'running' || run.messagingMode === 'test') {
      return [];
    }

    const candidates = this.recipients
      .filter(
        (r) =>
          r.runId === runId &&
          r.status === 'pending' &&
          r.attemptCount < r.maxAttempts &&
          (r.leaseExpiresAt === null || r.leaseExpiresAt <= nowMs)
      )
      .slice(0, batchSize);

    const leaseToken = `lease-${workerId}-${nowMs}`;
    for (const rec of candidates) {
      rec.status = 'claimed';
      rec.leaseOwner = workerId;
      rec.leaseToken = leaseToken;
      rec.leaseExpiresAt = nowMs + leaseMs;
      rec.attemptCount += 1;
    }

    return candidates.map((c) => ({ ...c }));
  }

  reclaimExpiredLeases(runId: string, nowMs = Date.now()) {
    let reclaimed = 0;
    for (const rec of this.recipients) {
      if (
        rec.runId === runId &&
        rec.status === 'claimed' &&
        rec.leaseExpiresAt !== null &&
        rec.leaseExpiresAt < nowMs
      ) {
        rec.status = 'pending';
        rec.leaseOwner = null;
        rec.leaseToken = null;
        rec.leaseExpiresAt = null;
        reclaimed += 1;
      }
    }
    return reclaimed;
  }
}

describe('Campaign Engine V1 — Phase 1 (Local / Mocked Unit & Contract Suite)', () => {
  beforeEach(() => {
    seedDefaultWorkspace();
    resetCampaignPreflightEdgeCircuit();
    seedTableColumnsFromRows('campaigns', [
      {
        id: CAMP_A,
        business_id: BIZ_A,
        name: 'seed',
        template_id: TPL_APPROVED,
        audience_filter: {},
        status: 'draft',
        scheduled_at: null,
        created_by: ADMIN_A,
        created_at: '',
        updated_at: '',
      },
    ]);
    vi.clearAllMocks();
  });

  // 1. Audience filtering & consent
  it('enforces explicit opt-in consent and never treats a saved phone number as consent', async () => {
    expect(
      evaluateContactConsent({
        marketing_opt_in: false,
        opt_in_status: 'unknown',
        opted_out_at: null,
      })
    ).toMatchObject({ eligible: false, reason: 'no_explicit_consent' });

    expect(
      evaluateContactConsent({
        marketing_opt_in: true,
        opt_in_status: 'opted_in',
        opted_out_at: '2026-01-10T00:00:00Z',
      })
    ).toMatchObject({ eligible: false, reason: 'opted_out' });

    const res = await resolveCampaignAudienceFromDb({
      businessId: BIZ_A,
      audienceFilter: { mode: 'all' },
    });

    expect(res.ok).toBe(true);
    expect(res.totalMatched).toBe(6);
    expect(res.eligibleCount).toBe(2);
    expect(res.excludedCount).toBe(4);
    expect(res.eligibleRecipients.map((r) => r.phoneE164)).toEqual([
      '+14155550101',
      '+919876543210',
    ]);
    expect(res.groupedExclusions).toEqual({
      contact_not_in_business: 0,
      invalid_phone: 1,
      duplicate_phone: 1,
      opted_out: 1,
      no_explicit_consent: 1,
    });
  });

  it('supports tag-based audiences (groups) and specific contact selection from DB', async () => {
    const groupRes = await resolveCampaignAudienceFromDb({
      businessId: BIZ_A,
      audienceFilter: { mode: 'groups', tagIds: [TAG_VIP_A] },
    });
    expect(groupRes.ok).toBe(true);
    expect(groupRes.eligibleCount).toBe(2);
    expect(groupRes.groupedExclusions.duplicate_phone).toBe(1);
    expect(groupRes.groupedExclusions.invalid_phone).toBe(1);
    expect(groupRes.groupedExclusions.opted_out).toBe(1);
    expect(groupRes.groupedExclusions.no_explicit_consent).toBe(1);

    const specificRes = await resolveCampaignAudienceFromDb({
      businessId: BIZ_A,
      audienceFilter: { mode: 'specific', contactIds: [CONTACT_1, CONTACT_4] },
    });
    expect(specificRes.ok).toBe(true);
    expect(specificRes.totalMatched).toBe(2);
    expect(specificRes.eligibleCount).toBe(1);
    expect(specificRes.groupedExclusions.no_explicit_consent).toBe(1);
  });

  // 2. Invalid phones & duplicate deduplication
  it('excludes invalid E.164 numbers and deduplicates formatted duplicate phone numbers deterministically', () => {
    const evaluated = evaluateAudienceRows({
      mode: 'all',
      matchedContacts: [
        {
          id: CONTACT_1,
          full_name: 'First Owner',
          phone_e164: '+1 (415) 555-0101',
          marketing_opt_in: true,
          created_at: '2026-01-01T00:00:01Z',
        },
        {
          id: CONTACT_2,
          full_name: 'Duplicate Formatted',
          phone_e164: '+14155550101',
          marketing_opt_in: true,
          created_at: '2026-01-01T00:00:02Z',
        },
        {
          id: CONTACT_3,
          full_name: 'Short Invalid',
          phone_e164: '+123',
          marketing_opt_in: true,
          created_at: '2026-01-01T00:00:03Z',
        },
        {
          id: CONTACT_4,
          full_name: 'Empty Phone',
          phone_e164: '',
          marketing_opt_in: true,
          created_at: '2026-01-01T00:00:04Z',
        },
      ],
    });

    expect(evaluated.eligibleCount).toBe(1);
    expect(evaluated.eligibleRecipients[0].contactId).toBe(CONTACT_1);
    expect(evaluated.eligibleRecipients[0].phoneE164).toBe('+14155550101');
    expect(evaluated.groupedExclusions.duplicate_phone).toBe(1);
    expect(evaluated.groupedExclusions.invalid_phone).toBe(2);
  });

  // 3. Template approval & components JSONB parameter validation
  it('validates Meta template approval status and components JSONB parameters strictly', async () => {
    // Parameterless approved hello_world passes
    const passReport = await runCampaignGuardianPreflight({
      businessId: BIZ_A,
      templateId: TPL_APPROVED,
      audienceFilter: { mode: 'all' },
      variableMapping: {},
      scheduleMode: 'draft',
    });
    expect(passReport.ok).toBe(true);
    expect(passReport.canSaveDraft).toBe(true);
    expect(passReport.canLaunchBulk).toBe(false);
    expect(passReport.phase1DispatchBlocked).toBe(true);

    // Local draft template fails TEMPLATE_NOT_APPROVED
    const draftReport = await runCampaignGuardianPreflight({
      businessId: BIZ_A,
      templateId: TPL_DRAFT,
      audienceFilter: { mode: 'all' },
      scheduleMode: 'draft',
    });
    expect(draftReport.ok).toBe(false);
    expect(draftReport.checks.some((c) => c.code === 'TEMPLATE_NOT_APPROVED' && c.status === 'fail')).toBe(
      true
    );

    // Parameterized template missing {{2}} fails
    const missingParamReport = await runCampaignGuardianPreflight({
      businessId: BIZ_A,
      templateId: TPL_PARAMS,
      audienceFilter: { mode: 'all' },
      variableMapping: { '1': 'Amina' },
      scheduleMode: 'draft',
    });
    expect(missingParamReport.ok).toBe(false);
    expect(missingParamReport.checks.some((c) => c.code === 'TEMPLATE_PARAMS_MISSING')).toBe(true);

    // Unsupported IMAGE header & named parameter rejected
    const unsupported = validateTemplateComponentsForCampaign(
      [
        { type: 'HEADER', format: 'IMAGE' },
        { type: 'BODY', text: 'Hello {{first_name}}!' },
      ],
      {}
    );
    expect(unsupported.ok).toBe(false);
    expect(unsupported.supported).toBe(false);
    expect(unsupported.unsupportedReasons.length).toBeGreaterThanOrEqual(2);
  });

  // 4. Cross-business isolation
  it('enforces strict cross-business isolation for campaigns, templates, tags, and contacts', async () => {
    const crossTenantReport = await runCampaignGuardianPreflight({
      businessId: BIZ_A,
      campaignId: CAMP_B,
      templateId: TPL_BIZ_B,
      audienceFilter: { mode: 'groups', tagIds: [TAG_BIZ_B] },
      scheduleMode: 'draft',
    });

    expect(crossTenantReport.ok).toBe(false);
    expect(crossTenantReport.canSaveDraft).toBe(false);
    expect(crossTenantReport.checks.some((c) => c.code === 'CAMPAIGN_NOT_IN_BUSINESS')).toBe(true);
    expect(crossTenantReport.checks.some((c) => c.code === 'TEMPLATE_NOT_FOUND')).toBe(true);
    expect(crossTenantReport.checks.some((c) => c.code === 'CROSS_BUSINESS_TAGS')).toBe(true);
    expect(crossTenantReport.audience.eligibleCount).toBe(0);

    // Selecting a Business B contact explicitly under Business A marks it contact_not_in_business
    const crossContactAudience = await resolveCampaignAudienceFromDb({
      businessId: BIZ_A,
      audienceFilter: { mode: 'specific', contactIds: [CONTACT_BIZ_B] },
    });
    expect(crossContactAudience.eligibleCount).toBe(0);
    expect(crossContactAudience.groupedExclusions.contact_not_in_business).toBe(1);
    expect(crossContactAudience.invalidContactIds).toEqual([CONTACT_BIZ_B]);
  });

  // 5. Active administrator authorization
  it('requires active administrator membership (is_active = true and role = admin)', async () => {
    // Active agent denied
    mockState.authUser = { id: AGENT_A };
    const agentAuth = await verifyActiveBusinessAdmin(BIZ_A);
    expect(agentAuth).toMatchObject({ ok: false, code: 'ADMIN_REQUIRED' });

    const agentReport = await runCampaignGuardianPreflight({
      businessId: BIZ_A,
      templateId: TPL_APPROVED,
      audienceFilter: { mode: 'all' },
    });
    expect(agentReport.ok).toBe(false);
    expect(agentReport.canSaveDraft).toBe(false);

    // Inactive admin denied (is_active = false)
    mockState.authUser = { id: INACTIVE_ADMIN };
    const inactiveAuth = await verifyActiveBusinessAdmin(BIZ_A);
    expect(inactiveAuth).toMatchObject({ ok: false, code: 'INACTIVE_MEMBER' });

    // Unauthenticated denied
    mockState.authUser = null;
    const unauth = await verifyActiveBusinessAdmin(BIZ_A);
    expect(unauth).toMatchObject({ ok: false, code: 'UNAUTHENTICATED' });
  });

  // 6 & 7. Concurrent launch protection, atomic claiming & durable recipient snapshots
  it('prevents concurrent duplicate launches, freezes durable snapshots, and claims disjoint batches atomically', () => {
    const store = new SimulatedCampaignSnapshotStore();

    // Test Mode blocks queued launch
    const testModeBlocked = store.createSnapshot({
      businessId: BIZ_A,
      campaignId: CAMP_A,
      idempotencyKey: 'launch-test-1',
      requestedStatus: 'queued',
      messagingMode: 'test',
      eligible: [{ contactId: CONTACT_1, fullName: 'Amina', phoneE164: '+14155550101' }],
      excluded: [],
    });
    expect(testModeBlocked).toMatchObject({ ok: false, code: 'TEST_MODE_BULK_DISABLED' });

    // Create durable snapshot in live mode with 3 unique + 1 duplicate + 1 opted-out
    const snap1 = store.createSnapshot({
      businessId: BIZ_A,
      campaignId: CAMP_A,
      idempotencyKey: 'idem-key-001',
      requestedStatus: 'queued',
      messagingMode: 'live',
      eligible: [
        { contactId: CONTACT_1, fullName: 'Amina', phoneE164: '+14155550101' },
        { contactId: CONTACT_2, fullName: 'Ravi', phoneE164: '+919876543210' },
        { contactId: CONTACT_3, fullName: 'Ravi Dup', phoneE164: '+919876543210' },
        { contactId: CONTACT_4, fullName: 'Sara', phoneE164: '+14155550109' },
      ],
      excluded: [
        {
          contactId: CONTACT_5,
          fullName: 'Opted Out',
          phoneE164: '+14155550105',
          reason: 'opted_out',
        },
      ],
    });

    expect(snap1).toMatchObject({
      ok: true,
      replayed: false,
      runNumber: 1,
      eligibleCount: 3,
      excludedCount: 2,
    });

    // Idempotent retry returns the exact same run without duplicating recipients
    const replay = store.createSnapshot({
      businessId: BIZ_A,
      campaignId: CAMP_A,
      idempotencyKey: 'idem-key-001',
      requestedStatus: 'queued',
      messagingMode: 'live',
      eligible: [],
      excluded: [],
    });
    expect(replay).toMatchObject({ ok: true, replayed: true, runId: snap1.runId });

    // Second concurrent launch with different idempotency key is rejected
    const concurrentLaunch = store.createSnapshot({
      businessId: BIZ_A,
      campaignId: CAMP_A,
      idempotencyKey: 'idem-key-002',
      requestedStatus: 'queued',
      messagingMode: 'live',
      eligible: [{ contactId: CONTACT_1, fullName: 'Amina', phoneE164: '+14155550101' }],
      excluded: [],
    });
    expect(concurrentLaunch).toMatchObject({ ok: false, code: 'CONCURRENT_RUN_ACTIVE' });

    // Mutating the live contact afterwards does NOT alter the frozen snapshot
    mockState.tables.contacts[0].marketing_opt_in = false;
    mockState.tables.contacts[0].opted_out_at = '2026-02-01T00:00:00Z';
    const frozenEligible = store.recipients.filter(
      (r) => r.runId === snap1.runId && r.status === 'pending'
    );
    expect(frozenEligible).toHaveLength(3);

    // Promote run to running in simulator to verify atomic worker job claiming with zero overlap
    store.runs[0].status = 'running';
    const workerABatch = store.claimRecipients(snap1.runId!, 'worker-a', 2, 10_000, 1_000);
    const workerBBatch = store.claimRecipients(snap1.runId!, 'worker-b', 2, 10_000, 1_000);
    const workerCBatch = store.claimRecipients(snap1.runId!, 'worker-c', 2, 10_000, 1_000);

    expect(workerABatch).toHaveLength(2);
    expect(workerBBatch).toHaveLength(1);
    expect(workerCBatch).toHaveLength(0);

    const claimedIds = [...workerABatch, ...workerBBatch].map((r) => r.id);
    expect(new Set(claimedIds).size).toBe(3);

    // Expired leases are cleanly reclaimed
    const reclaimed = store.reclaimExpiredLeases(snap1.runId!, 20_000);
    expect(reclaimed).toBe(3);
  });

  // 8. Zero WhatsApp dispatch from draft saving, preflight, or snapshot operations
  it('never dispatches WhatsApp messages or calls Meta Graph API during draft, preflight, or snapshot flows', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('fetch() must never be called during Phase 1 validation or draft save');
    });

    try {
      // Switch to live mode to prove Phase 1 still blocks bulk launch
      mockState.tables.whatsapp_accounts[0].messaging_mode = 'live';

      const report = await runCampaignGuardianPreflight({
        businessId: BIZ_A,
        templateId: TPL_APPROVED,
        audienceFilter: { mode: 'all' },
        scheduleMode: 'immediate',
      });
      expect(report.ok).toBe(true);
      expect(report.canLaunchBulk).toBe(false);
      expect(report.phase1DispatchBlocked).toBe(true);

      const draftSave = await createCampaignInDb({
        businessId: BIZ_A,
        name: 'Phase 1 Safe Draft',
        templateId: TPL_APPROVED,
        status: 'draft',
        audienceMode: 'all',
        targetTagIds: [],
        variableMapping: {},
        selectedCount: report.audience.totalMatched,
        eligibleCount: report.audience.eligibleCount,
        skippedCount: report.audience.excludedCount,
        createdBy: ADMIN_A,
      });
      expect(draftSave.ok).toBe(true);

      const snapshotRes = await createCampaignSnapshotViaEdge({
        businessId: BIZ_A,
        campaignId: CAMP_A,
        idempotencyKey: 'phase1-safe-snap-1',
        audienceFilter: { mode: 'all' },
      });
      expect(snapshotRes.ok).toBe(true);

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(
        mockState.invokedFunctions.some((fn) => fn.name === 'whatsapp-send-message')
      ).toBe(false);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  // 9. Correct validation results after page refresh
  it('recomputes fresh DB-verified validation results after restoring a saved draft across page refresh', async () => {
    const storageMap = new Map<string, string>();
    const draftPayload = {
      inCompose: true,
      wizardStage: 3,
      audienceMode: 'all' as const,
      selectedTagIds: [] as string[],
      selectedContactIds: [] as string[],
      selectedTemplateId: TPL_APPROVED,
      varMapping: {},
      scheduleMode: 'immediate' as const,
      scheduledFor: '2026-12-01T10:00',
      customName: 'Reload Durability Campaign',
    };
    storageMap.set('zoqniva_broadcast_composer_draft', JSON.stringify(draftPayload));

    // Validation before reload: 2 eligible
    const beforeReload = await runCampaignGuardianPreflight({
      businessId: BIZ_A,
      templateId: draftPayload.selectedTemplateId,
      audienceFilter: { mode: draftPayload.audienceMode },
      scheduleMode: 'draft',
    });
    expect(beforeReload.audience.eligibleCount).toBe(2);
    expect(beforeReload.audience.groupedExclusions.opted_out).toBe(1);

    // Simulate contact #1 opting out in DB while page reloads
    mockState.tables.contacts[0].marketing_opt_in = false;
    mockState.tables.contacts[0].opt_in_status = 'opted_out';
    mockState.tables.contacts[0].opted_out_at = '2026-02-01T08:00:00Z';

    // Simulate page refresh: restore draft from storage and re-run Guardian preflight
    resetCampaignPreflightEdgeCircuit();
    const restored = JSON.parse(storageMap.get('zoqniva_broadcast_composer_draft')!);
    expect(restored.wizardStage).toBe(3);
    expect(restored.customName).toBe('Reload Durability Campaign');

    const afterReload = await runCampaignGuardianPreflight({
      businessId: BIZ_A,
      templateId: restored.selectedTemplateId,
      audienceFilter: { mode: restored.audienceMode },
      scheduleMode: 'draft',
    });

    expect(afterReload.ok).toBe(true);
    expect(afterReload.audience.eligibleCount).toBe(1);
    expect(afterReload.audience.excludedCount).toBe(5);
    expect(afterReload.audience.groupedExclusions.opted_out).toBe(2);
  });

  // 10. Static SQL verification for preflight read-only script & migration 004
  it('ensures preflight SQL is strictly read-only and migration 004 defines required Phase 1 foundations safely', () => {
    const rootDir = path.resolve(__dirname, '../..');
    const preflightSql = fs.readFileSync(
      path.join(rootDir, 'tests/db/campaign_engine_preflight_readonly.sql'),
      'utf8'
    );
    // Strip SQL line comments before checking for mutating keywords
    const preflightNoComments = preflightSql.replace(/--.*$/gm, '');
    expect(preflightNoComments).not.toMatch(
      /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE)\b/i
    );

    const migration004 = fs.readFileSync(
      path.join(rootDir, 'supabase/migrations/004_campaign_engine_v1_phase1.sql'),
      'utf8'
    );
    expect(migration004).toContain('CREATE TABLE IF NOT EXISTS public.campaign_runs');
    expect(migration004).toContain('CREATE TABLE IF NOT EXISTS public.campaign_recipients');
    expect(migration004).toContain('CREATE TABLE IF NOT EXISTS public.campaign_events');
    expect(migration004).toContain('FOR UPDATE SKIP LOCKED');
    expect(migration004).toContain('create_campaign_run_snapshot');
    expect(migration004).toContain('claim_campaign_recipients');
    expect(migration004).toContain('reclaim_expired_campaign_leases');
    expect(migration004).toContain('bm.is_active = TRUE');
    expect(migration004).not.toContain("bm.status = 'active'");
  });
});
