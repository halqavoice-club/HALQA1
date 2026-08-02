/**
 * Voice Room Role-Based Access Control Middleware
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ROLE HIERARCHY (highest → lowest):
 *   HOST       — full control, 1 per room
 *   MODERATOR  — co-host, assigned by HOST
 *   SPEAKER    — can speak, no moderation
 *   AUDIENCE   — listen only, can raise hand
 *
 * PERMISSION MATRIX:
 * ┌─────────────────────────────────┬──────┬───────────┬─────────┬──────────┐
 * │ Action                          │ HOST │ MODERATOR │ SPEAKER │ AUDIENCE │
 * ├─────────────────────────────────┼──────┼───────────┼─────────┼──────────┤
 * │ Create / end room               │  ✅  │    ❌     │   ❌    │    ❌    │
 * │ Assign / remove moderator       │  ✅  │    ❌     │   ❌    │    ❌    │
 * │ Transfer admin (ownership)      │  ✅  │    ❌     │   ❌    │    ❌    │
 * │ Approve / reject speaker queue  │  ✅  │    ✅     │   ❌    │    ❌    │
 * │ Mute / unmute others            │  ✅  │    ✅     │   ❌    │    ❌    │
 * │ Kick participants               │  ✅  │    ✅*    │   ❌    │    ❌    │
 * │ Promote audience → speaker      │  ✅  │    ✅     │   ❌    │    ❌    │
 * │ Demote speaker → audience       │  ✅  │    ✅     │   ❌    │    ❌    │
 * │ Mute / unmute self              │  ✅  │    ✅     │   ✅    │    ❌    │
 * │ Raise hand                      │  ❌  │    ❌     │   ❌    │    ✅    │
 * │ Send chat                       │  ✅  │    ✅     │   ✅    │    ✅    │
 * │ Send reactions                  │  ✅  │    ✅     │   ✅    │    ✅    │
 * └─────────────────────────────────┴──────┴───────────┴─────────┴──────────┘
 * * MODERATOR cannot kick HOST or other MODERATORs
 *
 * Usage:
 *   const { checkVoiceRole, VOICE_ROLES } = require('../middleware/voiceRole.middleware');
 *
 *   // Require HOST only
 *   router.patch('/:id/end', checkVoiceRole(['HOST']), endRoom);
 *
 *   // Require HOST or MODERATOR
 *   router.patch('/:id/mute', checkVoiceRole(['HOST', 'MODERATOR']), toggleMute);
 * ─────────────────────────────────────────────────────────────────────────────
 */

const prisma = require('../utils/prisma');
const { errorResponse } = require('../utils/response');

// ─── Role constants ───────────────────────────────────────────────────────────
const VOICE_ROLES = {
  HOST:      'HOST',
  MODERATOR: 'MODERATOR',
  SPEAKER:   'SPEAKER',
  AUDIENCE:  'AUDIENCE'
};

// Roles that can moderate (approve queue, mute, kick, promote)
const MODERATOR_ROLES = [VOICE_ROLES.HOST, VOICE_ROLES.MODERATOR];

// Roles that can speak (publish audio)
const SPEAKER_ROLES = [VOICE_ROLES.HOST, VOICE_ROLES.MODERATOR, VOICE_ROLES.SPEAKER];

// ─── Middleware factory ───────────────────────────────────────────────────────
/**
 * checkVoiceRole(allowedRoles)
 *
 * Fetches the caller's VoiceParticipant record for the room in :id
 * and checks their role against allowedRoles.
 *
 * Attaches req.voiceParticipant for downstream use.
 */
function checkVoiceRole(allowedRoles) {
  return async (req, res, next) => {
    try {
      const roomId = req.params.id;
      const userId = req.user.id;

      if (!roomId) return errorResponse(res, 'Room ID required', 400);

      const participant = await prisma.voiceParticipant.findUnique({
        where: { roomId_userId: { roomId, userId } }
      });

      if (!participant || !participant.isActive) {
        return errorResponse(res, 'You are not an active participant in this room', 403);
      }

      if (!allowedRoles.includes(participant.role)) {
        return errorResponse(
          res,
          `This action requires one of: ${allowedRoles.join(', ')}. Your role: ${participant.role}`,
          403
        );
      }

      // Attach for downstream controllers (avoids re-fetching)
      req.voiceParticipant = participant;
      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * requireVoiceParticipant()
 *
 * Lighter version — just confirms the user is an active participant.
 * Does not check role. Attaches req.voiceParticipant.
 */
function requireVoiceParticipant() {
  return async (req, res, next) => {
    try {
      const roomId = req.params.id;
      const userId = req.user.id;

      const participant = await prisma.voiceParticipant.findUnique({
        where: { roomId_userId: { roomId, userId } }
      });

      if (!participant || !participant.isActive) {
        return errorResponse(res, 'You are not an active participant in this room', 403);
      }

      req.voiceParticipant = participant;
      next();
    } catch (error) {
      next(error);
    }
  };
}

module.exports = { checkVoiceRole, requireVoiceParticipant, VOICE_ROLES, MODERATOR_ROLES, SPEAKER_ROLES };
