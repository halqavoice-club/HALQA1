# Backend E2E Test API

## Overview

The backend exposes guarded test-only routes under `/api/test/*` for E2E consent testing.  
These routes are **ONLY** available when:

1. `NODE_ENV=test`
2. `ENABLE_E2E_TEST_API=true`
3. `x-e2e-test-token` header matches `E2E_TEST_API_TOKEN` env var

**Security:** These routes return 404 in production (`NODE_ENV !== 'test'`).

## Required Environment Variables

Copy `backend/.env.test.example` to `backend/.env.test` and set:

| Variable | Description | Example |
|----------|-------------|---------|
| `NODE_ENV` | Must be `test` | `test` |
| `ENABLE_E2E_TEST_API` | Must be `true` | `true` |
| `E2E_TEST_API_TOKEN` | Shared secret for test API auth | `random-32-char-string` |
| `DATABASE_URL` | MySQL connection string | `mysql://root:password@localhost:3306/halqa_test` |
| `JWT_SECRET` | JWT signing key (min 32 chars) | `test-jwt-secret-min-32-chars-placeholder!!!!` |
| `JWT_REFRESH_SECRET` | Refresh token signing key | `test-refresh-secret-min-32-chars-placeholder!!` |
| `LIVEKIT_URL` | LiveKit server URL | `ws://127.0.0.1:7880` |
| `LIVEKIT_API_KEY` | LiveKit API key | `devkey` |
| `LIVEKIT_API_SECRET` | LiveKit API secret | `devsecret-devsecret-devsecret-devsecret` |
| `PAYOUT_ENCRYPTION_KEY` | Required by validateEnv() | `test-payout-key-32bytes-placeholder!!!!` |
| `PORT` | Backend port | `5000` |
| `CLIENT_URL` | Frontend URL for CORS | `http://localhost:3000` |
| `SERVICE_NAME` | Service identifier | `halqa-test` |
| `STORAGE_TYPE` | Storage backend | `local` |
| `HEALTH_TOKEN` | Health endpoint token | `test-health-token-placeholder!!` |
| `METRICS_TOKEN` | Metrics endpoint token | `test-metrics-token-placeholder!!` |
| `REDIS_URL` | Redis URL (optional) | `redis://localhost:6379` |

## Setup

### 1. Create Test Database

```bash
mysql -u root -p
CREATE DATABASE halqa_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
exit
```

### 2. Configure Environment

```bash
cd backend
cp .env.test.example .env.test
# Edit .env.test — set DATABASE_URL, JWT_SECRET, LIVEKIT_*, E2E_TEST_API_TOKEN
```

### 3. Run Migrations and Seed

```bash
npx prisma migrate deploy
node src/prisma/seed.js
```

This creates:
- Test users (student1@halqa.com, teacher@halqa-academy.com, admin@halqa.com)
- Test school (Halqa Academy)
- Test roles and permissions

### 4. Start Backend

```bash
npm run dev
# Backend listens on http://localhost:5000
# Health check: curl http://localhost:5000/health
```

## Available Test Routes

All routes require `x-e2e-test-token` header matching `E2E_TEST_API_TOKEN`.

### POST /api/test/voice/set-permission

**Purpose:** Remotely revoke/grant SFU canPublish permission (simulates moderator mute during network disconnect).  
**Used by:** frontend/e2e/voice-consent.spec.ts W4 test (permission revocation).

**Request:**
```json
{
  "roomId": "consent-test-room",
  "userId": "user_xxxxxxxxxxxxxx",
  "canPublish": false
}
```

**Response:**
```json
{
  "enforced": true,
  "previousState": { "canPublish": true },
  "newState": { "canPublish": false }
}
```

**Example:**
```bash
curl -X POST http://localhost:5000/api/test/voice/set-permission \
  -H "Content-Type: application/json" \
  -H "x-e2e-test-token: local-e2e-test-token-change-in-ci-and-github-secrets" \
  -d '{"roomId":"test-room","userId":"user_123","canPublish":false}'
```

### POST /api/test/livekit/rooms

**Purpose:** Create a LiveKit room for testing.  
**Used by:** frontend/e2e/fixtures/consent-setup.ts (room provisioning).

**Request:**
```json
{
  "roomName": "consent-test-room"
}
```

**Response:**
```json
{
  "room": {
    "sid": "RM_xxxxxxxxxxxxxxxxxxxxx",
    "name": "consent-test-room",
    "emptyTimeout": 300,
    "maxParticipants": 0,
    "creationTime": "1698765432",
    "turnPassword": "...",
    "enabledCodecs": [...],
    "metadata": "",
    "numParticipants": 0,
    "numPublishers": 0,
    "activeRecording": false
  }
}
```

