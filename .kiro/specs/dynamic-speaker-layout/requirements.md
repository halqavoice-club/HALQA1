# Requirements Document

## Introduction

The Dynamic Speaker Layout System is a layout engine and presentation component system for HALQA LIVE CLASS. It automatically arranges speaker seats based on participant count, supports manual layout overrides, and renders across React Native (mobile/Expo) and Next.js (web). The system integrates with LiveKit events and the existing Zustand voice store, delivering flicker-free, 60 FPS seat transitions with paginated support for 100+ concurrent speakers.

## Glossary

- **LayoutEngine**: The pure function `computeLayout()` that takes speakers, a manual mode, and options, and returns a `LayoutResult`. Contains no I/O or React dependencies.
- **SpeakerGrid**: The top-level orchestrator React/React Native component that reads from the store and drives all child layout components.
- **SeatCard**: The per-seat renderer component that displays an occupied or empty speaker slot.
- **LayoutControlBar**: The horizontal scrollable mode-picker pill bar component.
- **PaginationDots**: The page indicator component that supports tap-to-jump and swipe navigation.
- **SpeakingRing**: The animated border component shown around a seat when the occupant is actively speaking.
- **GiftOverlay**: The floating gift animation overlay shown above the host seat.
- **DynamicLayoutStore**: The Zustand state slice that holds all seat data, layout results, and user preferences.
- **SpeakerSlot**: A TypeScript interface representing one occupied or reserved seat in the room.
- **SeatData**: A `SpeakerSlot` extended with display metadata (`isEmpty`, `key`) consumed by `SeatCard`.
- **LayoutResult**: The output object of `computeLayout()`, containing the resolved mode, grid definition, paginated seat arrays, and optional PK config.
- **GridDefinition**: A TypeScript interface describing the column/row structure for a given layout mode and speaker count.
- **LayoutMode**: The union type of all supported layout modes: `auto`, `grid`, `focus-host`, `podcast`, `classroom`, `pk`, `compact`, `minimal`.
- **PKConfig**: The PK-mode team assignment object containing `teamA`, `teamB`, and the match format.
- **LiveKit**: The third-party real-time audio/video SDK that emits participant events consumed by the system.
- **Socket.IO**: The WebSocket transport layer that delivers server-authoritative seat change and room state events.
- **SeatRole**: The role enum for a seat: `owner`, `moderator`, `speaker`, or `empty`.
- **Page**: A fixed-size slice of `SeatData` representing one screen of the paginated grid.

---

## Requirements

### Requirement 1: Auto Layout Computation

**User Story:** As a live class participant, I want the speaker grid to automatically arrange seats based on how many people are in the room, so that I can always see all speakers in a clear, readable layout without any manual configuration.

#### Acceptance Criteria

1. WHEN `computeLayout` is called with 1 speaker, THE LayoutEngine SHALL produce a `GridDefinition` of 1 column × 1 row (full-screen layout).
2. WHEN `computeLayout` is called with 2 speakers, THE LayoutEngine SHALL produce a `GridDefinition` of 2 columns × 1 row.
3. WHEN `computeLayout` is called with 3 or 4 speakers, THE LayoutEngine SHALL produce a `GridDefinition` of 2 columns × 2 rows.
4. WHEN `computeLayout` is called with 5 or 6 speakers, THE LayoutEngine SHALL produce a `GridDefinition` of 3 columns × 2 rows.
5. WHEN `computeLayout` is called with 7, 8, or 9 speakers, THE LayoutEngine SHALL produce a `GridDefinition` of 3 columns × 3 rows.
6. WHEN `computeLayout` is called with 10, 11, or 12 speakers, THE LayoutEngine SHALL produce a `GridDefinition` of 4 columns × 3 rows.
7. WHEN `computeLayout` is called with 13, 14, 15, or 16 speakers, THE LayoutEngine SHALL produce a `GridDefinition` of 4 columns × 4 rows.
8. WHEN `computeLayout` is called with more than 16 speakers, THE LayoutEngine SHALL produce a `GridDefinition` of 4 columns × 4 rows and distribute speakers across paginated pages of at most 16 seats each.
9. THE LayoutEngine SHALL always place the speaker with `role === 'owner'` at position `pages[0][0]` when an owner slot is present in the speakers array, regardless of layout mode or speaker count.
10. IF no speakers are provided to `computeLayout` AND `computeLayout` is actually called with 0 speakers, THEN THE LayoutEngine SHALL return a `LayoutResult` with `totalPages === 1` and a single empty page with the minimum grid definition.

