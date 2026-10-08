import { test, expect } from '@playwright/test';

/**
 * E2E — Voice room join/leave flow
 * Requirement: 20.6
 *
 * Covers: navigate to voice page → room list loads → join room → room UI visible
 *         → leave room → back on room list
 *
 * Auth strategy: fresh login in beforeEach (same approach as auth.spec.ts).
 * The dashboard wraps everything in <ClientOnly> which calls /auth/refresh before
 * rendering. We wait for the loading spinner to disappear, which confirms that
 * ClientOnly's async init has completed and the page tree is mounted.
 */
test.describe('Voice Club', () => {
  test.beforeEach(async ({ page }) => {
    // Full login — same pattern as auth.spec.ts which passes consistently.
    await page.goto('/login');
    await page.locator('input[type="email"], input[name="email"]').first().fill(
      process.env.E2E_TEST_EMAIL || 'test@halqa.app'
    );
    await page.locator('input[type="password"], input[name="password"]').first().fill(
      process.env.E2E_TEST_PASSWORD || 'Test1234!'
    );
    await page.locator('button[type="submit"]').first().click();
    await page.waitForURL(url => !url.pathname.includes('/login'), { timeout: 15000 });

    // Wait for the post-login page to finish loading:
    // networkidle confirms ClientOnly's /auth/refresh call has completed.
    // .catch(() => {}) is intentional here ONLY — networkidle can timeout in slow
    // CI environments but the dashboard may still be functional; the subsequent
    // navigation to /voice-club will prove auth state.
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

    // Navigate to voice club
    await page.goto('/voice-club');

    // Wait for the URL to stabilise: either we stay on /voice-club (auth ok)
    // or DashboardContent redirects us to /login (refresh token failed).
    // This replaces the swallowed spinner wait — it is a hard assertion that
    // fails the test immediately if auth was lost, rather than silently continuing
    // to a guaranteed 15-second timeout.
    await page.waitForURL(
      url => url.pathname.includes('/voice-club') || url.pathname.includes('/login'),
      { timeout: 20000 }
    );

    // Fail fast and clearly if auth did not survive the navigation.
    const afterNavUrl = page.url();
    if (afterNavUrl.includes('/login')) {
      throw new Error(
        `Auth session was lost after navigating to /voice-club. ` +
        `Redirected to: ${afterNavUrl}. ` +
        `Check that the seed user exists and the backend /auth/refresh endpoint is reachable.`
      );
    }

    // Auth is confirmed. Wait for ClientOnly to finish mounting (networkidle)
    // so DashboardContent has resolved its spinner before the test body runs.
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  });

  test('voice room list loads and shows rooms or empty state', async ({ page }) => {
    // The voice-club-page container is rendered once ClientOnly finishes mounting.
    await expect(page.locator('[data-testid="voice-club-page"]')).toBeVisible({ timeout: 15000 });

    // Assert either rooms, empty state, or the page UI controls are present.
    const roomsOrEmpty = page.locator(
      '[data-testid="voice-room-card"], .vc-room-card, ' +
      'button:has-text("Start Room"), button:has-text("Start a Room"), ' +
      'text=No rooms yet, button:has-text("Discover")'
    );
    await expect(roomsOrEmpty.first()).toBeVisible({ timeout: 10000 });
  });

  test('user can join and leave a voice room', async ({ page }) => {
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