### POST /api/test/livekit/rooms/delete

**Purpose:** Delete a LiveKit room after tests complete.  
**Used by:** frontend/e2e/fixtures/consent-setup.ts (cleanup).

**Request:**
```json
{
  "roomName": "consent-test-room"
}
```

**Response:** 204 No Content

## Running E2E Tests

### Prerequisites

1. **LiveKit server** must be running (via docker-compose.test.yml or standalone).
2. **Backend** must be running (`npm run dev` with `.env.test` configured).
3. **Frontend** must be running (`npm run dev` in frontend/ directory).

### Web (Playwright)

```bash
# Terminal 1 — LiveKit
docker compose -f docker-compose.test.yml up livekit

# Terminal 2 — Backend
cd backend
npm run dev

# Terminal 3 — Frontend
cd frontend
npm run dev

# Terminal 4 — Run tests
cd frontend
export E2E_CONSENT_ROOM_URL="http://localhost:3000/voice/{roomName}"
export E2E_TEST_API_TOKEN="local-e2e-test-token-change-in-ci-and-github-secrets"
export E2E_AUTH_STORAGE='{"localStorage":{"token":"<your-jwt-token>"}}'
export E2E_TEST_USER_ID="<your-user-id>"
npm run test:e2e
```

### Mobile (Detox)

```bash
# Same LiveKit + Backend + Frontend setup as above

# Terminal 4 — Run mobile tests
cd mobile
npm install
npx expo prebuild  # Generate native projects

# iOS
npm run test:e2e:build:ios
npm run test:e2e:ios

# Android
npm run test:e2e:build:android
npm run test:e2e:android
```

## Test Environment Variables Summary

### Backend (`.env.test`)
- `NODE_ENV=test`
- `ENABLE_E2E_TEST_API=true`
- `E2E_TEST_API_TOKEN` — shared secret
- `DATABASE_URL` — test database
- `JWT_SECRET`, `JWT_REFRESH_SECRET` — token signing
- `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` — LiveKit connection
- `PAYOUT_ENCRYPTION_KEY` — required by validateEnv()
- All other vars from `.env.test.example`

### Frontend (shell environment for Playwright)
- `E2E_CONSENT_ROOM_URL` — room URL template (e.g., `http://localhost:3000/voice/{roomName}`)
- `E2E_TEST_API_TOKEN` — must match backend
- `E2E_AUTH_STORAGE` — JSON with localStorage auth tokens
- `E2E_TEST_USER_ID` — user ID for permission revocation tests

### Mobile (shell environment for Detox)
Same as frontend; passed via shell export or Detox config.

## Generating Test Tokens

### E2E_TEST_API_TOKEN
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### E2E_AUTH_STORAGE
1. Start backend + frontend
2. Login as a test user in browser
3. Open browser console:
```javascript
JSON.stringify({
  localStorage: {
    token: localStorage.getItem('token'),
    refreshToken: localStorage.getItem('refreshToken')
  }
})
```
4. Copy the output and use as `E2E_AUTH_STORAGE` value

### E2E_TEST_USER_ID
Use the `id` field from the test user created by `seed.js` (check database or backend logs).

## Troubleshooting

### Backend won't start
- Check `DATABASE_URL` points to an accessible MySQL instance
- Ensure `JWT_SECRET` and `JWT_REFRESH_SECRET` are at least 32 characters
- Verify `PAYOUT_ENCRYPTION_KEY` is set (required by validateEnv())

### Tests skip with "Test API authorization required"
- Verify `E2E_TEST_API_TOKEN` matches in both backend `.env.test` and frontend shell environment
- Check `ENABLE_E2E_TEST_API=true` in backend `.env.test`
- Confirm `NODE_ENV=test` in backend `.env.test`

### Tests fail with "Room not found"
- Backend must be running before tests start
- Check backend logs for errors during room creation
- Verify `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` are correct

### LiveKit connection fails
- Ensure LiveKit server is running (`docker compose -f docker-compose.test.yml up livekit`)
- Verify `LIVEKIT_URL` uses `ws://` (not `wss://`) for local dev server
- Check LiveKit API key/secret match the dev server config

### Playwright tests cannot connect to frontend
- Frontend must be running on port 3000 (`npm run dev` in frontend/)
- Check `E2E_CONSENT_ROOM_URL` points to `http://localhost:3000/voice/{roomName}`
- Verify no other process is using port 3000

## Security Notes

- Test API routes are **only** accessible when `NODE_ENV=test`
- Routes return 404 (not 403) in non-test environments to avoid disclosure
- `E2E_TEST_API_TOKEN` should be rotated regularly and never committed to git
- Test database should be isolated from production data
- LiveKit dev server credentials (`devkey` / `devsecret...`) are for local testing only
