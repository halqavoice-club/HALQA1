# Implementation Plan: Dynamic Speaker Layout System

## Overview

Implement a two-layer layout system: a pure TypeScript computation engine shared across platforms, and a set of React / React Native presentation components backed by a Zustand slice. All 12 correctness properties defined in the design are validated by property-based tests using `fast-check`. Integration with LiveKit events and Socket.IO is handled by the `useDynamicLayout` hook. Rendering is optimised for 60 FPS via `React.memo`, `FlatList + getItemLayout`, and `react-window` virtual grid.

---

## Tasks

- [x] 1. Shared layout engine — types and theme tokens
  - [x] 1.1 Create `src/lib/layout/layoutTypes.ts`
    - Define and export: `SeatRole`, `LayoutMode`, `SpeakerSlot`, `SeatData`, `GridDefinition`, `LayoutResult`, `PKConfig`, `LayoutOptions`, `SeatSize`, `DynamicLayoutState`
    - Ensure all interfaces match the data-model section of the design exactly
    - Export the `AUTO_GRID` lookup table constant (`Record<number, GridDefinition>`)
    - _Requirements: 1.1–1.10, 2.1–2.10, 3.1–3.9, 5.1–5.2, 6.1–6.3, 9.1–9.6, 10.1–10.6_

  - [x] 1.2 Create `src/lib/layout/layoutThemes.ts`
    - Define and export the `LayoutTheme` interface and three theme objects: `darkTheme`, `lightTheme`, `oledTheme`
    - Export a helper `getTheme(name: 'dark' | 'light' | 'oled'): LayoutTheme`
    - _Requirements: (theme tokens used by SeatCard and SpeakerGrid)_

  - [x] 1.3 Create `src/lib/layout/layoutTestUtils.ts`
    - Export `makeSpeaker(overrides?: Partial<SpeakerSlot>): SpeakerSlot` factory
    - Export `generateSpeakers(count: number, options?: { withOwner?: boolean }): SpeakerSlot[]`
    - Export `flattenPages(pages: SeatData[][]): SeatData[]` utility
    - Export `fast-check` arbitraries: `fcSpeakerSlot`, `fcSpeakersArray`, `fcLayoutMode`
    - _Requirements: (test infrastructure used by all property tests)_

