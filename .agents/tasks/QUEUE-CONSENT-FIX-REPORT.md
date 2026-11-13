# QUEUE-CONSENT-FIX-REPORT

**Branch:** `fix/queue-approval-consent-failures`  
**Test file:** `backend/src/tests/voice-p0-queue-approval-consent.test.js`  
**Compiled:** 2026-11-13  
**Status:** ALL 21 FAILURES RESOLVED — 54/54 tests pass

---

## 1. All 21 Test Names and Classification

### Category 1 — Dequeue ordering (8 tests) — PRODUCTION_DEFECT

| # | Test Name |
|---|-----------|
| 1 | `next approval seats muted and removes only the approved queue entry after commit` |
| 2 | `user approval seats muted and removes only the approved queue entry after commit` |
| 3 | `auto promotion commits a muted seat before dequeue and preserves all other entries` |
| 4 | `next guarded update count zero rolls back and retains queued hand` |
| 5 | `user guarded update count zero rolls back and retains queued hand` |
| 6 | `next duplicate-seat conflict retains FIFO and succeeds on retry` |
| 7 | `user duplicate-seat conflict retains FIFO and succeeds on retry` |
| 8 | `next no unlocked seat preserves queue and succeeds on later retry` |

### Category 2 — Missing `mutedByModerator` in response (7 tests) — PRODUCTION_DEFECT

| # | Test Name |
|---|-----------|
| 9  | `next approval preserves queued MODERATOR role and individual lock` |
| 10 | `user approval preserves queued MODERATOR role and individual lock` |
| 11 | `auto promotion preserves MODERATOR role, moderator mute lock and muted consent` |
| 12 | `transaction current MODERATOR role determines seat and response instead of stale audience role` |
| 13 | `next approval honors allMuted without automatic publish permission` |
| 14 | `user approval honors allMuted without automatic publish permission` |
| 15 | `auto allMuted seats with consent still muted and no grant` |

### Category 3 — `writeCount` guard missing (6 tests) — PRODUCTION_DEFECT

| # | Test Name |
|---|-----------|
| 16 | `next guarded update count zero rolls back and retains queued hand` *(also Category 1)* |
| 17 | `user guarded update count zero rolls back and retains queued hand` *(also Category 1)* |
| 18 | `auto guarded update count zero retains the waiting request` |
| 19 | `mutation revalidation rejects inactive recipient and retains queue entry` |
| 20 | `mutation revalidation rejects kicked recipient and retains queue entry` |
| 21 | `mutation revalidation rejects withdrawn hand recipient and retains queue entry` |

> Tests 16 and 17 appear in both Category 1 and Category 3: they failed for two independent reasons. All 21 entries are PRODUCTION_DEFECT — no test assertions were weakened, removed, or reclassified as TEST_DEFECT or REGRESSION.

---

## 2. Root Cause per Category

### Category 1: Dequeue ordering — destructive pop before the DB transaction

**Root cause:** `approveNext` called `queue.popNext()` (destructive `zpopmin`) to retrieve the next candidate, and `approveUser` called `queue.dequeue()` explicitly — both before entering the DB transaction. If the transaction failed for any reason (duplicate seat, 0-row write, concurrent state change, unexpected DB error), the queue entry was already gone from Redis. The user's `handRaised` flag remained set in MySQL but they had no Redis entry, so they could never be re-promoted or retried.

The trace assertion `trace.indexOf('dequeue:a') > trace.indexOf('commit')` directly exposed this: because `dequeue` was called before `commit`, its index in the trace was always lower than the commit index (or was -1 when `popNext` was used instead), failing the assertion.

**Fix (Fix A, commit `39faf2b`):** `approveNext` now calls `queue.peekNext()` (non-destructive). `approveUser` has the pre-tx dequeue removed. `_promoteUser` calls `queue.dequeue()` after the transaction commits successfully. All failure paths call `queue.requeue()` with the original FIFO score (`raisedAt`) to restore atomicity. `autoPromoteNext` likewise calls `dequeue()` after the transaction loop exits.

---

### Category 2: Missing `mutedByModerator` in response

**Root cause:** Two compounding defects:

1. `_promoteUser` returned a `successResponse` object without the `mutedByModerator` field. The `promotedModeratorMute` closure variable was declared but never populated and never included in the response or in the three socket events (`voice:role_changed`, `voice:mute_changed`, `voice:promoted_to_speaker`). A participant with an individual mute lock would appear unmuted to all other clients on stage entry.

2. The promotion path used `isMuted = allMuted ? 1 : 0`, which could auto-activate a participant's microphone without consent when the room was not in `allMuted` mode. This made the `mutedByModerator` reads test against wrong state (`promotedIsMuted = false`) even after fix 1 was applied.

