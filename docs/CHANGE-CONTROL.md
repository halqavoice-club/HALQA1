# HALQA — Change Control Process

**Version:** 1.0  
**Audit date:** 2026-08-26  
**Rule:** All changes affecting authorization, permissions, realtime, LiveKit, or financial operations must follow this process.

---

## The Golden Rule

```
DOCUMENT → REVIEW → IMPLEMENT → TEST → AUDIT → DEPLOY

Never: CODE → BREAK → DOCUMENT
```

---

## Step-by-Step Process

### Step 1 — Read Relevant Documentation

Before touching any file, read:

| Change area | Must read |
|------------|-----------|
| SUPER_ADMIN behavior | `docs/authorization/SUPER-ADMIN-MASTER-SPEC.md` |
| Any authorization | `docs/authorization/permission-model.md` |
| Live Class | `docs/live-class/permissions.md`, `lifecycle.md`, `realtime.md` |
| Live Stream | `docs/live-stream/permissions.md`, `overview.md` |
| Voice Club | `docs/voice-club/permissions.md`, `lifecycle.md` |
| Feed/Social | `docs/feed-social/feed-system.md`, `security.md` |
| Payments/Gifts | `docs/gifts-payments/coins-wallet.md`, `gifts.md` |
| Socket.IO | `docs/authorization/realtime-architecture.md` |
| LiveKit | `docs/authorization/livekit-architecture.md` |
| Any violation fix | `docs/MASTER-VIOLATIONS.md` for the specific violation |

### Step 2 — Identify Affected Models

Using `docs/MASTER-DEPENDENCY-MAP.md`:
1. Which Prisma models are read or written?
2. Which indexes are affected?
3. Are new migrations needed?
4. Does the change affect any soft-delete logic?

### Step 3 — Identify Affected APIs

1. Which routes change behavior?
2. Which middleware is affected?
3. Are new authorization checks needed?
4. Do rate limits need updating?
5. Does the API contract change for existing clients?

### Step 4 — Identify Permissions

1. Does the change alter who can do what?
2. Does it add or remove a SUPER_ADMIN bypass?
3. Does it change school isolation?
4. Must it be in `docs/authorization/api-permissions.md`?
5. Check `docs/MASTER-PRODUCTION-INVARIANTS.md` — does any invariant apply?

### Step 5 — Identify Realtime Effects

1. Which Socket.IO rooms are affected?
2. Are new socket events emitted or removed?
3. Is socket room authorization affected?
4. Are there reconnect implications?

### Step 6 — Identify UI/Mobile Dependencies

1. Which frontend pages/components need updating?
2. Which mobile screens are affected?
3. Are existing API client calls still valid?
4. Does the change break any cached state in Zustand stores?

### Step 7 — Identify Tests

1. Which existing test files cover this area?
2. Do existing tests assert the old behavior that is being changed?
3. What new tests are needed?
4. Reference `docs/MASTER-VIOLATIONS.md` — does the change fix a documented violation? If so, a test must be added.

### Step 8 — Update Documentation FIRST

**Before writing implementation code:**
1. Update or add to the relevant docs in `docs/`
2. Update `docs/MASTER-VIOLATIONS.md` if a violation is being fixed (Status: FIXED, with PR reference)
3. Update `docs/DOCUMENTATION-STATUS.md` if coverage changes

### Step 9 — Implement the Change

Apply the code change with clear commit messages that reference:
- The violation ID if fixing a known violation (e.g., `fix: LCSV-001 — remove SUPER_ADMIN from isTeacher check`)
- The invariant if enforcing one (e.g., `enforce: INVARIANT-007 — server-side relay auth for screen share`)

### Step 10 — Run Regression Tests

```bash
# Backend unit tests
cd backend && npm run test:unit

# Integration tests (requires MySQL + Redis)
npm run test:integration

# Specific security tests
npx jest --testPathPattern="p0-security|live-class-p0|super-admin-scope|platform-admin-scope"

# Frontend tests
cd frontend && npm test
```

For violation fixes, verify the specific test case:
- LCSV-001 → `live-class-p1-reliability.test.js: SUPER_ADMIN without school membership is denied`
- SVSV-001 → add new test to `super-admin-scope.test.js`

### Step 11 — Re-Audit Authorization

After the change:
1. Does `git diff` show any authorization bypass being added?
2. Does the change introduce any new `if (role === 'SUPER_ADMIN')` conditions in content participation code?
3. Does the change remove an existing security check?

If any of these are true, stop and review with the team.

### Step 12 — Confirm Production Invariants

Run through the checklist in `docs/MASTER-PRODUCTION-INVARIANTS.md`:
```
[ ] INVARIANT-001 through INVARIANT-016
```

No invariant may be violated by the deployed change.

### Step 13 — Review Git Diff

```bash
git diff --stat
git diff -- backend/ frontend/ mobile/
```

Verify:
- Only expected files are modified
- No accidental deletion of security middleware
- No commented-out authorization checks
- No credentials in code

### Step 14 — Deploy After Approval

1. Open a PR with the change
2. PR description must reference the violation ID, invariant, or feature area
3. PR must include the test results
4. At least one reviewer must approve
5. CI must pass (lint, unit, integration, docker build)
6. Deploy using the standard pipeline (DO-004: migrations before restart)

---

## Emergency Hotfix Process

For critical security fixes (CRITICAL/HIGH severity violations):

1. Create a hotfix branch from `main`
2. Apply minimum necessary change
3. Run security-specific tests: `npx jest --testPathPattern="p0-security|super-admin-scope"`
4. Get expedited review from at least one team member
5. Deploy with same CI gates (cannot be skipped)
6. Backport to `develop` branch
7. Update `docs/MASTER-VIOLATIONS.md` Status to FIXED

---

## What Requires Change Control (Mandatory)

| Change type | Required |
|------------|---------|
| Adding/removing `authorize()` middleware | ✅ |
| Changing school isolation logic | ✅ |
| Adding/removing SUPER_ADMIN conditions | ✅ |
| Modifying token generation (LiveKit) | ✅ |
| Changing socket room authorization | ✅ |
| Modifying wallet/coin/diamond operations | ✅ |
| Adding new admin API endpoints | ✅ |
| Changing role assignment in joinRoom/joinLiveClass | ✅ |
| Modifying the kick/ban flow | ✅ |
| Adding new Socket.IO event handlers | ✅ |

## What Does NOT Require Full Change Control

| Change type | Required |
|------------|---------|
| UI styling changes | ❌ |
| Adding new non-auth API fields | ❌ |
| Fixing typos in error messages | ❌ |
| Documentation-only changes | ❌ |
| Adding logging | ❌ |
| Performance optimizations with no auth impact | ❌ |