- [x] 2. Core `computeLayout` engine
  - [x] 2.1 Create `src/lib/layout/computeLayout.ts` — speaker sorting
    - Implement `sortSpeakers(speakers: SpeakerSlot[], pinnedUserId: string | null): SpeakerSlot[]`
    - Sort order: owner → moderators (by seatIndex) → active speakers (isSpeaking && !isMuted, ranked above muted moderators) → muted speakers
    - Handle pinnedUserId: move that speaker to index 1 after the owner
    - _Requirements: 10.1–10.6_

  - [ ]* 2.2 Write property test for speaker sort order (Property 11)
    - **Property 11: Sort Order Invariant** — owner always first, pinned always at index 1, active before muted
    - **Validates: Requirements 10.2, 10.3, 10.4, 10.5, 10.6**
    - Use `fcSpeakersArray` arbitrary with `fast-check`

  - [x] 2.3 Implement `resolveGridDef(count: number, manualMode: LayoutMode | null): GridDefinition`
    - `auto`: look up `AUTO_GRID[clamp(count, 1, 16)]`, default to 4×4 above 16
    - `grid`: compute smallest square that fits count (ceil(√count) × ceil(√count))
    - `focus-host`: base 2×2 grid with `hostSpan: { colSpan: 2, rowSpan: 2 }`
    - `podcast`: `{ columns: 2, rows: 3 }` — caps display at 6 speakers
    - `classroom`: `{ columns: 4, rows: … }` with `hostSpan` spanning full top row
    - `compact`: `{ columns: Math.max(4, …) }` with small fixed aspect ratio
    - `minimal`: same grid as `auto` (delegates to auto path)
    - `pk`: `{ columns: 2, rows: ceil(n/2) }` — split layout
    - _Requirements: 1.1–1.8, 2.1–2.8_

  - [x] 2.4 Implement PK team assignment inside `computeLayout`
    - Build `PKConfig` from sorted speakers: `teamA = first ceil(n/2)`, `teamB = rest`
    - Determine `format` from team sizes: `1v1`, `2v2`, `3v3`, or `'club'`
    - _Requirements: 6.1–6.3_

  - [ ]* 2.5 Write property test for PK team balance (Property 10)
    - **Property 10: PK Team Balance** — `|teamA.length - teamB.length| ≤ 1`; odd n → teamA gets ceil(n/2)
    - **Validates: Requirements 6.1, 6.2, 6.3**

  - [x] 2.6 Implement page-building inside `computeLayout`
    - `pageSize = options.pageSize ?? 16`
    - Chunk sorted speakers into pages; pad last page with empty `SeatData` to fill `gridDef.columns × gridDef.rows`
    - Every empty SeatData: `isEmpty=true, isSpeaking=false, isMuted=false, role='empty', userId=''`
    - Assign `key = "seat-${seatIndex}"` to every SeatData
    - `totalPages = Math.ceil(Math.max(speakers.length, 1) / pageSize)`
    - _Requirements: 1.9–1.10, 3.1–3.2, 3.9, 5.1–5.2, 9.1–9.6_

  - [ ]* 2.7 Write property test for empty seat integrity (Property 9)
    - **Property 9: Empty Seat Integrity** — every padding entry has correct empty defaults, no stale fields
    - **Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5, 9.6**

  - [ ]* 2.8 Write property test for page size invariant (Property 2)
    - **Property 2: Page Size Invariant** — `∀ page in pages: page.length === gridDef.columns * gridDef.rows`
    - **Validates: Requirements 3.2**

  - [ ]* 2.9 Write property test for stable seat keys (Property 4)
    - **Property 4: Stable Seat Keys** — `seat.key === "seat-${seatIndex}"` always; no key reassigned across recomputations for unchanged position
    - **Validates: Requirements 5.1, 5.2**

  - [ ]* 2.10 Write property test for host invariant (Property 1)
    - **Property 1: Host Invariant** — `pages[0][0].role === 'owner'` whenever an owner is present, for all speaker counts 1–1000 and all modes
    - **Validates: Requirements 1.9, 10.1**

  - [ ]* 2.11 Write property test for pagination consistency (Property 6)
    - **Property 6: Pagination Consistency** — `totalPages === ceil(max(n,1)/p)`, never < 1, `currentPage` always in `[0, totalPages-1]`
    - **Validates: Requirements 3.1, 3.3, 3.4, 3.9**

  - [ ]* 2.12 Write performance test for computation budget (Property 8)
    - **Property 8: 60 FPS Computation Budget** — `computeLayout(200 speakers, mode)` completes in < 2ms via `performance.now()`
    - **Validates: Requirements 5.4**
    - Run 50 iterations to get stable measurement

- [x] 3. Checkpoint — engine unit tests
  - Run `src/lib/layout/__tests__/computeLayout.test.ts`, `pagination.test.ts`, `pkMode.test.ts`, `sortSpeakers.test.ts`. Ensure all pass. Ask the user if any test output is unclear.

