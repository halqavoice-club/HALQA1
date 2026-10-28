# GitHub Actions Workflows

## E2E Consent Testing (e2e-consent.yml)

Tests Voice Club microphone consent invariants against real LiveKit infrastructure.

### Required Repository Secrets

All secrets must be configured in **Settings > Secrets and variables > Actions**:

| Secret | Description | Example |
|--------|-------------|---------|
| `LIVEKIT_URL` | LiveKit server WebSocket URL | `wss://your-livekit.cloud` |
| `LIVEKIT_API_KEY` | LiveKit API key | `APIxxxxxxxxxxxxxxxx` |
| `LIVEKIT_API_SECRET` | LiveKit API secret | `secret-xxxxxxxxxxxxxxxxxxxxxxxxxx` |
| `E2E_CONSENT_ROOM_URL` | Frontend room URL template | `http://localhost:3000/voice/{roomName}` |
| `E2E_TEST_API_TOKEN` | Backend test API authorization token | (random 32+ char string) |
| `E2E_AUTH_STORAGE` | JSON object with `localStorage` key containing auth tokens | `{"localStorage":{"token":"jwt..."}}` |
| `E2E_TEST_USER_ID` | User ID for permission revocation tests | `user_xxxxxxxxxxxxxx` |

### Secret Generation

```bash
# Generate E2E_TEST_API_TOKEN
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Get E2E_AUTH_STORAGE (login as test user, inspect localStorage)
# In browser console after logging in:
JSON.stringify({ localStorage: { token: localStorage.getItem('token'), refreshToken: localStorage.getItem('refreshToken') } })
```

### Local Testing

Copy `backend/.env.test.example` to `backend/.env.test` and set all values.  
Copy `frontend/.env.local.example` to `frontend/.env.local` and set `NEXT_PUBLIC_API_URL=http://localhost:5000/api/v1`.

Start services:
```bash
# Terminal 1 — LiveKit
docker compose -f docker-compose.test.yml up livekit

# Terminal 2 — Backend
cd backend
cp .env.test.example .env.test
# Edit .env.test with real values
npm run dev

# Terminal 3 — Frontend
cd frontend
npm run dev

# Terminal 4 — Run tests
cd frontend
export E2E_CONSENT_ROOM_URL="http://localhost:3000/voice/{roomName}"
export E2E_TEST_API_TOKEN="<value from .env.test>"
export E2E_AUTH_STORAGE='{"localStorage":{"token":"<your-jwt>"}}'
export E2E_TEST_USER_ID="<your-user-id>"
npm run test:e2e
```

### Troubleshooting

- **Tests skip silently:** Check secrets are set correctly in repository settings.
- **"Test API authorization required":** Ensure `E2E_TEST_API_TOKEN` matches `backend/.env.test`.
- **"Cannot connect to LiveKit":** Verify `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` are correct.
- **"Room not found":** Backend must be running and test.routes.js must be enabled (`ENABLE_E2E_TEST_API=true`).
