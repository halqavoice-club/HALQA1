# E2E Auth Setup — Voice Consent Tests

The Voice Club consent E2E suite (`frontend/e2e/voice.spec.ts`) authenticates by
performing a real login via the app's `/login` page before each test. This is handled
automatically by the fixture in `frontend/e2e/fixtures/consent-setup.ts`.

No pre-saved storage state is required. The fixture uses `E2E_TEST_EMAIL` and
`E2E_TEST_PASSWORD` to log in, which sets the httpOnly refresh cookie and the
in-memory access token through the normal app login flow.

---

## Why not use Playwright storageState?

The app stores the access token **in memory only** (security requirement FE-001 —
never in localStorage or cookies). The refresh token is stored in an `httpOnly`
`SameSite=strict` cookie.

A saved storageState cannot restore an authenticated session because:

1. The access token is gone on every page load — it must be re-issued via
   `POST /auth/refresh`.
2. The refresh cookie is signed with the backend's JWT secret. A token saved from
   one environment (e.g. your local dev) will always be rejected by a CI backend
   with a different secret.

The only reliable approach is a real login against the same backend that runs in CI.

---

## Required secrets

| Secret | Description |
|---|---|
| `E2E_TEST_PASSWORD` | Password for `student1@halqa.com` (seeded by `seed.js`) |
| `E2E_TEST_USER_ID` | User ID of the test user (from seed output or database) |
| `E2E_TEST_API_TOKEN` | Shared secret for the backend test API (`/api/test/*`) |
| `E2E_CONSENT_ROOM_URL` | Optional direct URL to a voice room for join/leave test |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | LiveKit credentials |

The email `student1@halqa.com` is hardcoded in the workflow — it is always created
by `seed.js` and does not need a secret.

---

## Setting secrets in GitHub

1. Go to **Settings → Secrets and variables → Actions**.
2. Click **New repository secret** for each secret above.
3. For `E2E_TEST_PASSWORD`: use the password matching the `student1@halqa.com`
   account as defined in `backend/src/prisma/seed.js`.

To find the current seeded password:

```bash
grep -A5 "student1@halqa.com" backend/src/prisma/seed.js
```

---

## How the fixture works

`frontend/e2e/fixtures/consent-setup.ts` overrides Playwright's `page` fixture:

1. Navigates to `/login`.
2. Fills `#email` and `#password` from `E2E_TEST_EMAIL` / `E2E_TEST_PASSWORD`.
3. Clicks the submit button.
4. Waits for the redirect away from `/login` (the app redirects to the dashboard
   on successful login).
5. Passes the authenticated page to the test.

The login sets both the httpOnly refresh cookie (via the backend `Set-Cookie`
response header) and the in-memory access token (via the auth store login handler).
Subsequent navigations within the test use the already-authenticated context.

---

## Which tests use this

| Workflow | File | Secrets required |
|---|---|---|
| `e2e-consent.yml` → `web-consent` | `frontend/e2e/voice.spec.ts` | `E2E_TEST_PASSWORD` + others above |
| `ci.yml` → `Frontend -- Playwright E2E` | all specs **except** `voice.spec.ts` | none (excluded via `--grep-invert "Voice Club"`) |