### Requirement 2: Manual Layout Modes

**User Story:** As a room host or moderator, I want to manually select a specific layout mode, so that I can present the room in a format that fits the session type (debate, podcast, classroom, etc.).

#### Acceptance Criteria

1. WHEN a user selects `focus-host` mode via `LayoutControlBar`, THE DynamicLayoutStore SHALL call `setManualMode('focus-host')` and THE LayoutEngine SHALL produce a layout where the owner seat has `colSpan: 2` and `rowSpan: 2`.
2. WHEN a user selects `podcast` mode, THE LayoutEngine SHALL produce a layout with 2 columns × 3 rows showing a maximum of 6 speakers.
3. WHEN a user selects `classroom` mode, THE LayoutEngine SHALL produce a layout where the owner seat spans the full top row and remaining speakers are arranged in a 4-column grid below.
4. WHEN a user selects `pk` mode, THE LayoutEngine SHALL split speakers into `teamA` and `teamB` and produce a side-by-side VS layout with an animated divider.
5. WHEN a user selects `compact` mode, THE LayoutEngine SHALL produce a layout with 4 or more columns regardless of speaker count, using small fixed-size seat cards.
6. WHEN a user selects `minimal` mode, THE LayoutEngine SHALL produce the same grid dimensions as `auto` mode but set `showBadges` and `showGifts` to `false` for all seats in the output.
7. WHEN a user selects `grid` mode, THE LayoutEngine SHALL produce a square grid layout regardless of speaker count.
8. WHEN a user taps "Auto" in `LayoutControlBar`, THE DynamicLayoutStore SHALL call `clearManualMode()` and THE LayoutEngine SHALL recompute the layout based solely on the current speaker count.
9. WHEN `setManualMode` is called with any mode value, THE DynamicLayoutStore SHALL NOT modify the `speakers` array.
10. WHEN `clearManualMode` is called after a manual mode was set, THE LayoutEngine SHALL produce the same `LayoutResult` as if `setManualMode` had never been called, given the same `speakers` array.

### Requirement 3: Pagination

**User Story:** As a participant in a large room, I want to navigate through pages of speakers, so that I can view all participants even when there are more than 16 seats on screen.

#### Acceptance Criteria

1. THE LayoutEngine SHALL set `totalPages` to `ceil(max(speakers.length, 1) / pageSize)` where `pageSize` defaults to 16.
2. EVERY page in `LayoutResult.pages` SHALL contain exactly `gridDef.columns × gridDef.rows` entries, with empty `SeatData` padding filling any remaining slots on the last page.
3. THE DynamicLayoutStore SHALL constrain `currentPage` to the range `[0, totalPages - 1]` at all times.
4. WHEN a speaker leaves the room and `totalPages` decreases, THE DynamicLayoutStore SHALL clamp `currentPage` to `totalPages - 1` before the next render.
5. WHEN the user swipes left on `SpeakerGrid`, THE DynamicLayoutStore SHALL call `setCurrentPage(currentPage + 1)` if a next page exists.
6. WHEN the user swipes right on `SpeakerGrid`, THE DynamicLayoutStore SHALL call `setCurrentPage(currentPage - 1)` if a previous page exists.
7. WHEN the user taps a dot on `PaginationDots`, THE DynamicLayoutStore SHALL call `setCurrentPage` with the index of the tapped dot.
8. WHILE the total speaker count is 16 or fewer, THE SpeakerGrid SHALL NOT render the `PaginationDots` component.
9. THE LayoutEngine SHALL ensure `totalPages` is never less than 1.

### Requirement 4: Speaking Animation

**User Story:** As a participant, I want to see a visual ring around seats that are actively speaking, so that I can easily identify who is talking during the session.

