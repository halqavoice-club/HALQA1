import { defineConfig, devices } from '@playwright/test';

/**
 * HALQA E2E Test Configuration
 * Requirements: 20.6
 *
 * Config lives at frontend/playwright.config.ts (project root for the frontend
 * package). Playwright resolves testDir relative to this file's location, so
 * testDir: './e2e' correctly points to frontend/e2e/ where the specs live.
 *
 * Run: npx playwright test
 * Report: npx playwright show-report
 */
export default defineConfig({
  testDir: './e2e',
  /* Run tests sequentially in CI to avoid port conflicts */
  fullyParallel: false,
  /* Fail the build on CI if test.only is left */
  forbidOnly: !!process.env.CI,
  /* Retry on CI */
  retries: process.env.CI ? 2 : 0,
  /* Per-test timeout — two full page navigations (login + voice-club) can take
   * up to 30s each on a loaded CI runner; default 30s is too tight. */
  timeout: process.env.CI ? 60000 : 30000,
  /* Workers */
  workers: process.env.CI ? 1 : undefined,
  /* Reporter */
  reporter: process.env.CI ? 'github' : 'html',

  use: {
    /* Base URL for all tests.
     * Reads PLAYWRIGHT_BASE_URL (set by CI) with fallback to E2E_BASE_URL
     * (legacy local usage) then to http://localhost:3000. */
    baseURL: process.env.PLAYWRIGHT_BASE_URL || process.env.E2E_BASE_URL || 'http://localhost:3000',
    /* Collect traces on failure for debugging */
    trace: 'on-first-retry',
    /* Screenshot on failure */
    screenshot: 'only-on-failure',
    /* Next.js 16 is slower at initial hydration than 14; bump default
     * action/navigation timeouts to avoid flaky failures on first render. */
    actionTimeout: 20000,
    navigationTimeout: 30000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  /* Start the Next.js dev server before running tests if not already running */
  webServer: process.env.CI ? undefined : {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 120 * 1000,
  },
});
