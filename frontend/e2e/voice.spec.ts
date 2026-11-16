import { test, expect } from '@playwright/test';

/**
 * E2E — Voice room join/leave flow
 * Requirement: 20.6
 *
 * Covers: navigate to voice page → room list loads → join room → room UI visible
 *         → leave room → back on room list
 *
 * Skip condition: E2E_TEST_EMAIL must be set to a real account that exists in
 * the target database. Without a real account, login fails and all tests in
 * this suite would fail at beforeEach. Use E2E_AUTH_STORAGE for pre-authenticated
 * sessions (see fixtures/consent-setup.ts) in environments with a seeded test user.
 */
test.describe('Voice Club', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    // Skip entire suite if no real test credentials are configured.
    // The default fallback values (test@halqa.app / Test1234!) do not exist in
    // a fresh CI database, so attempting login would cause every test to fail at
    // the waitForURL step. Skip cleanly instead.
    const email = process.env.E2E_TEST_EMAIL;
    const password = process.env.E2E_TEST_PASSWORD;
    if (!email || !password || email === 'test@halqa.app') {
      testInfo.skip(true, 'E2E_TEST_EMAIL / E2E_TEST_PASSWORD not configured — skipping voice E2E suite');
      return;
    }

    // Log in first
    await page.goto('/login');
    await page.locator('input[type="email"], input[name="email"]').first().fill(email);
    await page.locator('input[type="password"], input[name="password"]').first().fill(password);
    await page.locator('button[type="submit"]').first().click();
    // Wait until we have navigated away from /login — different roles land on
    // different routes (/feed, /admin, /dashboard) so we match any non-login URL.
    await page.waitForURL(url => !url.pathname.includes('/login'), { timeout: 15000 });
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
