import { test as base, expect } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Consent E2E fixture.
 *
 * Reads E2E_AUTH_STORAGE (a JSON string of saved Playwright storage state
 * produced by context.storageState()) from the environment and writes it to a
 * temp file so Playwright can load it as the browser context's storageState.
 *
 * This lets the consent suite run without an email/password login flow: the
 * browser context starts already authenticated.
 *
 * If E2E_AUTH_STORAGE is not set, the fixture throws — which causes the test
 * to fail with a clear message rather than silently skipping.
 */
export const test = base.extend<{ storagePath: string }>({
  storagePath: async ({}, use) => {
    const authStorage = process.env.E2E_AUTH_STORAGE;
    if (!authStorage) {
      throw new Error(
        'E2E_AUTH_STORAGE environment variable is not set. ' +
        'Provide a JSON blob of saved Playwright storageState. ' +
        'See docs/e2e-auth-setup.md for how to generate it.'
      );
    }
    // Parse to validate, then re-serialize to ensure clean JSON
    let parsed: unknown;
    try {
      parsed = JSON.parse(authStorage);
    } catch (e) {
      throw new Error('E2E_AUTH_STORAGE is not valid JSON: ' + (e as Error).message);
    }
    const tmpFile = path.join(os.tmpdir(), `e2e-auth-storage-${Date.now()}.json`);
    fs.writeFileSync(tmpFile, JSON.stringify(parsed));
    await use(tmpFile);
    // Cleanup
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  },
});

export { expect };
