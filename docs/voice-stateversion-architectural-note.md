# Voice Club — State Version Ordering: Architectural Note

**Date:** 2026-10-21  
**Related fixes:** FIX-L002, FIX-LOW09, voice-leave-removal-fix.test.js  
**Status:** Known gap, documented + mitigated. Not blocking.

---

## Problem Statement

`voice:stage_state` socket events carry a full snapshot of all active participants
in a room at the instant they were emitted. They are sent in several circumstances:

- When a user joins (`joinRoom` controller)
- When a user is kicked (`kickParticipant`)
- When a user leaves (`leaveRoom`)
- When a user is banned (`banParticipant`)
- After HOST priority eviction (via `voice:role_changed` path)

Socket.IO does not guarantee delivery order when multiple room-wide emits fire in
rapid succession (e.g. a join followed immediately by another join). A client may
receive snapshot T2 before snapshot T1, even though T2 was emitted later. This
means a client applying T1 after T2 would revert to a stale view.

---

## Previous Approach (reverted — caused F-008)

The original FIX-L002 (commit `72ff0a0`) made `onStageState` in `useVoiceRoom.ts`
call `removeParticipant(p.userId)` for any store participant absent from the
snapshot. This was an aggressive reconciliation sweep.

**The regression:** A client who joined at time T2 could be absent from a T1
snapshot. If the T1 snapshot was delivered after T2's local `voice:user_joined`
was processed, `removeParticipant` would remove the newly-joined user — a ghost
of their tile would vanish within milliseconds of appearing (F-008).

The `voice-leave-removal-fix.test.js` suite now asserts the reverted behavior:
- `onStageState` does NOT call `removeParticipant` (test at line 68–85)
- `applyStageSnapshot` (mobile) does NOT filter absent participants (test at line 96–107)

---

## Current Mitigation

**Two-layer approach:**

| Layer | Location | What it does | Ordering-safe? |
|---|---|---|---|
| Socket `onStageState` | `useVoiceRoom.ts` | Update-only: `updateParticipant` (seat/role/mute) + `addParticipant` upsert. No removal. | ✅ Yes — can be applied in any order without removing newer joiners |
| 30s HTTP poll | `VoiceRoomView.tsx` | Fetches DB state directly (`isActive=1`). Removes any store participant absent from the response. | ✅ Yes — DB is the ground truth; stale snapshots can't affect this |

The stale-seat sweep in `onStageState` (clears `seatNumber → null` for store
participants absent from the snapshot) is safe because clearing a seat number
is idempotent and the worst visible effect is a brief stage slot flicker before
the next `voice:stage_state` re-seats the participant.

---

## Known Gap

Between two consecutive 30s poll cycles, a departed participant's avatar tile
may linger for up to 30 seconds. The departure event flow (`voice:user_left`) is
the primary signal; the 30s poll is only a safety net for dropped events.

**Affected scenario:** The primary `voice:user_left` event and the room-wide
`voice:stage_state` (from `leaveRoom` FIX-FMED05) were both dropped during a
network blip. In this case the departed user lingers for up to 30s.

This is the intentional tradeoff. The alternative — running the removal pass on
potentially-empty snapshots or enabling `removeParticipant` in `onStageState` —
risks F-008 regression.

---

## Path to a Full Fix (Future Work)

The root problem is the absence of **monotonic sequence numbers** on `voice:stage_state`
emits. If each emit carried a `seq` counter incremented per-room (e.g. stored in
Redis alongside the room state), clients could:

1. Track `lastAppliedSeq` locally.
2. Discard any incoming `voice:stage_state` where `event.seq <= lastAppliedSeq`.
3. Apply only newer-than-last snapshots, making `removeParticipant` safe in `onStageState`.

Implementation touch-points:
- Backend: increment `room:${roomId}:stageSeq` in Redis on every `voice:stage_state` emit; include in payload.
- Frontend `useVoiceRoom.ts`: add `lastStageSeqRef`; guard `onStageState` with `if (data.seq <= lastStageSeqRef.current) return`.
- Mobile `[id].tsx`: same pattern.
- The 30s HTTP poll in `VoiceRoomView.tsx` would remain as a backstop for network-gapped sessions.

This change would allow `onStageState` to call `removeParticipant` safely and
eliminate the 30s maximum lag for departed participants. It is a medium-complexity
backend+frontend change with no schema migration required (Redis-only).

**Estimated complexity:** ~2–3 days. Every mutation path that calls
`io.to(roomId).emit('voice:stage_state', ...)` must atomically increment and
include the seq counter. Client-side requires a stable ref per room session.

**Recommendation:** Defer to a dedicated PR after this fix branch ships. The
current two-layer approach (update-only socket + authoritative HTTP poll) is safe
and correct for current scale. The stateVersion work is an optimization, not a
correctness fix.

---

## Test Coverage

`backend/src/tests/voice-leave-removal-fix.test.js` pins the current behavior
(no `removeParticipant` in `onStageState`, no `.filter` in `applyStageSnapshot`,
`removeParticipant` only in the 30s HTTP poll). Any future state-versioning
implementation must update these tests before re-enabling removal in `onStageState`.