- [x] 4. Zustand store slice
  - [x] 4.1 Create `frontend/src/components/live-class/layout/useDynamicLayoutStore.ts` (web)
    - Implement all actions: `addSpeaker` (upsert), `removeSpeaker`, `updateSpeaker`, `setSpeakers`, `setManualMode`, `clearManualMode`, `setCurrentPage` (clamped), `pinSpeaker`, `lockSeat`, `reserveSeat`, `swapSeats`
    - Every mutating action calls `computeLayout(speakers, manualMode)` and updates `state.layout`
    - `addSpeaker` / `removeSpeaker` batch via 32ms debounce using `setTimeout` + `useRef`
    - `isSpeaking` updates via `updateSpeaker` are debounced at 50ms per seat (use per-seat debounce map)
    - `setCurrentPage` clamps to `[0, layout.totalPages - 1]`
    - Use Zustand `immer` middleware for immutable updates
    - Seat conflict resolution: on `updateSpeaker({ seatIndex })`, only relocate when the target `seatIndex` is already held by a different `userId`; all other field updates are in-place with no relocation
    - _Requirements: 2.9, 3.3–3.7, 7.8, 8.5, 8.8–8.10_

  - [x] 4.2 Create `mobile/src/components/voice/layout/useDynamicLayoutStore.ts` (mobile)
    - Mirror the web store slice with identical actions and debounce logic
    - Replace `setTimeout` batch debounce with `InteractionManager.runAfterInteractions` on mobile
    - Seat conflict resolution: same in-place-only logic as web store; no relocation on non-seat-index updates
    - _Requirements: 2.9, 3.3–3.7, 7.8, 8.5, 8.8–8.10_

  - [x] 4.5 Implement `resolveSeatConflict` helper in `src/lib/layout/computeLayout.ts`
    - Signature: `resolveSeatConflict(speakers: SpeakerSlot[], incomingUserId: string, incomingSeatIndex: number, eventTimestamp: number): SpeakerSlot[]`
    - Step 1: find current occupant of `incomingSeatIndex`
    - Step 2: if no occupant or same userId → return speakers updated in place, no relocation
    - Step 3: if different userId → compare timestamps; winner keeps the seat; loser moves to `min(availableIndex)`
    - Only the two involved participants are mutated; all others are returned unchanged
    - The function is pure and deterministic: same inputs always produce the same output
    - _Requirements: 8.8, 8.9, 8.10_

  - [ ]* 4.6 Write unit tests for `resolveSeatConflict`
    - Test: no conflict — incoming seatIndex unoccupied → only target participant updates, no relocation
    - Test: duplicate seat — two participants collide → winner keeps seat, loser goes to lowest available
    - Test: self-update — same userId updates own seatIndex → in-place update, no relocation
    - Test: profile/avatar/mute/speaking update → no relocation triggered
    - Test: reconnect event without conflict → no relocation
    - Test: simultaneous Socket.IO events — later timestamp wins
    - Test: determinism — replaying same event sequence twice produces identical layout
    - Test: idempotency — applying same event to already-resolved state produces no further changes
    - _Requirements: 8.8, 8.9, 8.10_

  - [ ]* 4.3 Write property test for no-duplicate seats (Property 3)
    - **Property 3: No Duplicate Seats** — after any sequence of `addSpeaker` calls (including repeats), each `userId` appears in at most one seat
    - **Validates: Requirements 7.8**
    - Test with `fast-check` by replaying random action sequences

  - [ ]* 4.4 Write property test for manual override isolation (Property 5)
    - **Property 5: Manual Override Isolation** — `setManualMode` does not modify `speakers`; `clearManualMode` restores identical `LayoutResult` to pre-setManualMode state
    - **Validates: Requirements 2.9, 2.10**

- [x] 5. Web presentation components — SeatCard and SpeakingRing
  - [x] 5.1 Create `frontend/src/components/live-class/layout/SpeakingRing.tsx`
    - Framer Motion implementation: `useMotionValue`, `useSpring`
    - IDLE→SPEAKING: opacity 0→1 (200ms), scale 1→1.05 (spring)
    - SPEAKING→IDLE: opacity 1→0 (300ms ease-out), scale 1.05→1
    - PEAK: scale 1.05→1.12→1.05 (100ms bounce) triggered by `onAudioPeak` prop
    - _Requirements: 4.1, 4.2, 4.3, 4.5_

  - [x] 5.2 Create `frontend/src/components/live-class/layout/SeatCard.tsx` (web)
    - Render avatar (`<img>` with `loading="lazy"` + `decoding="async"`), displayName, role badge, flag badge, lock indicator
    - Fallback avatar: deterministic initials from `userId` hash with color bucket
    - `displayName` fallback: `userId.slice(0, 8)`
    - Hide flag badge when `countryCode` is null — no placeholder rendered
    - Show lock indicator when `seat.isLocked === true`
    - Wrap with `React.memo` + custom comparator: re-render only on `isSpeaking`, `isMuted`, `avatarUrl` change
    - `accessibilityLabel`: `"{displayName}, {role}, {isSpeaking ? 'speaking' : 'muted'}"` for occupied; `"Empty seat"` for empty
    - Minimum 44×44dp touch target on all interactive areas
    - `onLongPress` shows admin menu when `isHost === true`
    - _Requirements: 5.3, 8.1, 8.6, 8.7, 11.1, 11.5, 12.1, 12.4_

  - [ ]* 5.3 Write unit tests for SeatCard (web)
    - Test avatar fallback on `onError`
    - Test displayName fallback when empty
    - Test accessibilityLabel format (occupied vs empty)
    - Test React.memo does not re-render on unrelated prop change
    - _Requirements: 8.1, 8.6, 12.1, 12.4_

  - [ ]* 5.4 Write property test for accessibility label completeness (Property 12)
    - **Property 12: Accessibility Label Completeness** — label format holds for all valid `displayName`, `role`, `isSpeaking` combinations
    - **Validates: Requirements 12.1**

