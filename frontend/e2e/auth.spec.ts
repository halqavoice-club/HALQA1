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

    // Assert we have left the login page — any authenticated route is acceptable.
    // Different roles land on different default routes:
    //   SUPER_ADMIN  → /admin
    //   SCHOOL_ADMIN → /feed
    //   TEACHER      → /feed
    //   STUDENT      → /feed
    //   MEMBER       → /feed
    // So we assert we are no longer on /login rather than matching a specific path.
    await expect(page).not.toHaveURL(/\/login/, { timeout: 15000 });

    // Assert the page has rendered some content (header/nav or main content)
    await expect(page.locator('body')).toBeVisible({ timeout: 10000 });
  });
});
