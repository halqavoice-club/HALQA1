import { test, expect } from './fixtures/consent-setup';

/**
 * E2E — Voice room join/leave flow
 * Requirement: 20.6
 *
 * Covers: navigate to voice page → room list loads → join room → room UI visible
 *         → leave room → back on room list
 *
 * Auth: The consent-setup fixture overrides the page fixture to perform a real
 * login via the /login form before each test. No storageState injection or
 * E2E_AUTH_STORAGE secret is needed.
 *
 * Required env vars (supplied by e2e-consent.yml):
 *   E2E_TEST_EMAIL     — seeded test user email
 *   E2E_TEST_PASSWORD  — seeded test user password
 *   E2E_CONSENT_ROOM_URL — optional: direct URL to a voice room for join/leave test
 */
test.describe('Voice Club', () => {
  test.beforeEach(async ({ page }) => {
    // The page fixture in consent-setup.ts has already performed login and
    // waited for the redirect away from /login. Here we just confirm the
    // dashboard shell is fully hydrated before navigating to feature pages.
    await page.waitForSelector('[data-testid="dashboard-shell"], .sidebar, nav', { timeout: 20000 });
  });

  test('voice room list loads and shows rooms or empty state', async ({ page }) => {
    await page.goto('/voice-club');

    // Either a list of rooms OR an empty state should be visible.
    const roomsOrEmpty = page.locator(
      '[data-testid="voice-room-card"], [data-testid="empty-state"], .vc-room-card, button:has-text("Start Room"), button:has-text("Start a Room")'
    );
    await expect(roomsOrEmpty.first()).toBeVisible({ timeout: 35000 });
  });

  test('user can join and leave a voice room', async ({ page }) => {
    await page.goto('/voice-club');

    // Try to find a Join button on any room card.
    const joinBtn = page.locator('button:has-text("Join"), button:has-text("Enter")').first();

    const joinVisible = await joinBtn.isVisible().catch(() => false);
    if (!joinVisible) {
      // No rooms available — skip the join/leave part.
      test.skip();
      return;
    }

    await joinBtn.click();

    // Room UI should be visible (contains Leave button or mic controls).
    const roomUI = page.locator('button:has-text("Leave"), .vc-bar-btn, [aria-label="Leave class"]');
    await expect(roomUI.first()).toBeVisible({ timeout: 15000 });

    // Leave the room.
    const leaveBtn = page.locator('button:has-text("Leave")').first();
    await leaveBtn.click();

    // Should be back on the room list.
    await expect(page).toHaveURL(/voice-club/, { timeout: 10000 });
  });
});
