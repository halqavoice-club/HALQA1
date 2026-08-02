import { defineConfig, devices } from '@playwright/test';

/**
 * HALQA E2E Test Configuration
 * Requirements: 20.6
 *
 * Run: npx playwright test
 * Report: npx playwright show-report
 */
export default defineConfig({
  testDir: './e2e',
  /* Run tests in parallel */
  fullyParallel: false,
  /* Fail the build on CI if test.only is left */
  forbidOnly: !!process.env.CI,
  /* Retry on CI */
  retries: process.env.CI ? 2 : 0,
  /* Workers */
  workers: process.env.CI ? 1 : undefined,
  /* Reporter */
  reporter: process.env.CI ? 'github' : 'html',

  use: {
    /* Base URL for all tests */
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:3000',
    /* Collect traces on failure for debugging */
    trace: 'on-first-retry',
    /* Screenshot on failure */
    screenshot: 'only-on-failure',
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
