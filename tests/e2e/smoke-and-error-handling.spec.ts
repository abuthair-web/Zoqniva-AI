import { expect, test } from '@playwright/test';

/**
 * NON-LIVE BROWSER UI & SECURITY REGRESSION TESTS (CI-Safe)
 *
 * Verifies real browser rendering, unauthenticated route protection,
 * zero secret exposure in client storage/window, and clean error states
 * without mutating any live database.
 */

test.describe('Zoqniva AI Browser UI & Unauthenticated Security Smoke Suite', () => {
  test('renders landing page without uncaught runtime errors or secret leaks', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto('/');
    await expect(page.locator('body')).toBeVisible();
    expect(pageErrors).toEqual([]);

    const leakedSecrets = await page.evaluate(() => {
      const html = document.documentElement.innerHTML;
      const storageDump = JSON.stringify({ ...localStorage, ...sessionStorage });
      const combined = `${html}\n${storageDump}`;
      return {
        hasServiceRole: /SUPABASE_SERVICE_ROLE_KEY/i.test(combined),
        hasMetaToken: /EAAG[A-Za-z0-9]{25,}/.test(combined),
      };
    });

    expect(leakedSecrets.hasServiceRole).toBe(false);
    expect(leakedSecrets.hasMetaToken).toBe(false);
  });

  test('renders login route cleanly with email/password inputs', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto('/login');
    await expect(page.locator('input[type="email"], input[name="email"]').first()).toBeVisible();
    await expect(page.locator('input[type="password"]').first()).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test('blocks unauthenticated visitors from protected CRM routes', async ({ page }) => {
    for (const route of ['/contacts', '/campaigns', '/templates', '/settings', '/team']) {
      await page.goto(route);
      await page.waitForTimeout(300);
      // Unauthenticated users must never see authenticated workspace tables; they see login or config guard
      const url = page.url();
      const bodyText = await page.locator('body').innerText();
      const guarded =
        url.includes('/login') ||
        /sign in|log in|supabase|workspace access/i.test(bodyText);
      expect(guarded, `Protected route ${route} was not guarded for unauthenticated user`).toBe(
        true
      );
    }
  });
});
