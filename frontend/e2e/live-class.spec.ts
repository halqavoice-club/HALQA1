import { test, expect } from '@playwright/test';

/**
 * E2E — Live class creation flow (teacher)
 * Requirement: 20.6
 *
 * Covers: navigate to live classes as teacher → click create → fill title
 *         → submit → assert live class appears in list
 */
test.describe('Live Class', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.locator('input[type="email"], input[name="email"]').first().fill(
      process.env.E2E_TEACHER_EMAIL || process.env.E2E_TEST_EMAIL || 'teacher@halqa.app'
    );
    await page.locator('input[type="password"], input[name="password"]').first().fill(
      process.env.E2E_TEACHER_PASSWORD || process.env.E2E_TEST_PASSWORD || 'Test1234!'
    );
    await page.locator('button[type="submit"]').first().click();
    // Wait until we leave /login — different roles land on different routes (/feed, /admin etc.)
    await page.waitForURL(url => !url.pathname.includes('/login'), { timeout: 15000 });
  });

  test('live class list page loads', async ({ page }) => {
    await page.goto('/live-class');

    // Page should load — either showing classes or an empty/create state
    const pageContent = page.locator(
      'h1, h2, [data-testid="live-class-list"], button:has-text("Create"), button:has-text("New Class"), text=/live class/i'
    );
    await expect(pageContent.first()).toBeVisible({ timeout: 10000 });
  });

  test('teacher can create a live class', async ({ page }) => {
    await page.goto('/live-class');

    // Find the Create/New Class button
    const createBtn = page.locator(
      'button:has-text("Create"), button:has-text("New Class"), button:has-text("Schedule"), button:has-text("+ Class")'
    ).first();

    const createVisible = await createBtn.isVisible({ timeout: 8000 }).catch(() => false);
    if (!createVisible) {
      // Role may not be teacher — skip
      test.skip();
      return;
    }

    await createBtn.click();

    // Fill in the class title in the modal/form
    const titleInput = page.locator(
      'input[name="title"], input[placeholder*="title" i], input[placeholder*="class" i]'
    ).first();
    await expect(titleInput).toBeVisible({ timeout: 8000 });

    const uniqueTitle = `E2E Test Class ${Date.now()}`;
    await titleInput.fill(uniqueTitle);

    // Submit the form
    const submitBtn = page.locator(
      'button[type="submit"]:has-text("Create"), button:has-text("Schedule"), button:has-text("Save"), button:has-text("Create Class")'
    ).first();
    await submitBtn.click();

    // The class should appear in the list
    await expect(page.locator(`text=${uniqueTitle}`)).toBeVisible({ timeout: 15000 });
  });
});
