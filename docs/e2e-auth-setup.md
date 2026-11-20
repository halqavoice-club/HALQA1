# E2E Auth Setup — Voice Consent Tests

The Voice Club consent E2E suite (`frontend/e2e/voice.spec.ts`) authenticates via a
pre-saved Playwright storage state rather than logging in with email/password on every
run. This avoids flaky auth flows in CI and keeps the consent tests focused on the voice
room UI, not the login form.

## What is `E2E_AUTH_STORAGE`?

It is a JSON string containing a serialised Playwright
[`storageState`](https://playwright.dev/docs/auth#reuse-signed-in-state) object:

```json
{
  "cookies": [...],
  "origins": [
    {
      "origin": "http://localhost:3000",
      "localStorage": [
        { "name": "accessToken", "value": "eyJ..." },
        { "name": "refreshToken", "value": "eyJ..." }
      ]
    }
  ]
}
```

The fixture in `frontend/e2e/fixtures/consent-setup.ts` reads this value, writes it to a
temp file, and overrides Playwright's built-in `storageState` fixture — so every browser
context in the suite starts already authenticated.

---

## How to generate it

Run this once from a machine that can reach a local or staging instance of the app.

### 1. Start the stack

```bash
cd backend && npm run dev &
cd frontend && npm run dev &
```

### 2. Run the helper script

```bash
cd frontend
node scripts/save-e2e-auth.js
```

The script opens a Chromium window, navigates to `http://localhost:3000`, logs in with
the test user credentials below, then calls `context.storageState()` and prints the
JSON to stdout.

> If the script doesn't exist yet, use the manual steps in the next section.

### 3. Manual approach (Playwright REPL)

```ts
// scripts/save-e2e-auth.js  (run with: node scripts/save-e2e-auth.js)
// Set E2E_TEST_EMAIL and E2E_TEST_PASSWORD in your local shell before running.
const { chromium } = require('@playwright/test');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Log in as the E2E test user (credentials from local env, never hardcoded)
  await page.goto('http://localhost:3000/login');
  await page.fill('input[name="email"]', process.env.E2E_TEST_EMAIL);
  await page.fill('input[name="password"]', process.env.E2E_TEST_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(url => !url.pathname.includes('/login'), { timeout: 15000 });

  // Save the authenticated state
  const state = await context.storageState();
  console.log(JSON.stringify(state));

  await browser.close();
})();
```

Redirect the output to a file:

```bash
node scripts/save-e2e-auth.js > /tmp/auth-state.json
```

Verify the file contains cookies and/or localStorage entries, then compact it:

```bash
cat /tmp/auth-state.json | jq -c '.' > /tmp/auth-state-compact.json
```

---

## Setting the GitHub secret

1. Copy the compact JSON value from `/tmp/auth-state-compact.json`.
2. In the repository, go to **Settings → Secrets and variables → Actions**.
3. Click **New repository secret**.
4. Name: `E2E_AUTH_STORAGE`
5. Value: paste the JSON string (single line).
6. Click **Add secret**.

The `e2e-consent.yml` workflow reads this secret and passes it as the
`E2E_AUTH_STORAGE` environment variable to the test run.

---

## Rotating the secret

JWTs expire. If `web-consent` starts failing with a login redirect again, regenerate
the storage state using the steps above and update the `E2E_AUTH_STORAGE` secret in
GitHub.

The access token lifetime is 15 minutes; the refresh token lasts 7 days. The storage
state is valid as long as the refresh token has not expired and has not been revoked.

---

## Which tests use this

| Workflow | File | Secret required |
|---|---|---|
| `e2e-consent.yml` → `web-consent` | `frontend/e2e/voice.spec.ts` | `E2E_AUTH_STORAGE` |
| `ci.yml` → `Frontend -- Playwright E2E` | all specs **except** `voice.spec.ts` | ✗ (excluded via `--grep-invert`) |
