/**
 * giftAdapter.ts — Universal Gift Engine Room Adapters
 *
 * Each room type supplies an adapter that maps its participant model
 * to the generic GiftRecipient shape consumed by GiftPanel.
 * Add new room types here — never modify gift.controller.js or GiftPanel.
 */

import type { VoiceParticipant } from '@/store/voice.store'
import {
  type RoomGiftSettings,
  DEFAULT_LIVE_CLASS_SETTINGS,
  DEFAULT_VOICE_SETTINGS,
  giftPermissionEngine,
} from './giftPermissions'

// ─── Generic recipient shape consumed by GiftPanel ────────────────────────────
export interface GiftRecipient {
  userId:    string
  role:      string
  user: {
    id:        string
    firstName: string
    lastName:  string
    avatarUrl: string | null
  }
}

// ─── Room Adapter interface ───────────────────────────────────────────────────
export interface RoomGiftAdapter {
  roomType:       'voice' | 'live_class' | 'video_live' | 'pk' | 'community'
  roomId:         string
  sendUrl:        string
  sendAllUrl:     string
  leaderboardUrl: string
  historyUrl:     string
  socketRoom:     string
  settings:       RoomGiftSettings
  mapParticipants: (raw: any[]) => GiftRecipient[]
  canSend:         (senderRole: string, recipientRole: string) => boolean
}

// ─── Live Class Adapter ───────────────────────────────────────────────────────
export function createLiveClassAdapter(
  liveClassId:  string,
  settings:     RoomGiftSettings = DEFAULT_LIVE_CLASS_SETTINGS,
): RoomGiftAdapter {
  return {
    roomType:       'live_class',
    roomId:         liveClassId,
    sendUrl:        `/live-classes/${liveClassId}/gifts`,
    sendAllUrl:     `/live-classes/${liveClassId}/gifts/all`,
    leaderboardUrl: `/live-classes/${liveClassId}/gifts/leaderboard`,
    historyUrl:     `/live-classes/${liveClassId}/gifts/history`,
    socketRoom:     `liveclass:${liveClassId}`,
    settings,
    mapParticipants: (participants: any[]): GiftRecipient[] =>
      participants.map(p => ({
        userId: p.userId,
        role:   p.role,
        user: {
          id:        p.user?.id        ?? p.userId,
          firstName: p.user?.firstName ?? '',
          lastName:  p.user?.lastName  ?? '',
          avatarUrl: p.user?.avatarUrl ?? null,
        },
      })),
    canSend: (senderRole, recipientRole) =>
      giftPermissionEngine.check(senderRole, recipientRole, settings),
  }
}

// ─── Voice Club Adapter ───────────────────────────────────────────────────────
export function createVoiceAdapter(
  roomId:   string,
  settings: RoomGiftSettings = DEFAULT_VOICE_SETTINGS,
): RoomGiftAdapter {
  return {
    roomType:       'voice',
    roomId,
    sendUrl:        `/voice/${roomId}/gifts`,
    sendAllUrl:     `/voice/${roomId}/gifts/all`,
    leaderboardUrl: `/voice/${roomId}/gifts/leaderboard`,
    historyUrl:     `/voice/${roomId}/gifts/history`,
    socketRoom:     `voice:${roomId}`,
    settings,
    mapParticipants: (participants: VoiceParticipant[]): GiftRecipient[] =>
      participants.map(p => ({
        userId: p.userId,
        role:   p.role,
        user: {
          id:        p.user.id,
          firstName: p.user.firstName,
          lastName:  p.user.lastName,
          avatarUrl: p.user.avatarUrl,
        },
      })),
    canSend: (senderRole, recipientRole) =>
      giftPermissionEngine.check(senderRole, recipientRole, settings),
  }
}