- [x] 6. Web presentation components — GiftOverlay, LayoutControlBar, PaginationDots
  - [x] 6.1 Create `frontend/src/components/live-class/layout/GiftOverlay.tsx`
    - Floating gift burst animation using Framer Motion `AnimatePresence` above the host seat
    - Accepts `giftEvents` array prop; renders each gift as an animated emoji/icon that floats up and fades
    - Hidden (`showGifts === false`) in Minimal mode
    - _Requirements: 2.6_

  - [x] 6.2 Create `frontend/src/components/live-class/layout/LayoutControlBar.tsx`
    - Horizontal scrollable pill bar with "Auto" as first option, then all 7 manual modes
    - Highlight active mode; show "Auto" badge when `isManual === false`
    - `accessibilityRole="radio"` on each button; `accessibilityState={{ selected: isActive }}` per button
    - Minimum 44×44dp touch targets
    - Calls `onSelectMode(mode)` or `onResetAuto()` on tap
    - _Requirements: 2.1, 2.8, 12.2, 12.3_

  - [x] 6.3 Create `frontend/src/components/live-class/layout/PaginationDots.tsx`
    - Render one dot per page, animate active dot width/opacity with Framer Motion
    - Tap on dot calls `onPageSelect(index)`
    - Hidden when `totalPages <= 1`
    - Minimum 44×44dp tap targets
    - _Requirements: 3.7, 3.8, 12.3_

- [x] 7. Web SpeakerGrid orchestrator and useDynamicLayout hook
  - [x] 7.1 Create `frontend/src/components/live-class/layout/useDynamicLayout.ts` (web)
    - Subscribe to LiveKit `ParticipantJoined` → `store.addSpeaker`
    - Subscribe to LiveKit `ParticipantLeft` → `store.removeSpeaker`
    - Subscribe to LiveKit `TrackMuted` (mic track) → `store.updateSpeaker({ isMuted: true })`
    - Subscribe to LiveKit `TrackUnmuted` (mic track) → `store.updateSpeaker({ isMuted: false })`
    - Subscribe to Socket.IO `voice:seat_changed` → `store.updateSpeaker({ seatIndex })`
    - Subscribe to Socket.IO `voice:role_changed` → `store.updateSpeaker({ role })`
    - Subscribe to Socket.IO `voice:room_state` → `store.setSpeakers(speakers)`
    - On LiveKit `DISCONNECTED`: set all `connectionQuality: 'unknown'`; set `isOnline: false` for all speakers
    - On LiveKit `RECONNECTED`: call `store.setSpeakers(room.participants)` and re-run layout
    - Return `{ layout, currentPage, manualMode, setPage, setManual, clearManual }`
    - _Requirements: 7.1–7.8, 8.2–8.4_

  - [x] 7.2 Create `frontend/src/components/live-class/layout/SpeakerGrid.tsx` (web)
    - Read layout state from `useDynamicLayoutStore`; wire `useDynamicLayout` hook
    - Render `LayoutControlBar`, paginated seat area, `PaginationDots` (when `totalPages > 1`), `GiftOverlay`
    - Wrap seat array in `useMemo` for page slicing
    - Use `react-window` `FixedSizeGrid` when total speaker count > 32
    - Wrap each `SeatCard` with Framer Motion `AnimatePresence` + `layout` prop for position transitions
    - Handle swipe-left/right via pointer events: `setCurrentPage(currentPage ± 1)` with bounds check
    - In PK mode: render two equal-width columns with `teamA`/`teamB`, animated VS badge between them with glow
    - Show reconnect banner when `isOnline === false` on any speaker (LiveKit disconnected)
    - `will-change: transform` on animated elements
    - _Requirements: 3.5–3.8, 5.5, 5.7, 6.4–6.7, 8.2, 8.4_

  - [ ]* 7.3 Write integration tests for useDynamicLayout hook (web)
    - Mock LiveKit `useParticipants`; assert `addSpeaker` called on join
    - Mock socket events; assert `updateSpeaker` called with correct patch
    - Verify no re-render of `SpeakerGrid` when unrelated participant property changes
    - _Requirements: 7.1–7.7_

- [ ] 8. Checkpoint — web component tests
  - Ensure all web component tests and integration tests pass. Ask the user if any test output is unclear.

