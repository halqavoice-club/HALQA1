/**
 * giftPermissions.ts — Universal Gift Permission Engine
 *
 * Configurable per room type. Never hardcode role names in gift logic.
 * All permission checks go through `giftPermissionEngine.check()`.
 */

export interface RoomGiftSettings {
  giftsEnabled:    boolean
  anonymousGifts:  boolean
  premiumOnly:     boolean
  /** Roles allowed to SEND gifts in this room */
  senderRoles:     string[]
  /** Roles allowed to RECEIVE gifts in this room */
  recipientRoles:  string[]
}

// ─── Default settings per room type ──────────────────────────────────────────

/** Live Class: everyone can send, teachers + students can receive */
export const DEFAULT_LIVE_CLASS_SETTINGS: RoomGiftSettings = {
  giftsEnabled:   true,
  anonymousGifts: false,
  premiumOnly:    false,
  senderRoles:    ['HOST', 'STUDENT', 'OBSERVER'],
  recipientRoles: ['HOST', 'STUDENT'],
}

/** Voice Club: all active participants can send, HOST/SPEAKER/MODERATOR can receive */
export const DEFAULT_VOICE_SETTINGS: RoomGiftSettings = {
  giftsEnabled:   true,
  anonymousGifts: false,
  premiumOnly:    false,
  senderRoles:    ['HOST', 'SPEAKER', 'MODERATOR', 'AUDIENCE'],
  recipientRoles: ['HOST', 'SPEAKER', 'MODERATOR'],
}

// ─── Permission engine ────────────────────────────────────────────────────────

export const giftPermissionEngine = {
  /**
   * Check whether a participant with `senderRole` may gift a participant with `recipientRole`
   * given the room's current gift settings.
   */
  check(
    senderRole:    string,
    recipientRole: string,
    settings:      RoomGiftSettings,
  ): boolean {
    if (!settings.giftsEnabled)                         return false
    if (!settings.senderRoles.includes(senderRole))     return false
    if (!settings.recipientRoles.includes(recipientRole)) return false
    return true
  },

  /** Check if the room has gifts enabled at all */
  isEnabled(settings: RoomGiftSettings): boolean {
    return settings.giftsEnabled
  },
}
