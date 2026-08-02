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
    // Log in first
    await page.goto('/login');
    await page.locator('input[type="email"], input[name="email"]').first().fill(
      process.env.E2E_TEST_EMAIL || 'test@halqa.app'
    );
    await page.locator('input[type="password"], input[name="password"]').first().fill(
      process.env.E2E_TEST_PASSWORD || 'Test1234!'
    );
    await page.locator('button[type="submit"]').first().click();
    await page.waitForURL(/dashboard|voice-club|home/, { timeout: 15000 });
  });

  test('voice room list loads and shows rooms or empty state', async ({ page }) => {
    await page.goto('/voice-club');

    // Either a list of rooms OR an empty state should be visible
    const roomsOrEmpty = page.locator(
      '[data-testid="voice-room-card"], [data-testid="empty-state"], .vc-room-card, button:has-text("Start Room"), button:has-text("Start a Room")'
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