- [x] 9. Mobile presentation components — SeatCard and SpeakingRing
  - [x] 9.1 Create `mobile/src/components/voice/layout/SpeakingRing.tsx` (RN)
    - Reanimated 2 implementation: `useSharedValue`, `useAnimatedStyle`, `withSpring`, `withTiming`
    - IDLE→SPEAKING: opacity 0→1 `withTiming(1, {duration:200})`, scale `withSpring(1.05)`
    - SPEAKING→IDLE: opacity `withTiming(0, {duration:300, easing:Easing.out})`, scale `withSpring(1.0)`
    - PEAK: `withSequence(withTiming(1.12, {duration:50}), withTiming(1.05, {duration:50}))`
    - All animations run on UI thread — no JS bridge calls during loop
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [x] 9.2 Create `mobile/src/components/voice/layout/SeatCard.tsx` (RN)
    - Same logic as web SeatCard adapted to React Native (`View`, `Image`, `Text`, `Pressable`)
    - Fallback avatar: deterministic color initials (same hash function as web)
    - `accessibilityLabel` and `accessibilityRole` same as web spec
    - Minimum 44dp touch targets via `minWidth`/`minHeight`
    - `onLongPress` opens admin menu when host
    - Wrap with `React.memo` + same custom comparator
    - _Requirements: 5.3, 8.1, 8.6, 8.7, 11.1, 11.5, 12.1, 12.4_

  - [ ]* 9.3 Write unit tests for SeatCard (mobile)
    - Same coverage as web: fallback avatar, displayName fallback, accessibilityLabel, memo behaviour
    - _Requirements: 8.1, 8.6, 12.1, 12.4_

- [x] 10. Mobile presentation components — GiftOverlay, LayoutControlBar, PaginationDots
  - [x] 10.1 Create `mobile/src/components/voice/layout/GiftOverlay.tsx` (RN)
    - Reanimated 2 `FadeIn`/`FadeOut` layout animations for gift burst above host seat
    - Hidden in Minimal mode (`showGifts === false`)
    - _Requirements: 2.6_

  - [x] 10.2 Create `mobile/src/components/voice/layout/LayoutControlBar.tsx` (RN)
    - Horizontal `ScrollView` of pill buttons
    - `accessibilityRole="radio"` and `accessibilityState` per button
    - Minimum 44dp touch targets
    - _Requirements: 2.1, 2.8, 12.2, 12.3_

  - [x] 10.3 Create `mobile/src/components/voice/layout/PaginationDots.tsx` (RN)
    - Reanimated 2 animated dots; tap calls `onPageSelect(index)`
    - Hidden when `totalPages <= 1`
    - Minimum 44dp tap targets
    - _Requirements: 3.7, 3.8, 12.3_

- [x] 11. Mobile SpeakerGrid orchestrator and useDynamicLayout hook
  - [x] 11.1 Create `mobile/src/components/voice/layout/useDynamicLayout.ts` (RN)
    - Mirror web hook; use React Native LiveKit SDK event names
    - Use socket instance from existing voice store
    - On disconnect: same `connectionQuality: 'unknown'` and `isOnline: false` logic
    - On reconnect: re-sync from `room.participants`
    - _Requirements: 7.1–7.8, 8.2–8.4_

  - [x] 11.2 Create `mobile/src/components/voice/layout/SpeakerGrid.tsx` (RN)
    - Use `Animated.FlatList` with `getItemLayout` for O(1) scroll; `horizontal` + `pagingEnabled` for pagination
    - `itemLayoutAnimation={LinearTransition.springify()}` for seat entry/exit
    - Seat page slicing via `useMemo`
    - Render `LayoutControlBar`, paginated `FlatList`, `PaginationDots` (when `totalPages > 1`), `GiftOverlay`
    - PK mode: two equal-width columns with VS badge between them
    - Show reconnect banner when disconnected
    - Seat sizing via the algorithm in the design: `seatWidth = (screenWidth - (columns+1)*GAP) / columns`
    - _Requirements: 3.5–3.8, 5.5, 5.6, 6.4–6.7, 8.2, 8.4_

  - [ ]* 11.3 Write integration tests for useDynamicLayout hook (mobile)
    - Same coverage as web integration tests adapted for RN test environment
    - _Requirements: 7.1–7.7_

