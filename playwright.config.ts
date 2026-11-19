import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL || 'http://127.0.0.1:3000';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [
    ['list'],
    ['json', { outputFile: 'qa-reports/playwright-results.json' }],
  ],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  webServer: process.env.E2E_SKIP_WEBSERVER === 'true'
    ? undefined
    : {
        command: 'npm run dev',
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
      },
  projects: [
    {
      name: 'browser-ui',
      testMatch: /smoke-and-error-handling\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'live-e2e',
      testMatch: /persistence-flows\.live\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