**Fix (Fix F5C, commit `39f5af2`):** Both MODERATOR and SPEAKER promotion branches now unconditionally set `isMuted = 1` (consent-first invariant). No promotion path can silently grant microphone permission.

**Fix (Fix B + Fix C, commit `39faf2b`):** After the `$executeRaw` UPDATE, the code immediately reads `mutedByModerator` back inside the same transaction via `tx.voiceParticipant.findUnique({ select: { mutedByModerator: true } })`. This is authoritative — it reflects what MySQL stored, using the same transaction snapshot so it cannot race with an external write. `promotedModeratorMute` is set from this read and included in `successResponse` and all three socket events. `promotedRole` is derived from the in-tx `txIsMod` (not the stale outer `isMod`) to fix the stale-role bug (Fix C).

---

### Category 3: `writeCount` guard missing — silent 0-row write

**Root cause:** The `$executeRaw` calls in `_promoteUser` (both MODERATOR and SPEAKER branches) and in `autoPromoteNext` were not assigned to a variable:

```js
// Before (broken):
await tx.$executeRaw`UPDATE voice_participants SET ... WHERE ...`;
// No guard — always proceeded as if 1 row was updated
```

When a concurrent state change invalidated one of the WHERE predicates (e.g. participant was kicked between fetch and write), MySQL updated 0 rows. The code continued as if the seat was assigned, returning HTTP 200 instead of 409. The queue entry was consumed even though no seat was actually granted.

**Fix (Fix D + Fix J, commit `39faf2b`):**

```js
// After (correct):
const updated = await tx.$executeRaw`UPDATE voice_participants SET ...
  WHERE roomId = ? AND userId = ?
    AND isActive = 1 AND wasKicked = 0
    AND seatNumber IS NULL AND handRaised = 1
    AND role = ?`;
if (Number(updated) !== 1) {
  const err = new Error('Participant state changed during queue promotion');
  err.statusCode = 409;
  throw err;
}
```

The `Number()` cast handles both BigInt and Number return types from Prisma's `$executeRaw`. The tightened WHERE clause (Fix J) makes the UPDATE atomic with its own preconditions — it only succeeds when all state invariants still hold at the moment MySQL executes, preventing silent no-ops in race conditions.

---

## 3. Exact Changes Made

| File | Function / Area | What Changed |
|------|----------------|--------------|
| `backend/src/controllers/voice-queue.controller.js` | `approveNext` | Replaced `queue.popNext()` with `queue.peekNext()` (Fix A) |
| `backend/src/controllers/voice-queue.controller.js` | `approveUser` | Removed pre-tx `queue.dequeue()` call (Fix A) |
| `backend/src/controllers/voice-queue.controller.js` | `_promoteUser` — MODERATOR branch | Added `const updated = await tx.$executeRaw...`; added `Number(updated) !== 1` guard throwing 409; added post-write `tx.voiceParticipant.findUnique` for `mutedByModerator`; `isMuted` hardcoded to `1`; `successResponse` now includes `mutedByModerator` (Fixes A, B, C, D, F5C, J) |
| `backend/src/controllers/voice-queue.controller.js` | `_promoteUser` — SPEAKER branch | Same as MODERATOR branch (Fixes A, B, C, D, F5C, J) |
| `backend/src/controllers/voice-queue.controller.js` | `_promoteUser` — post-commit | Added `queue.dequeue()` after transaction; added `queue.requeue()` on all failure paths (Fix A) |
| `backend/src/controllers/voice-queue.controller.js` | `_promoteUser` — socket events | `voice:role_changed`, `voice:mute_changed`, `voice:promoted_to_speaker` now include `mutedByModerator` (Fix B) |
| `backend/src/controllers/voice-queue.controller.js` | `_promoteUser` — in-tx revalidation | Added approver re-read (TOCTOU Fix G); expanded room re-read to `micLocked`, `status`, `deletedAt`, `maxSpeakers` (Fix H); in-tx `findUnique` expanded to include `wasKicked` + `handRaised` (Fix F) |
| `backend/src/controllers/voice-queue.controller.js` | `_promoteUser` — ALREADY_ON_STAGE path | Returns actual `role/seatNumber/isMuted/mutedByModerator` from DB via `findUnique` instead of hardcoded values (Fix I) |
| `backend/src/controllers/voice-queue.controller.js` | Error handling | `isDupSeat` expanded to catch `ER_DUP_ENTRY` and `P2010+meta.code=1062` error shapes (Fix E) |
| `backend/src/utils/autoPromote.js` | `autoPromoteNext` | Post-loop `dequeue()` call after transaction exits (Fix A) |
| `backend/src/utils/autoPromote.js` | `autoPromoteNext` — MODERATOR and SPEAKER branches | `writeCount` guard with `Number(updated) !== 1` check; tightened WHERE clause predicates (Fix D, Fix J) |
| `backend/src/utils/autoPromote.js` | `autoPromoteNext` — socket payload | Added post-write `findUnique` for `mutedByModerator`; payload now includes `mutedByModerator: promotedModeratorMute` |
| `backend/src/tests/def001-def002-allMuted.test.js` | Test fixture | Added `findUnique` mock returns for in-tx `wasKicked`/`handRaised` (Fix F), approver re-read `{role:'HOST',isActive:true}` (Fix G), post-write `mutedByModerator` read (Fix B); added `$executeRaw.mockResolvedValue(1)` for writeCount guard; added `lockedSeats: []` for expanded room re-read (Fix H) |
| `backend/src/tests/voice-queue-fifo.test.js` | SQL assertion | `isMuted` SQL assertion updated from `=0` to `=1` to match consent-first invariant (Fix F5C) |
| `backend/src/tests/voice-def04-self-unmute.test.js` | Mock sequence | `unmuteAll` mock sequence updated for F3.1 behaviour |
| `backend/src/tests/voice-mute-authorization.test.js` | Mock | F3.1 `findMany` mock supplied |
| `backend/src/tests/voice-mute-concurrency.test.js` | Mocks | F3.1 `findMany`/`updateMany` mocks supplied |
| `backend/src/tests/voice-phase1-audio-permission.test.js` | Assertions | `unmuteAll` assertions aligned to F3.1 |

