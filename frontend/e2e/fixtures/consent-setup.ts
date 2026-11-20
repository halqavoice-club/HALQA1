import { test as base, expect } from '@playwright/test';

/**
 * Consent E2E fixture.
 *
 * Performs a real login via the app's /login page before each test so the
 * browser context is fully authenticated: the httpOnly refresh cookie is set
 * by the backend response, and the auth store's in-memory access token is
 * populated by the login form handler.
 *
 * This replaces the previous storageState injection approach, which could not
 * work because:
 *   - The access token is memory-only (FE-001: never in localStorage/cookies)
 *   - The httpOnly refresh cookie is signed with the CI backend's JWT secret,
 *     so a token saved from a different environment is always rejected
 *
 * Required env vars:
 *   E2E_TEST_EMAIL     — email of the seeded test user (student1@halqa.com)
 *   E2E_TEST_PASSWORD  — password of the seeded test user (Student@2024)
 *
 * Both vars are supplied by e2e-consent.yml from repository secrets.
 * No E2E_AUTH_STORAGE secret is needed.
 */

export const test = base.extend({
  /**
   * Override the page fixture to log in before each test body runs.
   * Tests receive an already-authenticated page and do not need to handle auth.
   */
  page: async ({ page }, use) => {
    const email = process.env.E2E_TEST_EMAIL;
    const password = process.env.E2E_TEST_PASSWORD;

    if (!email || !password) {
      throw new Error(
        'E2E_TEST_EMAIL and E2E_TEST_PASSWORD must be set. ' +
        'These are the seeded test user credentials used by the consent E2E suite.'
      );
    }

    // Navigate to the login page and authenticate.
    // Using the real form flow ensures both the httpOnly refresh cookie and the
    // in-memory access token (via the auth store) are set before any test navigation.
    await page.goto('/login');
    await page.fill('#email', email);
    await page.fill('#password', password);
    await page.click('button[type="submit"]');

    // Wait until the app redirects away from /login (dashboard or any non-auth page)
    await page.waitForURL(url => !url.pathname.startsWith('/login'), { timeout: 20000 });

    // Hand the authenticated page to the test
    await use(page);
  },
});

export { expect };
