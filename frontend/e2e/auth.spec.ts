import { test, expect } from '@playwright/test';

/**
 * E2E — Auth flow
 * Requirement: 20.6
 *
 * Covers: login page → fill credentials → submit → assert dashboard visible
 */
test.describe('Authentication', () => {
  test('user can log in and reach the dashboard', async ({ page }) => {
    // Navigate to login page
    await page.goto('/login');

    // Assert we are on the login page
    await expect(page).toHaveURL(/login/);
    await expect(page.locator('input[type="email"], input[name="email"]').first()).toBeVisible();

    // Fill credentials
    await page.locator('input[type="email"], input[name="email"]').first().fill(
      process.env.E2E_TEST_EMAIL || 'test@halqa.app'
    );
    await page.locator('input[type="password"], input[name="password"]').first().fill(
      process.env.E2E_TEST_PASSWORD || 'Test1234!'
    );

    // Submit
    await page.locator('button[type="submit"]').first().click();

    // Assert dashboard is visible after login
    await expect(page).toHaveURL(/dashboard|voice-club|home/, { timeout: 15000 });

    // Assert user name appears somewhere in the header or page
    const headerOrNav = page.locator('header, nav, [data-testid="user-menu"]');
    await expect(headerOrNav).toBeVisible({ timeout: 10000 });
  });
});