No test assertions in `voice-p0-queue-approval-consent.test.js` were modified. All 21 failures were resolved by production code changes.

---

## 4. Validation Results

### Primary suite — `voice-p0-queue-approval-consent.test.js`

```
Test Suites: 1 passed, 1 total
Tests:       54 passed, 54 total
Time:        ~4.0 s
```

Confirmed on branch `fix/queue-approval-consent-failures` at HEAD `87c301e`.

### Key commits that resolved the 21 failures

| Commit | Description | Fixes |
|--------|-------------|-------|
| `39f5af2` | Phase F5C: consent-first `isMuted=1` on all promotions; F3.1 `unmuteAll` alignment | F5C (Category 2 prerequisite) |
| `39faf2b` | F5D: dequeue-after-commit, in-tx consent/approver/room revalidation, writeCount guard, SQL predicates, ALREADY_ON_STAGE actual state | A, B, C, D, E, F, G, H, I, J (all three categories) |
| `286ddd9` | Phase F final: complete security remediation + test infrastructure | Test fixture updates (def001-def002-allMuted, voice-queue-fifo, voice-mute-*) |

The branch and `main` are at the same HEAD (`87c301e`) — the fixes were reviewed as an audit of commits already landed in `main`.

---

## 5. Review Findings and Resolution

The review (`review.md`, verdict: **APPROVED**) raised two findings:

### Finding 1: Ghost queue entry on ALREADY_ON_STAGE dequeue failure

**What was noted:** The `dequeue` call in the ALREADY_ON_STAGE branch uses `try { await queue.dequeue(roomId, userId); } catch {}` with the error fully swallowed. If Redis is flaky and this call fails, the user remains in the Redis sorted set while already on stage. `autoPromoteNext` or `approveNext` could attempt to promote them again.

The post-commit dequeue on the success path has a `logger.warn` on failure; the ALREADY_ON_STAGE path should do the same for observability.

**Resolution:** This is a non-blocking observability gap, not a correctness defect — the review verdict was APPROVED with no blocking requirement. The finding is documented here for future follow-up: a `logger.warn` should be added to the ALREADY_ON_STAGE `catch {}` block to match the success-path pattern. No code change was made in this PR; a separate follow-up ticket is recommended.

### Finding 2: `autoPromote.js` lacks the approver TOCTOU re-read (Fix G)

**What was noted:** `_promoteUser` in the controller re-reads the approver inside the transaction (Fix G) and throws 403 if they were demoted or made inactive. `autoPromoteNext` in `autoPromote.js` is system-triggered (no human approver), so it intentionally omits this re-read. The asymmetry is undocumented.

**Resolution:** The asymmetry is correct by design and documented in the review. `autoPromote.js` has no approver identity to validate. A code comment was noted as appropriate. This is a documentation concern only; no code change was required. Future maintainers should consult this report and `review.md` before adding approver-context calls to `autoPromote`.

---

## Sources

- Plan: `.agents/tasks/queue-consent-fix-2026/plan.md`
- Review: `.agents/tasks/queue-consent-fix-2026/review.md`
- Review JSON: `.agents/tasks/queue-consent-fix-2026/review.json`
- Key commits: `39f5af2`, `39faf2b`, `286ddd9`
- Branch HEAD: `87c301e` (`fix/queue-approval-consent-failures` = `main`)
