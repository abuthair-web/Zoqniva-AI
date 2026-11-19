# Zoqniva AI — Automated Backend, Persistence & Security Testing Guide

This document explains how to configure, run, and interpret every layer of the Zoqniva AI automated QA system safely without touching production data or sending unintended WhatsApp messages.

---

## 1. Safety Principles

1. **Never run live database or E2E suites against production.** Always use a dedicated staging/testing Supabase project or local `supabase start` instance.
2. **Never disable Row-Level Security (RLS)** or embed `SUPABASE_SERVICE_ROLE_KEY` in frontend code or `.env` files prefixed with `VITE_`.
3. **Never send real WhatsApp campaigns in automated tests.** Campaign tests create `status = 'draft'` rows only and assert zero calls to `whatsapp-send-message`.
4. **Live Meta WhatsApp sending is opt-in only** (`RUN_LIVE_WHATSAPP_TEST=true`) and restricted to a single explicitly allowlisted test recipient phone number.
5. **Local/mocked tests never count as proof of live Supabase persistence.** Reports separate local executed tests from live database/browser/Edge results.

---

## 2. Environment Setup for Staging / Live Tests

Copy `.env.test.example` to `.env.test.local` (do not commit `.env.test.local`) and provision **two isolated test workspaces** (`TEST_BUSINESS_A_ID`, `TEST_BUSINESS_B_ID`) plus **4 authenticated staging accounts** (the 5th security role is an unauthenticated `anon` client):

| Security Role | Env Vars | Required `business_members` Row |
| --- | --- | --- |
| **1. Business A Admin** | `TEST_ADMIN_A_EMAIL` / `TEST_ADMIN_A_PASSWORD` | `business_id = A`, `role = 'admin'`, `is_active = true` |
| **2. Business A Agent** | `TEST_AGENT_A_EMAIL` / `TEST_AGENT_A_PASSWORD` | `business_id = A`, `role = 'agent'`, `is_active = true` |
| **3. Business B Admin** | `TEST_ADMIN_B_EMAIL` / `TEST_ADMIN_B_PASSWORD` | `business_id = B`, `role = 'admin'`, `is_active = true` |
| **4. Unauthenticated Visitor** | None (`anon` key only) | No auth session |
| **5. Inactive Staff Member** | `TEST_INACTIVE_EMAIL` / `TEST_INACTIVE_PASSWORD` | `business_id = A`, `role = 'agent'`, `is_active = false` |

Set `ALLOW_LIVE_TEST_DB=true` **only** when pointing at your non-production staging Supabase project.

---

## 3. Exact Commands to Run Each Test Suite

### A. CI-Safe Local Suite (No Live DB or Meta Credentials Required)

```bash
# 1. TypeScript strict check
npm run lint

# 2. Production Vite bundle check
npm run build

# 3. Unit tests (phone E.164, templates JSONB, contacts/campaigns persistence logic, mocked WhatsApp)
npm run test:unit

# 4. Static security & schema regression tests (secret leakage, dist bundle, legacy columns, Edge contracts)
npm run test:security

# 5. Mocked WhatsApp Cloud API integration tests only
npm run test:whatsapp

# 6. Full local CI pipeline + JSON & Markdown QA report generation
npm run test:ci
```

### B. Playwright Browser Tests

Install Chromium once locally:

```bash
npx playwright install --with-deps chromium
```

Run non-live browser UI & unauthenticated route-protection smoke tests:

```bash
npm run test:e2e
```

Run full staging browser persistence E2E tests (login → Add Contact → reload → re-login → Campaign Draft → Templates preview → Team Members):

```bash
set -a && source .env.test.local && set +a
npm run test:e2e:live
```

### C. Supabase Database Schema Audit & pgTAP RLS Tests

1. **Read-only live schema inspection** (safe on any DB — `SELECT` only, zero mutations):
   Run `tests/db/schema_audit_readonly.sql` in the Supabase SQL Editor or via `psql` to compare live columns, constraints, RLS policies, and `is_business_member()` / `is_business_admin()` helper definitions.

2. **Automated pgTAP constraints & 5-role RLS tests** (runs inside `BEGIN ... ROLLBACK;` leaving zero rows):
   ```bash
   supabase start
   npm run test:db
   ```

### D. Live Staging Supabase Integration & 5-Role RLS API Tests

```bash
set -a && source .env.test.local && set +a
npm run test:integration
npm run test:security:live
```

### E. Deno Edge Function Tests

```bash
# Static + cryptographic contract tests (no live endpoint required)
npm run test:edge

# Optional live staging Edge Function HTTP checks (OPTIONS CORS + 401 unauthenticated rejection)
EDGE_FUNCTIONS_BASE_URL="https://YOUR_STAGING_REF.supabase.co/functions/v1" npm run test:edge
```

### F. Explicitly Initiated Live WhatsApp Sandbox Verification (Manual Only)

Only run when you have verified your Meta sandbox allowlist in staging Settings:

```bash
set -a && source .env.test.local && set +a
npm run test:live:whatsapp
```

---

## 4. Interpreting QA Report Results

Running `npm run test:report` generates:
- `qa-reports/zoqniva-qa-report.md` (human-readable matrix)
- `qa-reports/zoqniva-qa-report.json` (machine-readable for CI dashboards)

Every row uses **one of five exact statuses**:

- **`PASSED`**: Executed automatically in this run and all assertions succeeded.
- **`FAILED`**: Executed automatically (or confirmed via static backend write trace) and a real defect was detected.
- **`BLOCKED`**: Suite is implemented and ready, but could not execute in the current environment because staging DB credentials, Chromium, Supabase CLI, or Deno are unavailable.
- **`NOT TESTED`**: Explicitly disabled by default (e.g., opt-in live WhatsApp send test).
- **`NOT IMPLEMENTED`**: Feature/module does not exist in the codebase (e.g., Revenue Radar).
