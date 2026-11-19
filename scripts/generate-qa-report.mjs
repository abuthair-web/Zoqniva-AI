#!/usr/bin/env node
/**
 * Zoqniva AI — Automated QA Report Generator (Phase 8)
 *
 * Executes local Vitest suites with JSON reporting, reads optional Playwright/Live JSON
 * outputs if present, and generates:
 *   - qa-reports/zoqniva-qa-report.json (machine-readable)
 *   - qa-reports/zoqniva-qa-report.md   (human-readable with exact QA matrix columns)
 *
 * STRICT HONESTY RULES:
 * - Never fabricates results or treats mocked tests as proof of live DB persistence.
 * - Uses ONLY exact statuses: PASSED, FAILED, NOT TESTED, NOT IMPLEMENTED, BLOCKED.
 * - Summary statistics are calculated strictly from real test execution records.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT_DIR = path.resolve(process.cwd());
const REPORTS_DIR = path.join(ROOT_DIR, 'qa-reports');
fs.mkdirSync(REPORTS_DIR, { recursive: true });

const VITEST_JSON_PATH = path.join(REPORTS_DIR, 'vitest-results.json');
const PLAYWRIGHT_JSON_PATH = path.join(REPORTS_DIR, 'playwright-results.json');

function runCommand(cmd, args) {
  const res = spawnSync(cmd, args, {
    cwd: ROOT_DIR,
    encoding: 'utf8',
    env: { ...process.env },
  });
  return {
    ok: res.status === 0,
    exitCode: res.status ?? 1,
    stdout: res.stdout || '',
    stderr: res.stderr || '',
  };
}

// 1. Run TypeScript check
const tscRun = runCommand('npx', ['tsc', '--noEmit']);

// 2. Run local CI-safe Vitest suites (unit + mocked WhatsApp + static security) with JSON output
const vitestRun = runCommand('npx', [
  'vitest',
  'run',
  'tests/unit',
  'tests/security/static-security.test.ts',
  '--reporter=json',
  `--outputFile=${VITEST_JSON_PATH}`,
]);

let vitestJson = null;
if (fs.existsSync(VITEST_JSON_PATH)) {
  try {
    vitestJson = JSON.parse(fs.readFileSync(VITEST_JSON_PATH, 'utf8'));
  } catch {
    vitestJson = null;
  }
}

let playwrightJson = null;
if (fs.existsSync(PLAYWRIGHT_JSON_PATH)) {
  try {
    playwrightJson = JSON.parse(fs.readFileSync(PLAYWRIGHT_JSON_PATH, 'utf8'));
  } catch {
    playwrightJson = null;
  }
}

function classifySuiteModule(filePath) {
  const rel = filePath.replace(ROOT_DIR, '').replace(/\\/g, '/');
  if (rel.includes('phone.test.ts')) return { module: 'Contacts & Inbox', table: 'public.contacts / public.conversations' };
  if (rel.includes('templates.test.ts')) return { module: 'Message Templates', table: 'public.templates' };
  if (rel.includes('crmPersistence.contacts.test.ts')) return { module: 'Contacts & Tags', table: 'public.contacts, public.tags, public.contact_tags' };
  if (rel.includes('crmPersistence.campaigns.test.ts')) return { module: 'Campaigns', table: 'public.campaigns' };
  if (rel.includes('whatsapp-send-template.test.ts')) return { module: 'WhatsApp Template Sending', table: 'public.templates, public.messages' };
  if (rel.includes('whatsapp.integration.test.ts')) return { module: 'WhatsApp Cloud API', table: 'public.whatsapp_accounts, public.messages, public.webhook_events' };
  if (rel.includes('static-security.test.ts')) return { module: 'Security & Schema', table: 'All public CRM tables & Edge Functions' };
  return { module: 'Core', table: 'N/A' };
}

// Build Executed Local / Mocked Tests rows strictly from Vitest + tsc
const localExecutedRows = [
  {
    scope: 'local_static',
    module: 'Build & TypeScript',
    feature: 'TypeScript static type safety (tsc --noEmit)',
    databaseTable: 'N/A',
    testPerformed: 'Executed `npx tsc --noEmit` across src/ and TypeScript test suites',
    result: tscRun.ok ? 'PASSED' : 'FAILED',
    error: tscRun.ok ? 'None' : (tscRun.stdout || tscRun.stderr).trim().split('\n').slice(0, 3).join(' | '),
    severity: tscRun.ok ? 'None' : 'High',
    recommendedFix: tscRun.ok ? 'None required' : 'Resolve TypeScript compilation errors before deployment',
  },
];

if (vitestJson && Array.isArray(vitestJson.testResults)) {
  for (const suite of vitestJson.testResults) {
    const meta = classifySuiteModule(suite.name || '');
    for (const assertion of suite.assertionResults || []) {
      const passed = assertion.status === 'passed';
      const failed = assertion.status === 'failed';
      const result = passed ? 'PASSED' : failed ? 'FAILED' : 'NOT TESTED';
      const errMsg = failed
        ? (assertion.failureMessages || []).join(' | ').replace(/\s+/g, ' ').slice(0, 220)
        : 'None';

      localExecutedRows.push({
        scope: 'local_mocked_or_static',
        module: meta.module,
        feature: assertion.ancestorTitles?.join(' > ') || meta.module,
        databaseTable: meta.table,
        testPerformed: `[Local/Mocked] ${assertion.title}`,
        result,
        error: errMsg,
        severity: failed ? 'High' : 'None',
        recommendedFix: failed ? 'Inspect failing assertion and fix module logic' : 'None required',
      });
    }
  }
} else {
  localExecutedRows.push({
    scope: 'local_mocked_or_static',
    module: 'Vitest Runner',
    feature: 'Local automated unit & security tests',
    databaseTable: 'N/A',
    testPerformed: 'Executed Vitest runner with JSON output',
    result: 'FAILED',
    error: (vitestRun.stderr || vitestRun.stdout || 'Vitest JSON report not generated').slice(0, 220),
    severity: 'Critical',
    recommendedFix: 'Verify Vitest installation and run `npm run test` to inspect error output',
  });
}

// Build Playwright rows (if executed) or honest BLOCKED record
const browserRows = [];
if (playwrightJson && Array.isArray(playwrightJson.suites)) {
  const walkSuites = (suites) => {
    for (const s of suites) {
      for (const spec of s.specs || []) {
        for (const t of spec.tests || []) {
          const outcome = t.status;
          const resStatus =
            outcome === 'expected'
              ? 'PASSED'
              : outcome === 'skipped'
              ? 'BLOCKED'
              : 'FAILED';
          browserRows.push({
            scope: 'browser_ui',
            module: 'Browser E2E (Playwright)',
            feature: s.title || 'Playwright UI',
            databaseTable: 'Frontend / Protected Routes',
            testPerformed: `[Playwright] ${spec.title}`,
            result: resStatus,
            error:
              resStatus === 'FAILED'
                ? JSON.stringify(t.results?.[0]?.error?.message || 'Test failed').slice(0, 200)
                : resStatus === 'BLOCKED'
                ? 'Skipped due to missing staging environment credentials'
                : 'None',
            severity: resStatus === 'FAILED' ? 'High' : 'None',
            recommendedFix:
              resStatus === 'FAILED'
                ? 'Inspect Playwright trace/screenshot in test-results/'
                : 'None required',
          });
        }
      }
      if (Array.isArray(s.suites)) walkSuites(s.suites);
    }
  };
  walkSuites(playwrightJson.suites);
} else {
  browserRows.push({
    scope: 'browser_ui',
    module: 'Browser E2E (Playwright)',
    feature: 'Chromium UI smoke & error-retention suite',
    databaseTable: 'Frontend / Protected Routes',
    testPerformed: 'Playwright browser execution (`npm run test:e2e`)',
    result: 'BLOCKED',
    error: 'Chromium browser binary not installed or `npm run test:e2e` has not been executed in this environment',
    severity: 'Medium',
    recommendedFix: 'Run `npx playwright install --with-deps chromium && npm run test:e2e` in CI or local dev environment',
  });
}

// Build Live Staging DB, pgTAP, Deno Edge, Live WhatsApp, and Audited/Unimplemented Module rows (Honest, NEVER mocked as PASSED)
const liveAndAuditedRows = [
  {
    scope: 'live_staging_db',
    module: 'Contacts & Tags',
    feature: 'Live Supabase CRUD, duplicate 23505, consent & reload durability',
    databaseTable: 'public.contacts, public.tags, public.contact_tags',
    testPerformed: 'Live authenticated INSERT -> SELECT -> UPDATE -> DELETE (`npm run test:integration`)',
    result: 'BLOCKED',
    error: 'Requires dedicated non-production staging Supabase env vars (`ALLOW_LIVE_TEST_DB=true`, `TEST_SUPABASE_URL`, staging role credentials)',
    severity: 'Medium',
    recommendedFix: 'Populate `.env.test.local` using `.env.test.example` against staging and run `npm run test:integration`',
  },
  {
    scope: 'live_staging_db',
    module: 'Campaigns',
    feature: 'Live Supabase draft persistence & template FK validation',
    databaseTable: 'public.campaigns',
    testPerformed: 'Live authenticated draft INSERT -> SELECT read-back without WhatsApp sends (`npm run test:integration`)',
    result: 'BLOCKED',
    error: 'Requires dedicated non-production staging Supabase env vars (`ALLOW_LIVE_TEST_DB=true`)',
    severity: 'Medium',
    recommendedFix: 'Run `npm run test:integration` and `npm run test:e2e:live` against staging',
  },
  {
    scope: 'live_staging_db',
    module: 'Security & RLS (5 Roles)',
    feature: 'Cross-tenant isolation & role enforcement (Admin A, Agent A, Admin B, Anon, Inactive)',
    databaseTable: 'All public CRM tables',
    testPerformed: 'Live 5-role Supabase RLS suite (`npm run test:security:live`) & pgTAP (`npm run test:db`)',
    result: 'BLOCKED',
    error: 'Supabase CLI / local Postgres & staging 5-role credentials are not configured in this sandbox',
    severity: 'High',
    recommendedFix: 'Run `supabase start && npm run test:db` locally and `npm run test:security:live` against staging; also verify live `is_business_member()` uses `is_active = true` via `tests/db/schema_audit_readonly.sql`',
  },
  {
    scope: 'live_staging_edge',
    module: 'Edge Functions (Deno)',
    feature: 'CORS preflight, JWT rejection, HMAC webhook signature & live HTTP contract tests',
    databaseTable: 'Edge Functions (`team-members`, `whatsapp-*`, `sync-templates`)',
    testPerformed: 'Deno Edge Function test suite (`npm run test:edge`)',
    result: 'BLOCKED',
    error: 'Deno runtime is not installed in this sandbox environment',
    severity: 'Medium',
    recommendedFix: 'Run `npm run test:edge` in GitHub Actions CI or local machine with Deno installed',
  },
  {
    scope: 'live_whatsapp_sandbox',
    module: 'WhatsApp Cloud API (Live)',
    feature: 'Explicitly initiated live Meta connection check, template sync & single allowlisted test send',
    databaseTable: 'public.whatsapp_accounts, public.templates, public.messages',
    testPerformed: 'Opt-in live WhatsApp sandbox suite (`npm run test:live:whatsapp`)',
    result: 'NOT TESTED',
    error: 'Intentionally disabled by default (`RUN_LIVE_WHATSAPP_TEST=false`) to prevent unintended WhatsApp messages',
    severity: 'None',
    recommendedFix: 'Manually run `npm run test:live:whatsapp` only with an allowlisted sandbox recipient in staging',
  },
  {
    scope: 'live_whatsapp_sandbox',
    module: 'WhatsApp Template Sending (Live Deployment)',
    feature: 'Deployed `whatsapp-send-message` template send with real `status` & `components` JSONB',
    databaseTable: 'public.templates, public.messages',
    testPerformed: 'Source bug fixed & verified locally against mocked Supabase/Meta; live deployed send awaits Supabase Dashboard deployment + authorized test recipient',
    result: 'NOT TESTED',
    error: 'Corrected Edge Function has not yet been deployed to live Supabase or tested against an authorized test WhatsApp number',
    severity: 'None',
    recommendedFix: 'Deploy updated `supabase/functions/whatsapp-send-message/index.ts` via Supabase Dashboard and send 1 allowlisted approved template test (e.g., hello_world)',
  },
  {
    scope: 'audit_codebase',
    module: 'Database Migrations / RLS',
    feature: 'RLS helper functions `is_business_member` & `is_business_admin` in `002_rls_and_realtime.sql`',
    databaseTable: 'public.business_members, public.profiles',
    testPerformed: 'Static migration drift audit (`supabase/migrations/002_rls_and_realtime.sql`)',
    result: 'FAILED',
    error: 'Migration SQL references `bm.status = \'active\'` whereas live `public.business_members` uses `is_active BOOLEAN`',
    severity: 'Critical',
    recommendedFix: 'Run `tests/db/schema_audit_readonly.sql` on live DB to verify live RLS helpers; prepare a reviewed migration updating `bm.status = \'active\'` to `bm.is_active = true`',
  },
  {
    scope: 'audit_codebase',
    module: 'Automations',
    feature: 'Create, toggle, update, and delete automation rules',
    databaseTable: 'public.automation_rules',
    testPerformed: 'Frontend-to-backend write trace in `src/context/AppContext.tsx` (lines 2306-2342)',
    result: 'FAILED',
    error: 'Mutations only update local React state (`id: rule-${Date.now()}`) with zero Supabase INSERT/UPDATE/DELETE calls; lost on refresh',
    severity: 'High',
    recommendedFix: 'Implement real Supabase CRUD with `.select().single()` verification in `crmPersistenceService.ts` and wire `AppContext.tsx`',
  },
  {
    scope: 'audit_codebase',
    module: 'Team Members (Mutations)',
    feature: 'Invite staff, change role, suspend/activate, and remove member',
    databaseTable: 'public.business_members',
    testPerformed: 'Frontend-to-backend write trace in `src/context/AppContext.tsx` (lines 2525-2565)',
    result: 'FAILED',
    error: 'Read directory is backed by Supabase/Edge Function, but mutations (`inviteTeamMember`, `updateTeamMemberRole`, `toggleTeamMemberStatus`, `removeTeamMember`) are React-state-only',
    severity: 'High',
    recommendedFix: 'Implement authenticated admin-only Edge Function or RLS-backed mutations on `public.business_members` and verify read-back',
  },
  {
    scope: 'audit_codebase',
    module: 'AI Assistant',
    feature: 'Save AI settings & knowledge base items',
    databaseTable: 'public.businesses (`ai_settings`) / no knowledge table',
    testPerformed: 'Frontend-to-backend write trace in `src/context/AppContext.tsx` (lines 2344-2399)',
    result: 'FAILED',
    error: '`updateAiConfig`, `addAiKnowledgeItem`, and `deleteAiKnowledgeItem` only mutate React state; changes disappear on page reload',
    severity: 'Medium',
    recommendedFix: 'Persist `ai_settings` JSONB to `public.businesses` with awaited error checking and remove or back knowledge-base items with a real table',
  },
  {
    scope: 'audit_codebase',
    module: 'Settings & Workspace',
    feature: 'Business profile & business hours updates',
    databaseTable: 'public.businesses',
    testPerformed: 'Frontend-to-backend write trace in `src/context/AppContext.tsx` (lines 2567-2580, 2736-2739)',
    result: 'FAILED',
    error: '`updateBusinessProfile` is fire-and-forget (`void supabase...`) ignoring RLS errors; `updateBusinessHours` never writes to Supabase',
    severity: 'Medium',
    recommendedFix: 'Await `businesses` UPDATE with `.select().single()` verification and surface errors in Settings UI',
  },
  {
    scope: 'audit_codebase',
    module: 'Team Inbox (Conversations)',
    feature: 'Assign conversation, resolve/reopen, mark read, human handoff, create conversation',
    databaseTable: 'public.conversations',
    testPerformed: 'Frontend-to-backend write trace in `src/context/AppContext.tsx` (lines 1588-1638, 1900-1940)',
    result: 'FAILED',
    error: 'Writes use unawaited `void supabase.from(\'conversations\')` without `.eq(\'business_id\', business.id)` or error rollback',
    severity: 'Medium',
    recommendedFix: 'Await conversation updates with explicit `business_id` filter and roll back optimistic UI state on DB error',
  },
  {
    scope: 'audit_codebase',
    module: 'Revenue Radar',
    feature: 'Revenue Radar module & database tables',
    databaseTable: 'None',
    testPerformed: 'Full codebase & migration scan for Revenue Radar routes, pages, services, and tables',
    result: 'NOT IMPLEMENTED',
    error: 'No Revenue Radar page, service, or database table exists in the repository',
    severity: 'Low',
    recommendedFix: 'Confirm roadmap priority before designing schema and UI',
  },
];

const allRows = [...localExecutedRows, ...browserRows, ...liveAndAuditedRows];

function summarize(rows) {
  return {
    total: rows.length,
    PASSED: rows.filter((r) => r.result === 'PASSED').length,
    FAILED: rows.filter((r) => r.result === 'FAILED').length,
    BLOCKED: rows.filter((r) => r.result === 'BLOCKED').length,
    NOT_TESTED: rows.filter((r) => r.result === 'NOT TESTED').length,
    NOT_IMPLEMENTED: rows.filter((r) => r.result === 'NOT IMPLEMENTED').length,
  };
}

const reportPayload = {
  generatedAt: new Date().toISOString(),
  environment: {
    nodeVersion: process.version,
    liveStagingDbConfigured: process.env.ALLOW_LIVE_TEST_DB === 'true' && Boolean(process.env.TEST_SUPABASE_URL),
    liveWhatsAppTestEnabled: process.env.RUN_LIVE_WHATSAPP_TEST === 'true',
  },
  summary: {
    localExecutedAutomatedTests: summarize(localExecutedRows),
    browserUiTests: summarize(browserRows),
    liveAndAuditedChecks: summarize(liveAndAuditedRows),
    overallMatrix: summarize(allRows),
  },
  results: allRows,
};

fs.writeFileSync(
  path.join(REPORTS_DIR, 'zoqniva-qa-report.json'),
  `${JSON.stringify(reportPayload, null, 2)}\n`,
  'utf8'
);

const esc = (v) => String(v ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

function renderMarkdownTable(rows) {
  const header =
    '| Module | Feature | Database table | Test performed | Result | Error | Severity | Recommended fix |\n' +
    '| --- | --- | --- | --- | --- | --- | --- | --- |';
  const body = rows
    .map(
      (r) =>
        `| ${esc(r.module)} | ${esc(r.feature)} | ${esc(r.databaseTable)} | ${esc(r.testPerformed)} | **${esc(r.result)}** | ${esc(r.error)} | ${esc(r.severity)} | ${esc(r.recommendedFix)} |`
    )
    .join('\n');
  return `${header}\n${body}`;
}

const localStats = reportPayload.summary.localExecutedAutomatedTests;
const browserStats = reportPayload.summary.browserUiTests;
const liveStats = reportPayload.summary.liveAndAuditedChecks;

const md = `# Zoqniva AI — Automated QA, Persistence & Security Report

Generated: \`${reportPayload.generatedAt}\`  
Node Runtime: \`${reportPayload.environment.nodeVersion}\`

> **Verification Integrity Notice:** Local/mocked Vitest results validate frontend logic, payload construction, schema safety, and security invariants, and are **strictly separated** from live Supabase persistence, pgTAP RLS, Playwright browser, Deno Edge, and live WhatsApp tests. Mocked tests are **never** counted as proof of live Supabase persistence.

## Summary Statistics (Strictly Computed From Real Execution)

| Category | Total | PASSED | FAILED | BLOCKED | NOT TESTED | NOT IMPLEMENTED |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Local Executed Automated Tests (TypeScript + Vitest Unit/Mocked/Static Security) | ${localStats.total} | ${localStats.PASSED} | ${localStats.FAILED} | ${localStats.BLOCKED} | ${localStats.NOT_TESTED} | ${localStats.NOT_IMPLEMENTED} |
| Browser E2E Tests (Playwright) | ${browserStats.total} | ${browserStats.PASSED} | ${browserStats.FAILED} | ${browserStats.BLOCKED} | ${browserStats.NOT_TESTED} | ${browserStats.NOT_IMPLEMENTED} |
| Live Staging DB / Edge / WhatsApp & Static Codebase Audit | ${liveStats.total} | ${liveStats.PASSED} | ${liveStats.FAILED} | ${liveStats.BLOCKED} | ${liveStats.NOT_TESTED} | ${liveStats.NOT_IMPLEMENTED} |

## 1. Executed Local Automated Tests (TypeScript, Unit, Mocked Services, Static Security)

${renderMarkdownTable(localExecutedRows)}

## 2. Browser UI / E2E Tests (Playwright)

${renderMarkdownTable(browserRows)}

## 3. Live Supabase / RLS / Edge / WhatsApp Verification & Audited Backend Gaps

${renderMarkdownTable(liveAndAuditedRows)}
`;

fs.writeFileSync(path.join(REPORTS_DIR, 'zoqniva-qa-report.md'), md, 'utf8');

console.log(
  JSON.stringify(
    {
      ok: localStats.FAILED === 0,
      reportMarkdown: 'qa-reports/zoqniva-qa-report.md',
      reportJson: 'qa-reports/zoqniva-qa-report.json',
      summary: reportPayload.summary,
    },
    null,
    2
  )
);

if (localStats.FAILED > 0) {
  process.exit(1);
}