#### Acceptance Criteria

1. WHEN a seat transitions to `isSpeaking === true`, THE SpeakingRing SHALL animate from opacity 0 to opacity 1 over 200ms and scale from 1.0 to 1.05 using a spring transition.
2. WHEN a seat transitions to `isSpeaking === false`, THE SpeakingRing SHALL animate from opacity 1 to opacity 0 over 300ms ease-out and scale from 1.05 to 1.0.
3. WHEN an audio peak event is detected on a speaking seat, THE SpeakingRing SHALL briefly animate the scale from 1.05 to 1.12 and back to the final resting state of 1.05 over 100ms.
4. THE SpeakingRing animation SHALL run entirely on the UI thread with no JavaScript bridge calls during the animation loop on mobile (React Native Reanimated 2).
5. THE SpeakingRing animation SHALL be driven by Framer Motion on web, using `useMotionValue` and `useSpring`.
6. WHEN LiveKit audio level events oscillate rapidly, THE DynamicLayoutStore SHALL debounce `isSpeaking` state transitions at a minimum interval of 50ms per seat, ensuring at most one animation cycle is triggered per 50ms per seat.

### Requirement 5: Stable Seat Keys and Rendering Performance

**User Story:** As a developer maintaining the system, I want seat components to use stable keys and re-render only when necessary, so that the grid remains at 60 FPS with no unnecessary React reconciliation.

#### Acceptance Criteria

1. THE LayoutEngine SHALL assign every `SeatData` a `key` value equal to `"seat-{seatIndex}"` where `seatIndex` is the seat's 0-based position index.
2. THE LayoutEngine SHALL NOT reassign a `key` to a different `seatIndex` across layout recomputations for a seat that has not changed its position.
3. THE `SeatCard` component SHALL be wrapped with `React.memo` using a custom equality comparator that only triggers re-renders when `isSpeaking`, `isMuted`, or `avatarUrl` change.
4. A single call to `computeLayout` with up to 200 speakers SHALL complete in under 2ms when measured with `performance.now()`.
5. THE `SpeakerGrid` component SHALL use `useMemo` for page slicing to avoid recomputation on unrelated state changes.
6. ON mobile, THE `SpeakerGrid` SHALL render speakers using a `FlatList` with `getItemLayout` configured for O(1) scroll position calculation.
7. ON web, WHEN total speaker count exceeds 32, THE `SpeakerGrid` SHALL use `react-window` virtual grid rendering.

### Requirement 6: PK Mode

**User Story:** As a room host running a debate or PK battle, I want the layout to split speakers into two teams with a VS divider, so that the audience can clearly see the opposing sides.

#### Acceptance Criteria

1. WHEN `computeLayout` is called with `manualMode === 'pk'`, THE LayoutEngine SHALL produce a `PKConfig` object containing `teamA` and `teamB` arrays.
2. THE LayoutEngine SHALL assign speakers to teams such that `|teamA.length - teamB.length| ≤ 1`.
3. WHEN the speaker count is odd in PK mode, THE LayoutEngine SHALL assign the extra speaker to `teamA`.
4. THE `SpeakerGrid` SHALL render `teamA` seats in the left column with a primary-color border and `teamB` seats in the right column with an accent-color border.
5. THE `SpeakerGrid` SHALL render an animated "VS" badge with a glow effect between the two team columns in PK mode.
6. THE `SpeakerGrid` SHALL render the VS divider between exactly two equal-width columns regardless of team sizes.
7. WHEN `manualMode` is cleared from `pk`, THE `SpeakerGrid` SHALL no longer render the VS divider or team-colored borders.

### Requirement 7: LiveKit and Socket.IO Integration

**User Story:** As a room participant, I want the speaker grid to update instantly when participants join, leave, or change their audio state, so that the layout always reflects the real-time state of the room.

#### Acceptance Criteria

