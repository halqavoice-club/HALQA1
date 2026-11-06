"use strict";

const SPEAKING_ROLES = new Set(["HOST", "MODERATOR", "SPEAKER"]);
const PRIVILEGED_ROLES = new Set(["HOST", "MODERATOR"]);

/**
 * Compute the effective Voice Club microphone publication permission.
 *
 * Precedence is fail-closed:
 * active membership -> stage seat/role -> individual moderator lock ->
 * local/self mute intent -> mic lock -> room-wide mute.
 *
 * HOST/MODERATOR retain the existing product exemptions for micLocked and
 * allMuted. They are deliberately NOT exempt from mutedByModerator or isMuted:
 * an individual lock cannot be self-cleared through role privilege, and a
 * restriction release never overrides the user's local microphone consent.
 */
function getVoiceAudioPermission({ participant, room }) {
  if (!participant?.isActive) {
    return { canPublishAudio: false, reason: "INACTIVE" };
  }

  if (!SPEAKING_ROLES.has(participant.role)) {
    return { canPublishAudio: false, reason: "ROLE_NOT_ELIGIBLE" };
  }

  if (participant.seatNumber == null) {
    return { canPublishAudio: false, reason: "NOT_ON_STAGE" };
  }

  if (participant.mutedByModerator) {
    return { canPublishAudio: false, reason: "MUTED_BY_MODERATOR" };
  }

  if (participant.isMuted) {
    return { canPublishAudio: false, reason: "SELF_MUTED" };
  }

  const isPrivileged = PRIVILEGED_ROLES.has(participant.role);
  if (room?.micLocked && !isPrivileged) {
    return { canPublishAudio: false, reason: "MIC_LOCKED" };
  }

  if (room?.allMuted && !isPrivileged) {
    return { canPublishAudio: false, reason: "ALL_MUTED" };
  }

  return { canPublishAudio: true, reason: "ALLOWED" };
}

module.exports = {
  getVoiceAudioPermission,
  SPEAKING_ROLES,
  PRIVILEGED_ROLES,
};
