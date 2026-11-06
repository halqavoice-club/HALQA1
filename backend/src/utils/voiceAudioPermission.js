"use strict";

const SPEAKING_ROLES = new Set(["HOST", "MODERATOR", "SPEAKER"]);
const PRIVILEGED_ROLES = new Set(["HOST", "MODERATOR"]);

/**
 * Compute the effective Voice Club microphone publication permission.
 *
 * Precedence is fail-closed:
 * room data available -> participant data complete -> active membership ->
 * stage seat/role -> individual moderator lock -> local/self mute intent ->
 * mic lock -> room-wide mute.
 *
 * HOST/MODERATOR retain the existing product exemptions for micLocked and
 * allMuted. They are deliberately NOT exempt from mutedByModerator or isMuted:
 * an individual lock cannot be self-cleared through role privilege, and a
 * restriction release never overrides the user's local microphone consent.
 *
 * Any missing or invalid authorization data denies publication.
 */
function getVoiceAudioPermission({ participant, room }) {
  // Validate room authorization data is available
  if (!room || typeof room !== "object") {
    return { canPublishAudio: false, reason: "NO_ROOM_DATA" };
  }

  // Validate required room authorization fields
  if (typeof room.micLocked !== "boolean" || typeof room.allMuted !== "boolean") {
    return { canPublishAudio: false, reason: "INVALID_ROOM_AUTHORIZATION" };
  }

  // Validate participant data is available
  if (!participant || typeof participant !== "object") {
    return { canPublishAudio: false, reason: "NO_PARTICIPANT_DATA" };
  }

  // Validate participant is active
  if (!participant.isActive) {
    return { canPublishAudio: false, reason: "INACTIVE" };
  }

  // Validate participant has eligible role
  if (!participant.role || !SPEAKING_ROLES.has(participant.role)) {
    return { canPublishAudio: false, reason: "ROLE_NOT_ELIGIBLE" };
  }

  // Validate participant has stage seat
  if (participant.seatNumber == null) {
    return { canPublishAudio: false, reason: "NOT_ON_STAGE" };
  }

  // Validate required participant authorization fields
  if (
    typeof participant.mutedByModerator !== "boolean" ||
    typeof participant.isMuted !== "boolean"
  ) {
    return { canPublishAudio: false, reason: "INVALID_PARTICIPANT_AUTHORIZATION" };
  }

  // Check moderator mute (precedence over self-mute)
  if (participant.mutedByModerator) {
    return { canPublishAudio: false, reason: "MUTED_BY_MODERATOR" };
  }

  // Check self-mute consent
  if (participant.isMuted) {
    return { canPublishAudio: false, reason: "SELF_MUTED" };
  }

  // Apply room-wide restrictions (HOST/MODERATOR exempt)
  const isPrivileged = PRIVILEGED_ROLES.has(participant.role);
  if (room.micLocked && !isPrivileged) {
    return { canPublishAudio: false, reason: "MIC_LOCKED" };
  }

  if (room.allMuted && !isPrivileged) {
    return { canPublishAudio: false, reason: "ALL_MUTED" };
  }

  return { canPublishAudio: true, reason: "ALLOWED" };
}

module.exports = {
  getVoiceAudioPermission,
  SPEAKING_ROLES,
  PRIVILEGED_ROLES,
};