- [x] 12. Admin seat management actions
  - [x] 12.1 Implement `lockSeat`, `reserveSeat`, `swapSeats` in both store slices
    - `lockSeat(index, true/false)`: add/remove from `lockedSeats` Set; trigger recompute
    - `reserveSeat(index, true/false)`: add/remove from `reservedSeats` Set
    - `swapSeats(indexA, indexB)`: exchange `SpeakerSlot` occupants; trigger recompute
    - _Requirements: 11.1–11.4_

  - [x] 12.2 Wire `SeatCard` `onLongPress` to admin action sheet in both web and mobile
    - Admin sheet options: Lock/Unlock seat, Reserve seat, Swap seat, Pin speaker
    - Only shown when `isHost === true`
    - _Requirements: 11.5_

  - [ ]* 12.3 Write unit tests for admin store actions
    - Test `lockSeat` adds/removes from `lockedSeats`; test `swapSeats` exchanges occupants and triggers recompute
    - _Requirements: 11.1–11.4_

- [x] 13. Speaking animation debounce and property test
  - [x] 13.1 Implement per-seat 50ms `isSpeaking` debounce in both store slices
    - Maintain a `Map<userId, ReturnType<typeof setTimeout>>` for debounce timers
    - On `updateSpeaker({ isSpeaking })`: clear existing timer for that userId; set new 50ms timer before committing the state change
    - _Requirements: 4.6_

  - [ ]* 13.2 Write property test for speaking animation safety (Property 7)
    - **Property 7: Speaking Animation Safety** — simulate rapid oscillating `isSpeaking` events within 50ms; verify store commits at most one state transition per 50ms per seat
    - **Validates: Requirements 4.6**
    - Use fake timers (`jest.useFakeTimers`) in the test

- [x] 14. Accessibility audit
  - [x] 14.1 Audit and complete accessibility on all web components
    - Verify every `SeatCard` has correct `accessibilityLabel` (occupied and empty variants)
    - Verify `LayoutControlBar` buttons have `accessibilityRole="radio"` + `accessibilityState`
    - Verify all touch targets are ≥ 44×44dp (use CSS `min-width`/`min-height` or `padding`)
    - _Requirements: 12.1–12.4_

  - [x] 14.2 Audit and complete accessibility on all mobile components
    - Verify `accessibilityLabel`, `accessibilityRole`, `accessibilityState` on all interactive RN components
    - Verify minimum 44dp touch target sizes
    - _Requirements: 12.1–12.4_

  - [ ]* 14.3 Write accessibility unit tests (web + mobile)
    - Assert `accessibilityLabel` output for occupied seat, empty seat, muted speaker
    - Assert `accessibilityRole` and `accessibilityState` on LayoutControlBar buttons
    - _Requirements: 12.1–12.4_

- [x] 15. Final checkpoint — full test suite
  - Run all unit tests, property-based tests, and integration tests. Ensure all pass and all 12 correctness properties are green. Ask the user if questions arise.

---

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP; they validate correctness properties and edge cases.
- Property-based tests use `fast-check`. Each test is annotated with its property number and the requirements clause it validates.
- All 12 correctness properties from the design are covered by tasks 2.2, 2.5, 2.7–2.12, 4.3–4.4, 5.4, 13.2.
- The shared engine in `src/lib/layout/` has no React or platform dependencies and can be tested with plain `vitest`/`jest`.
- Both store slices are structurally identical; only the batch-debounce mechanism differs (setTimeout vs InteractionManager).
- Do not implement tasks marked `*` unless explicitly requested.

---

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3"] },
    { "id": 1, "tasks": ["2.1", "2.3"] },
    { "id": 2, "tasks": ["2.2", "2.4", "2.6"] },
    { "id": 3, "tasks": ["2.5", "2.7", "2.8", "2.9", "2.10", "4.1", "4.2"] },
    { "id": 4, "tasks": ["2.11", "2.12", "4.3", "4.4", "4.5"] },
    { "id": 5, "tasks": ["4.6", "5.1", "5.2", "9.1", "9.2", "12.1"] },
    { "id": 6, "tasks": ["5.3", "5.4", "6.1", "6.2", "6.3", "9.3", "10.1", "10.2", "10.3", "12.2"] },
    { "id": 7, "tasks": ["7.1", "11.1", "12.3", "13.1"] },
    { "id": 8, "tasks": ["7.2", "11.2", "13.2"] },
    { "id": 9, "tasks": ["7.3", "11.3"] },
    { "id": 10, "tasks": ["14.1", "14.2"] },
    { "id": 11, "tasks": ["14.3"] }
  ]
}
```
