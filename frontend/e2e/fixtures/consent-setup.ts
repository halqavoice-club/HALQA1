import { test as base, expect } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Consent E2E fixture.
 *
 * Reads E2E_AUTH_STORAGE (a JSON string of saved Playwright storage state
 * produced by context.storageState()) from the environment and overrides
 * Playwright's built-in `storageState` fixture so the browser context is
 * created with the auth state already loaded — before the first navigation.
 *
 * This is the correct Playwright pattern for cookie-based auth (including
 * httpOnly cookies): passing storageState at context-creation time means the
 * cookies are present on the very first request, so the app never sees an
 * unauthenticated context and never redirects to /login.
 *
 * Manual injection via addCookies() + addInitScript() does NOT work reliably
 * for httpOnly cookies because those APIs inject state after the context
 * already exists, missing the browser's initial cookie check on first load.
 *
 * If E2E_AUTH_STORAGE is not set, the fixture throws — which causes the test
 * to fail with a clear message rather than silently skipping.
 */

type ConsentFixtures = {
  /** Absolute path to the temp file holding the parsed storageState JSON. */
  storageStatePath: string;
};

export const test = base.extend<ConsentFixtures>({
  // Override the built-in storageState fixture so Playwright injects auth
  // into the browser context before any navigation happens.
  storageState: async ({}, use) => {
    const authStorage = process.env.E2E_AUTH_STORAGE;
    if (!authStorage) {
      throw new Error(
        'E2E_AUTH_STORAGE environment variable is not set. ' +
        'Provide a JSON blob of saved Playwright storageState. ' +
        'See docs/e2e-auth-setup.md for how to generate it.'
      );
    }
    // Parse to validate, then re-serialize to ensure clean JSON.
    let parsed: unknown;
    try {
      parsed = JSON.parse(authStorage);
    } catch (e) {
      throw new Error('E2E_AUTH_STORAGE is not valid JSON: ' + (e as Error).message);
    }
    const tmpFile = path.join(os.tmpdir(), `e2e-auth-storage-${Date.now()}.json`);
    fs.writeFileSync(tmpFile, JSON.stringify(parsed));
    // Yielding the path string is what Playwright expects from the storageState
    // fixture — it uses this path when creating the BrowserContext.
    await use(tmpFile);
    // Cleanup after the test completes.
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  },

  // Expose the path separately so tests that need it for assertions can access it.
  storageStatePath: async ({ storageState }, use) => {
    // storageState is already the temp-file path at this point.
    await use(storageState as string);
  },
});

export { expect };
