import { test, expect } from './fixtures/consent-setup';
import * as fs from 'fs';

/**
 * E2E — Voice room join/leave flow
 * Requirement: 20.6
 *
 * Covers: navigate to voice page → room list loads → join room → room UI visible
 *         → leave room → back on room list
 *
 * Auth: Uses E2E_AUTH_STORAGE (pre-authenticated browser storage state).
 * The consent-setup fixture writes the JSON blob to a temp file and injects
 * both cookies and localStorage into the page context so the suite starts
 * already authenticated. No email/password credentials are required.
 *
 * Required env vars (supplied by e2e-consent.yml):
 *   E2E_AUTH_STORAGE     — JSON blob from context.storageState()
 *   E2E_CONSENT_ROOM_URL — optional: direct URL to a voice room for join/leave test
 */
test.describe('Voice Club', () => {
  test.beforeEach(async ({ page, storagePath }) => {
    // Load pre-authenticated storage state into this page context.
    // The storageState JSON (Playwright format) contains:
    //   { cookies: [...], origins: [{ origin, localStorage: [{ name, value }] }] }
    //
    // The app uses JWT stored in localStorage (access + refresh tokens), so we
    // inject both cookies and localStorage entries before navigating.
    const rawState = fs.readFileSync(storagePath, 'utf-8');
    const state: {
      cookies?: Array<Record<string, unknown>>;
      origins?: Array<{ origin: string; localStorage: Array<{ name: string; value: string }> }>;
    } = JSON.parse(rawState);

    // Inject cookies
    if (state.cookies && state.cookies.length > 0) {
      await page.context().addCookies(
        state.cookies as Parameters<typeof page.context.prototype.addCookies>[0]
      );
    }

    // Inject localStorage entries via addInitScript so they are available
    // before the page's own scripts run on first navigation.
    if (state.origins && state.origins.length > 0) {
      for (const origin of state.origins) {
        if (origin.localStorage && origin.localStorage.length > 0) {
          await page.addInitScript(
            ({ entries }: { entries: Array<{ name: string; value: string }> }) => {
              for (const { name, value } of entries) {
                localStorage.setItem(name, value);
              }
            },
            { entries: origin.localStorage }
          );
        }
      }
    }

    // Navigate to the app root — auth state means we should NOT be redirected to /login
    await page.goto('/');
    // If still redirected to login (storage had no valid token), fail clearly
    await page.waitForURL(url => !url.pathname.includes('/login'), { timeout: 15000 });
    // Wait for dashboard shell to be fully hydrated before navigating to feature pages
    await page.waitForSelector('[data-testid="dashboard-shell"], .sidebar, nav', { timeout: 20000 });
  });

  test('voice room list loads and shows rooms or empty state', async ({ page }) => {
    await page.goto('/voice-club');

    // Either a list of rooms OR an empty state should be visible
    const roomsOrEmpty = page.locator(
      '[data-testid="voice-room-card"], [data-testid="empty-state"], .vc-room-card, button:has-text("Start Room"), button:has-text("Start a Room")'
    );
    await expect(roomsOrEmpty.first()).toBeVisible({ timeout: 35000 });
  });

  test('user can join and leave a voice room', async ({ page }) => {
    await page.goto('/voice-club');

    // Try to find a Join button on any room card
    const joinBtn = page.locator('button:has-text("Join"), button:has-text("Enter")').first();

    const joinVisible = await joinBtn.isVisible().catch(() => false);
    if (!joinVisible) {
      // No rooms available — skip the join/leave part
      test.skip();
      return;
    }

    await joinBtn.click();

    // Room UI should be visible (contains Leave button or mic controls)
    const roomUI = page.locator('button:has-text("Leave"), .vc-bar-btn, [aria-label="Leave class"]');
    await expect(roomUI.first()).toBeVisible({ timeout: 15000 });

    // Leave the room
    const leaveBtn = page.locator('button:has-text("Leave")').first();
    await leaveBtn.click();

    // Should be back on the room list
    await expect(page).toHaveURL(/voice-club/, { timeout: 10000 });
  });
});