1. WHEN a LiveKit `ParticipantJoined` event fires, THE `useDynamicLayout` hook SHALL call `DynamicLayoutStore.addSpeaker` with a `SpeakerSlot` mapped from the LiveKit participant data.
2. WHEN a LiveKit `ParticipantLeft` event fires, THE `useDynamicLayout` hook SHALL call `DynamicLayoutStore.removeSpeaker` with the participant's identity.
3. WHEN a LiveKit `TrackMuted` event fires for the microphone track, THE `useDynamicLayout` hook SHALL call `DynamicLayoutStore.updateSpeaker` with `{ isMuted: true }` for that participant.
4. WHEN a LiveKit `TrackUnmuted` event fires for the microphone track, THE `useDynamicLayout` hook SHALL call `DynamicLayoutStore.updateSpeaker` with `{ isMuted: false }` for that participant.
5. WHEN a `voice:seat_changed` Socket.IO event is received, THE `useDynamicLayout` hook SHALL call `DynamicLayoutStore.updateSpeaker` with `{ seatIndex: newSeatIndex }` for the specified `userId`.
6. WHEN a `voice:role_changed` Socket.IO event is received, THE `useDynamicLayout` hook SHALL call `DynamicLayoutStore.updateSpeaker` with `{ role }` for the specified `userId`.
7. WHEN a `voice:room_state` Socket.IO event is received, THE `useDynamicLayout` hook SHALL call `DynamicLayoutStore.setSpeakers` with the full speakers array to perform a complete resync.
8. THE `DynamicLayoutStore.addSpeaker` action SHALL perform an upsert: if the `userId` already exists in `speakers`, it SHALL call `updateSpeaker` instead of pushing a duplicate entry.

### Requirement 8: Error Handling and Resilience

**User Story:** As a participant in an unstable network environment, I want the layout to degrade gracefully when connections drop or data is missing, so that the room remains usable and recovers automatically.

#### Acceptance Criteria

1. WHEN a `SeatCard` avatar image fails to load, THE `SeatCard` SHALL replace the avatar with a deterministic color-based initials avatar generated from the `userId` hash, with no layout shift.
2. WHEN LiveKit connection state changes to `DISCONNECTED`, THE `DynamicLayoutStore` SHALL set `connectionQuality: 'unknown'` for all speakers and THE `SpeakerGrid` SHALL display a reconnect banner above the grid.
3. WHEN LiveKit connection state changes to `RECONNECTED`, THE `useDynamicLayout` hook SHALL call `DynamicLayoutStore.setSpeakers` with the current `room.participants` map and rerun `computeLayout`.
4. WHEN a LiveKit `DISCONNECTED` event is received, THE `DynamicLayoutStore` SHALL NOT clear the `speakers` array; instead it SHALL set `isOnline: false` and apply reduced opacity styling on all seats, preserving the speakers array indefinitely for the duration of the disconnected state.
5. WHEN rapid `addSpeaker` or `removeSpeaker` calls arrive within 32ms of each other, THE `DynamicLayoutStore` SHALL batch those mutations using a 32ms debounce before recomputing the layout.
6. WHEN `displayName` is empty or undefined for a `SpeakerSlot`, THE `SeatCard` SHALL display the first 8 characters of `userId` as the fallback display name.
7. WHEN `countryCode` is null or undefined for a `SpeakerSlot`, THE `SeatCard` SHALL hide the flag badge without rendering any placeholder element.
8. WHEN two participants claim the same `seatIndex`, THE `DynamicLayoutStore` SHALL resolve the conflict by retaining the participant from the most recent Socket.IO event as the seat owner and relocating the displaced participant to the lowest available seat index not occupied by any other participant.
9. WHEN a Socket.IO event updates a participant's profile, avatar, gift state, speaking state, mute state, connection quality, or any field that does not introduce a duplicate `seatIndex`, THE `DynamicLayoutStore` SHALL update that participant in place without relocating any participant.
10. THE seat conflict resolution algorithm SHALL be deterministic and idempotent: applying the same Socket.IO event sequence multiple times SHALL produce the same seat assignments without additional relocations.

### Requirement 9: Empty Seat Integrity

**User Story:** As a participant, I want empty seat slots to appear as clean placeholder cards rather than showing stale data from previous occupants, so that I can clearly distinguish occupied seats from available ones.

