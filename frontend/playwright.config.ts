import { defineConfig, devices } from '@playwright/test';
import path from 'path';

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

/** Path to the saved auth state produced by globalSetup.ts */
const STUDENT_AUTH = path.join(__dirname, 'e2e', '.auth', 'student.json');

export default defineConfig({
  testDir: './e2e',
  /* Run tests sequentially in CI to avoid port conflicts */
  fullyParallel: false,
  /* Fail the build on CI if test.only is left */
  forbidOnly: !!process.env.CI,
  /* Retry on CI */
  retries: process.env.CI ? 2 : 0,
  /* Workers */
  workers: process.env.CI ? 1 : undefined,
  /* Reporter */
  reporter: process.env.CI ? 'github' : 'html',

  /* Global setup — runs once before all tests.
   * Logs in as the E2E test student and saves the browser context state
   * (cookies + localStorage, including the httpOnly refreshToken cookie)
   * to e2e/.auth/student.json so tests can start pre-authenticated. */
  globalSetup: require.resolve('./e2e/globalSetup'),

  use: {
    /* Base URL for all tests.
     * Reads PLAYWRIGHT_BASE_URL (set by CI) with fallback to E2E_BASE_URL
     * (legacy local usage) then to http://localhost:3000. */
    baseURL: process.env.PLAYWRIGHT_BASE_URL || process.env.E2E_BASE_URL || 'http://localhost:3000',
    /* Collect traces on failure for debugging */
    trace: 'on-first-retry',
    /* Screenshot on failure */
    screenshot: 'only-on-failure',
  },

  projects: [
    /* Auth spec — runs without storageState so it tests the real login flow */
    {
      name: 'auth',
      testMatch: '**/auth.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    /* All other specs — use pre-saved auth state to avoid per-test login overhead.
     * The httpOnly refreshToken cookie in the saved state means ClientOnly's
     * /auth/refresh call succeeds immediately on every page.goto(), eliminating
     * the timing race that caused voice.spec.ts to fail. */
    {
      name: 'chromium',
      testIgnore: '**/auth.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        storageState: STUDENT_AUTH,
      },
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
