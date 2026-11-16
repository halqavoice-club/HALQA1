import { test, expect } from '@playwright/test';

/**
 * E2E -- Live class creation flow (teacher)
 * Requirement: 20.6
 *
 * Covers: navigate to live classes as teacher -> click create -> fill title
 *         -> submit -> assert live class appears in list
 */
test.describe('Live Class', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    // Skip entire suite if no real test credentials are configured.
    const email = process.env.E2E_TEACHER_EMAIL || process.env.E2E_TEST_EMAIL;
    const password = process.env.E2E_TEACHER_PASSWORD || process.env.E2E_TEST_PASSWORD;
    if (!email || !password || email === 'teacher@halqa.app' || email === 'test@halqa.app') {
      testInfo.skip(true, 'E2E credentials not configured — skipping live-class E2E suite');
      return;
    }
    await page.goto('/login');
    await page.locator('input[type="email"], input[name="email"]').first().fill(email);
    await page.locator('input[type="password"], input[name="password"]').first().fill(password);
    await page.locator('button[type="submit"]').first().click();
    // Wait until we leave /login -- different roles land on different routes (/feed, /admin etc.)
    await page.waitForURL(url => !url.pathname.includes('/login'), { timeout: 15000 });
  });

  test('live class list page loads', async ({ page }) => {
    await page.goto('/live-class');

    // Page should load -- either showing classes, a heading, or a create/empty state.
    // Use separate locators joined with .or() to avoid mixing CSS and text= syntax
    // in a single comma-separated string (causes Playwright parse errors).
    const headingOrButton = page.locator('h1, h2, [data-testid="live-class-list"]')
      .or(page.locator('button:has-text("Create")'))
      .or(page.locator('button:has-text("New Class")'))
      .or(page.getByText(/live class/i));

    await expect(headingOrButton.first()).toBeVisible({ timeout: 35000 });
  });

  test('teacher can create a live class', async ({ page }) => {
    await page.goto('/live-class');

    // Find the Go Live button (actual button text in page.tsx)
    const createBtn = page.locator(
      'button:has-text("Go Live"), button:has-text("Create"), button:has-text("New Class"), button:has-text("Schedule"), button:has-text("+ Class")'
    ).first();

    const createVisible = await createBtn.isVisible({ timeout: 8000 }).catch(() => false);
    if (!createVisible) {
      // Role may not be teacher -- skip
      test.skip();
      return;
    }

    await createBtn.click();

    // The CreateLiveClassModal is a 3-step wizard:
    //   Step 0: mode (Public Stream / School Class)
    //   Step 1: room type (Immediate / Scheduled / Permanent / Limited)
    //   Step 2: details (title input, description, features, submit)
    // The title input only appears at step 2. Navigate through the steps.

    // Step 0: Select "Public Live Stream" (always available, no school needed)
    const publicBtn = page.locator('button:has-text("Public Live Stream")').first();
    await expect(publicBtn).toBeVisible({ timeout: 8000 });
    await publicBtn.click();

    // Step 1: Select room type (default "Immediate" is pre-selected), click Continue
    const continueBtn = page.locator('button:has-text("Continue")').first();
    await expect(continueBtn).toBeVisible({ timeout: 8000 });
    await continueBtn.click();

    // Step 2: Details form should now be visible with a title input
    // The Input component uses react-hook-form register('title') which gives
    // name="title". The placeholder is 'e.g., Arabic Conversation Practice'.
    const titleInput = page.locator(
      'input[name="title"], input[placeholder*="title" i], input[placeholder*="class" i], input[placeholder*="Arabic" i]'
    ).first();
    await expect(titleInput).toBeVisible({ timeout: 8000 });

    const uniqueTitle = `E2E Test Class ${Date.now()}`;
    await titleInput.fill(uniqueTitle);

    // Submit the form -- the submit button text depends on room type:
    //   Immediate/Permanent: "Go Live Now"
    //   Scheduled: "Go Live"
    const submitBtn = page.locator(
      'button[type="submit"]:has-text("Go Live"), button[type="submit"]:has-text("Create"), button[type="submit"]:has-text("Schedule"), button[type="submit"]:has-text("Save")'
    ).first();
    await submitBtn.click();

    // The class should appear in the list (or redirect to the live room)
    // For immediate room type, the app redirects to /live-class/[id] directly.
    // For scheduled, it stays on the list. Check both outcomes.
    try {
      await expect(page.locator(`text=${uniqueTitle}`)).toBeVisible({ timeout: 15000 });
    } catch {
      // If redirected to the live room, the URL should contain /live-class/
      await expect(page).toHaveURL(/live-class\//, { timeout: 5000 });
    }
  });
});
