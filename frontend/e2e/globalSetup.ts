import { chromium, FullConfig } from '@playwright/test';
import path from 'path';
import fs from 'fs';

/**
 * Global setup — run once before all tests.
 *
 * Logs in as the E2E test student, waits for the dashboard to fully mount
 * (including ClientOnly's refreshToken() call completing), then saves the
 * browser context state (cookies + localStorage) to e2e/.auth/student.json.
 *
 * This storageState is loaded by every test in the 'chromium' project via
 * playwright.config.ts, so each test starts pre-authenticated without a
 * live login round-trip. The ClientOnly component will still call
 * /auth/refresh on each page.goto(), but the httpOnly refreshToken cookie
 * is now present in the saved state and the call will succeed immediately.
 */
export default async function globalSetup(config: FullConfig) {
  const baseURL =
    process.env.PLAYWRIGHT_BASE_URL ||
    process.env.E2E_BASE_URL ||
    'http://localhost:3000';

  const authFile = path.join(__dirname, '.auth', 'student.json');

  // Ensure the .auth directory exists
  const authDir = path.dirname(authFile);
  if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true });
  }

  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();

  // Navigate to login
  await page.goto('/login');

  // Fill credentials
  await page.locator('input[type="email"], input[name="email"]').first().fill(
    process.env.E2E_TEST_EMAIL || 'test@halqa.app'
  );
  await page.locator('input[type="password"], input[name="password"]').first().fill(
    process.env.E2E_TEST_PASSWORD || 'Test1234!'
  );
  await page.locator('button[type="submit"]').first().click();

  // Wait for redirect away from login
  await page.waitForURL(url => !url.pathname.includes('/login'), { timeout: 20000 });

  // Wait for the dashboard to fully mount — ClientOnly awaits /auth/refresh
  // before setting mounted=true. networkidle guarantees that call has completed
  // and the httpOnly refreshToken cookie has been set/rotated.
  await page.waitForLoadState('networkidle', { timeout: 15000 });

  // Extra guard: confirm the main shell is visible so we know auth is fully settled
  await page.waitForSelector('nav, main, [data-testid="sidebar"], aside', { timeout: 10000 })
    .catch(() => { /* non-fatal — networkidle is sufficient */ });

  // Save the authenticated browser context (cookies + localStorage) to disk.
  // This includes the httpOnly refreshToken cookie that ClientOnly needs.
  await context.storageState({ path: authFile });

  await browser.close();
}
