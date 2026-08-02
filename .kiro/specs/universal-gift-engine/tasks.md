# Implementation Plan: Universal Gift Engine

## Overview

Wire the existing Voice Club gift infrastructure into Live Class by implementing a thin adapter layer. No gift logic is duplicated. All tasks follow the design document.

---

## Tasks

- [x] 1. Backend: Room resolver utility
  - [x] 1.1 Create `backend/src/utils/roomResolver.js`
    - Export `resolveRoom(roomType, roomId)` — returns `{ id, status }` or null
    - Export `resolveParticipant(roomType, roomId, userId)` — returns participant or null
    - Export `resolveActiveRecipients(roomType, roomId, excludeUserId)` — returns array
    - Supports: `voice`, `live_class`
    - _Design: Room Adapter Interface / Backend Changes_

  - [x] 1.2 Refactor `gift.controller.js` to use room resolver
    - Replace hardcoded `voiceRoom`/`voiceParticipant` lookups with `resolveRoom` / `resolveParticipant` / `resolveActiveRecipients`
    - Add `roomType` to `GiftTransaction` create call
    - Normalize Socket.IO emit: broadcast to `gift:sent` + room-type-specific alias
    - Keep backward-compatible `voice:gift_sent` alias
    - _Design: Backend Changes_

- [x] 2. Backend: Database migration
  - [x] 2.1 Add `roomType` column to `gift_transactions` and `room_gift_leaderboard`
    - Migration: `ALTER TABLE gift_transactions ADD COLUMN room_type VARCHAR(30) NOT NULL DEFAULT 'voice'`
    - Migration: `ALTER TABLE room_gift_leaderboard ADD COLUMN room_type VARCHAR(30) NOT NULL DEFAULT 'voice'`
    - Update Prisma schema: add `roomType String @default("voice")` to both models
    - Run `npx prisma migrate deploy && npx prisma generate`

  - [x] 2.2 Seed educational gift collection
    - Add 20 educational gifts to `Gift` table via seed script or migration data
    - Gifts: Notebook, Book, Golden Pencil, Certificate, Graduation Cap, Knowledge Tree, Microscope, Telescope, Laptop, Library, Globe, Teacher Medal, Star Student, Golden Trophy, Brain, Rocket, Diamond Book, Magic Blackboard, Wisdom Crown, Scholarship Award
    - Use rarity/price/animationType from design doc table

- [x] 3. Backend: Live class gift routes
  - [x] 3.1 Add gift endpoints to `live-class.routes.js`
    - `POST /:id/gifts` — single recipient (sets `req.roomType = 'live_class'`, delegates to `sendGift`)
    - `POST /:id/gifts/all` — all-stage (sets `req.roomType = 'live_class'`, delegates to `sendGiftToAll`)
    - `GET /:id/gifts/leaderboard` — room leaderboard
    - `GET /:id/gifts/history` — gift history
    - `GET /:id/gifts/top-supporters` — top 3 gifters
    - Apply `giftRateLimit` middleware on send routes
    - Apply input validation (same as voice routes)

- [x] 4. Frontend: Gift permission engine
  - [x] 4.1 Create `frontend/src/lib/giftPermissions.ts`
    - Export `RoomGiftSettings` interface
    - Export `DEFAULT_LIVE_CLASS_SETTINGS` constant
    - Export `DEFAULT_VOICE_SETTINGS` constant
    - Export `giftPermissionEngine.check(senderRole, recipientRole, settings): boolean`

  - [x] 4.2 Create `frontend/src/lib/giftAdapter.ts`
    - Export `RoomGiftAdapter` interface
    - Export `createLiveClassAdapter(liveClassId, participants, settings): RoomGiftAdapter`
    - Export `createVoiceAdapter(roomId, speakers, settings): RoomGiftAdapter`

- [x] 5. Frontend: `useGiftEngine` hook
  - [x] 5.1 Create `frontend/src/hooks/useGiftEngine.ts`
    - Subscribe to `gift:sent`, `liveclass:gift_sent`, `voice:gift_sent` socket events
    - Call `addGiftEvent` from `useVoiceStore` on each event
    - Call `deductCoins` after successful send
    - Return `{ sendGift, sendGiftToAll, wallet, isGiftPanelOpen, toggleGiftPanel }`
    - Low-end device detection: `navigator.hardwareConcurrency <= 2 || (navigator as any).deviceMemory <= 2`

- [x] 6. Frontend: Wire gifts into LiveClassRoomImpl
  - [x] 6.1 Add gift state and handlers to `LiveClassRoomImpl.tsx`
    - Import `useGiftEngine`, `GiftPanel`, `GiftOverlay`, `PremiumGiftOverlay`
    - Create `liveClassAdapter` using `createLiveClassAdapter`
    - Call `useGiftEngine({ adapter: liveClassAdapter })`
    - Add gift Socket.IO listener: `liveclass:gift_sent` → `addGiftEvent`
    - Wallet state: reuse `useVoiceStore().wallet`; fetch on join via `GET /wallets/me`

  - [x] 6.2 Add gift button to controls bar
    - Add `Gift` (🎁) button between Emoji and Chat buttons
    - `onClick={() => toggleGiftPanel()`
    - Active state: `isGiftPanelOpen`
    - Hidden when `!lc.giftsEnabled` (new optional field, defaults true)

  - [x] 6.3 Render `GiftPanel` above controls bar
    - `<AnimatePresence>{isGiftPanelOpen && <GiftPanel receivers={participants.map(adapter.mapParticipants)} onClose={toggleGiftPanel} onSendGift={sendGift} onSendGiftAll={sendGiftToAll} />}</AnimatePresence>`
    - Passes `liveClassId` as `roomId` to panel

  - [x] 6.4 Render `GiftOverlay` and `PremiumGiftOverlay` in animation layer
    - Add `<GiftOverlay />` and `<PremiumGiftOverlay />` inside `LiveClassRoomImpl`
    - Position: `position: fixed, z-index: 400` — independent of room content
    - Skip rendering when `isLowEndDevice`

- [x] 7. Frontend: Teacher earnings widget
  - [x] 7.1 Create `frontend/src/components/live-class/GiftEarningsWidget.tsx`
    - Fetch `GET /live-classes/:id/gifts/top-supporters`
    - Fetch `GET /live-classes/:id/gifts/leaderboard`
    - Show: top 3 supporters with avatar + name + coins, total diamonds earned this session
    - Only visible to HOST role
    - Collapsible — starts collapsed, expand on tap

  - [x] 7.2 Wire `GiftEarningsWidget` into `LiveClassHostControls.tsx`
    - Add "🎁 Gifts" section in the host controls panel
    - Show `GiftEarningsWidget` below class settings

- [x] 8. Checkpoint — verify end-to-end gift flow in live class
  - Start a live class, join as student, send a gift to teacher
  - Verify: coins deducted, diamonds credited, animation plays, leaderboard updates
  - Verify: voice club gifts still work (no regression)

---

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1"] },
    { "id": 2, "tasks": ["2.2", "3.1"] },
    { "id": 3, "tasks": ["4.1", "4.2"] },
    { "id": 4, "tasks": ["5.1"] },
    { "id": 5, "tasks": ["6.1"] },
    { "id": 6, "tasks": ["6.2", "6.3", "6.4", "7.1"] },
    { "id": 7, "tasks": ["7.2"] },
    { "id": 8, "tasks": ["8"] }
  ]
}
```