#### Acceptance Criteria

1. EVERY empty `SeatData` padding entry produced by THE LayoutEngine SHALL have `isEmpty === true`.
2. EVERY empty `SeatData` padding entry SHALL have `isSpeaking === false`.
3. EVERY empty `SeatData` padding entry SHALL have `isMuted === false`.
4. EVERY empty `SeatData` padding entry SHALL have `role === 'empty'`.
5. EVERY empty `SeatData` padding entry SHALL have `userId === ''`.
6. THE LayoutEngine SHALL NOT carry over any field values from a previously occupying `SpeakerSlot` into an empty padding `SeatData`.

### Requirement 10: Speaker Sorting and Priority

**User Story:** As a room participant, I want important speakers (host, moderators, active speakers) to appear first in the grid, so that I can immediately find the most relevant participants without scrolling.

#### Acceptance Criteria

1. THE LayoutEngine SHALL sort speakers so that the speaker with `role === 'owner'` is always placed at `seatIndex` 0 (top-left position of `pages[0]`).
2. THE LayoutEngine SHALL place speakers with `role === 'moderator'` after the owner, sorted by their `seatIndex` value.
3. THE LayoutEngine SHALL place actively speaking participants (`isSpeaking === true` and `isMuted === false`) after moderators, sorted by recency of speaking activity. WHEN comparing a muted moderator against an actively speaking regular participant, THE LayoutEngine SHALL prioritize the actively speaking regular participant regardless of role.
4. THE LayoutEngine SHALL place muted speakers last among occupied seats.
5. WHEN `DynamicLayoutStore.pinSpeaker(userId)` is called with a non-null `userId`, THE LayoutEngine SHALL place that speaker at position index 1 (immediately after the owner) regardless of their role or speaking state.
6. WHEN `DynamicLayoutStore.pinSpeaker(null)` is called, THE LayoutEngine SHALL restore normal sort order for the previously pinned speaker.

### Requirement 11: Admin Seat Management

**User Story:** As a room moderator, I want to lock, reserve, and swap speaker seats, so that I can manage the room layout and ensure the right people are in the right positions.

#### Acceptance Criteria

1. WHEN `DynamicLayoutStore.lockSeat(seatIndex, true)` is called, THE DynamicLayoutStore SHALL add that `seatIndex` to the `lockedSeats` set and THE `SeatCard` at that index SHALL display a lock indicator.
2. WHEN `DynamicLayoutStore.lockSeat(seatIndex, false)` is called, THE DynamicLayoutStore SHALL remove that `seatIndex` from `lockedSeats` and THE `SeatCard` SHALL remove the lock indicator.
3. WHEN `DynamicLayoutStore.reserveSeat(seatIndex, true)` is called, THE DynamicLayoutStore SHALL add that `seatIndex` to the `reservedSeats` set.
4. WHEN `DynamicLayoutStore.swapSeats(indexA, indexB)` is called, THE DynamicLayoutStore SHALL exchange the `SpeakerSlot` occupants at those two seat indices and trigger a layout recomputation.
5. THE `SeatCard` SHALL expose an `onLongPress` handler that opens an admin action menu when the current user has a `role` of `owner` or `moderator`.

### Requirement 12: Accessibility

**User Story:** As a participant using assistive technology, I want all interactive elements to have proper accessibility labels and roles, so that I can fully participate in the live class using a screen reader or keyboard navigation.

#### Acceptance Criteria

1. EVERY `SeatCard` component SHALL have an `accessibilityLabel` equal to `"{displayName}, {role}, {isSpeaking ? 'speaking' : 'muted'}"`.
2. EVERY button in `LayoutControlBar` SHALL have `accessibilityRole="radio"` and `accessibilityState` reflecting whether that mode is currently selected.
3. EVERY interactive touch target in `SpeakerGrid`, `SeatCard`, `LayoutControlBar`, and `PaginationDots` SHALL have a minimum size of 44×44dp.
4. WHEN a `SeatCard` is empty, THE `SeatCard` SHALL have an `accessibilityLabel` of `"Empty seat"`.
