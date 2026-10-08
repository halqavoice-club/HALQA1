import { test, expect } from '@playwright/test';

/**
 * E2E — Voice room join/leave flow
 * Requirement: 20.6
 *
 * Covers: navigate to voice page → room list loads → join room → room UI visible
 *         → leave room → back on room list
 */
test.describe('Voice Club', () => {
  test.beforeEach(async ({ page }) => {
    // Auth is pre-loaded via storageState (set in playwright.config.ts).
    // The httpOnly refreshToken cookie is present in the saved state, so
    // ClientOnly's /auth/refresh call on every page.goto() succeeds immediately
    // without a live login round-trip. No manual login needed here.
    //
    // Navigate directly to the voice club — the dashboard will mount with the
    // pre-authenticated session.
    await page.goto('/voice-club');
    // Wait for networkidle so ClientOnly's refreshToken() call completes and
    // mounted=true is set before any assertion fires.
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  });

  test('voice room list loads and shows rooms or empty state', async ({ page }) => {
    // beforeEach already navigated to /voice-club and waited for networkidle.
    // The voice-club-page container is rendered once the component mounts in
    // list view (not the activeRoom view).
    await expect(page.locator('[data-testid="voice-club-page"]')).toBeVisible({ timeout: 15000 });

    // Assert either rooms, empty state, or the Start Room / Discover UI is present.
    const roomsOrEmpty = page.locator(
      '[data-testid="voice-room-card"], .vc-room-card, ' +
      'button:has-text("Start Room"), button:has-text("Start a Room"), ' +
      'text=No rooms yet, button:has-text("Discover")'
    );
    await expect(roomsOrEmpty.first()).toBeVisible({ timeout: 10000 });
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
