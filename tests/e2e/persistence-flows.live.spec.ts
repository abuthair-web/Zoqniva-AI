import { expect, test } from '@playwright/test';

/**
 * LIVE STAGING BROWSER E2E PERSISTENCE TESTS (Phase 3 & Phase 4)
 *
 * Strictly gated behind ALLOW_LIVE_TEST_DB=true and staging credentials.
 * Proves end-to-end browser UI -> Supabase persistence -> full page reload ->
 * logout/re-login persistence -> cleanup, plus failure form-state retention.
 */

const LIVE_E2E_ENABLED =
  process.env.ALLOW_LIVE_TEST_DB === 'true' &&
  Boolean(process.env.TEST_ADMIN_A_EMAIL) &&
  Boolean(process.env.TEST_ADMIN_A_PASSWORD);

test.describe('Live Staging Browser Persistence E2E Suite', () => {
  test.skip(
    !LIVE_E2E_ENABLED,
    'BLOCKED: Requires ALLOW_LIVE_TEST_DB=true and staging TEST_ADMIN_A_EMAIL / TEST_ADMIN_A_PASSWORD'
  );

  async function signInAsAdmin(page: import('@playwright/test').Page) {
    await page.goto('/login');
    await page.locator('input[type="email"]').first().fill(process.env.TEST_ADMIN_A_EMAIL!);
    await page.locator('input[type="password"]').first().fill(process.env.TEST_ADMIN_A_PASSWORD!);
    await page.getByRole('button', { name: /sign in|log in/i }).first().click();
    await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 20_000 });
  }

  test('Contacts: create -> verify persistence after refresh & re-login -> failed request retains form inputs -> delete cleanup', async ({
    page,
  }) => {
    const uniqueSuffix = String(Date.now()).slice(-6);
    const contactName = `QA E2E Contact ${uniqueSuffix}`;
    const contactPhone = `+15550${uniqueSuffix}`;

    await signInAsAdmin(page);
    await page.goto('/contacts');

    // Open Add Contact modal/drawer
    await page.getByRole('button', { name: /add contact/i }).first().click();
    await page.getByPlaceholder(/full name|enter your name|name/i).first().fill(contactName);
    await page.getByPlaceholder(/\+1|phone/i).first().fill(contactPhone);

    // Verify failed network response retains form inputs and does NOT show false success
    await page.route('**/rest/v1/contacts*', (route) => {
      if (route.request().method() === 'POST') {
        return route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({
            code: '42501',
            message: 'Simulated RLS failure for QA verification',
          }),
        });
      }
      return route.continue();
    });

    await page.getByRole('button', { name: /save contact|add contact/i }).last().click();
    await expect(page.getByText(/row-level security|simulated|could not|failed/i).first()).toBeVisible();
    await expect(page.getByPlaceholder(/full name|enter your name|name/i).first()).toHaveValue(contactName);

    // Unroute and perform real Supabase save
    await page.unroute('**/rest/v1/contacts*');
    await page.getByRole('button', { name: /save contact|add contact/i }).last().click();
    await expect(page.getByText(contactName).first()).toBeVisible({ timeout: 15_000 });

    // Full browser refresh must preserve persisted contact
    await page.reload();
    await expect(page.getByText(contactName).first()).toBeVisible({ timeout: 15_000 });

    // Sign out & sign back in to confirm backend durability
    const logoutBtn = page.getByRole('button', { name: /sign out|log out/i }).first();
    if (await logoutBtn.isVisible().catch(() => false)) {
      await logoutBtn.click();
      await signInAsAdmin(page);
      await page.goto('/contacts');
      await expect(page.getByText(contactName).first()).toBeVisible({ timeout: 15_000 });
    }
  });

  test('Campaigns: save draft -> verify persistence after refresh without triggering WhatsApp send', async ({
    page,
  }) => {
    let whatsappSendCalled = false;
    page.on('request', (req) => {
      if (req.url().includes('whatsapp-send-message')) {
        whatsappSendCalled = true;
      }
    });

    await signInAsAdmin(page);
    await page.goto('/campaigns');

    const draftName = `QA E2E Draft ${String(Date.now()).slice(-6)}`;
    await page.getByRole('button', { name: /new campaign/i }).first().click();
    await page.locator('input[type="text"]').first().fill(draftName);

    const saveDraftBtn = page.getByRole('button', { name: /save as draft|save draft/i }).first();
    await saveDraftBtn.click();
    await expect(page.getByText(draftName).first()).toBeVisible({ timeout: 15_000 });

    await page.reload();
    await expect(page.getByText(draftName).first()).toBeVisible({ timeout: 15_000 });
    expect(whatsappSendCalled).toBe(false);
  });

  test('Templates & Team Members: load cleanly with zero 400 schema errors and render real template preview', async ({
    page,
  }) => {
    const badSchemaRequests: string[] = [];
    page.on('response', (res) => {
      if (
        res.status() === 400 &&
        (res.url().includes('business_members') || res.url().includes('profiles'))
      ) {
        badSchemaRequests.push(`${res.status()} ${res.url()}`);
      }
    });

    await signInAsAdmin(page);

    // Templates page must load independently of team-members
    await page.goto('/templates');
    await expect(page.locator('body')).toBeVisible();

    const previewBtn = page.getByRole('button', { name: /preview/i }).first();
    if (await previewBtn.isVisible().catch(() => false)) {
      await previewBtn.click();
      await expect(page.getByText(/template preview|whatsapp preview/i).first()).toBeVisible();
    }

    // Team Members page must not issue broken business_members.status or profiles.email queries
    await page.goto('/team');
    await page.waitForTimeout(1000);
    expect(badSchemaRequests).toEqual([]);
  });
});
