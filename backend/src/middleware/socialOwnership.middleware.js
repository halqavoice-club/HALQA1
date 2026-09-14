'use strict';
/**
 * socialOwnership.middleware.js
 *
 * SOCIAL CONTENT OWNERSHIP PRINCIPLE
 * ────────────────────────────────────
 * All personal and social content on the HALQA platform belongs exclusively
 * to the user who created it. No other role — not SUPER_ADMIN, not SCHOOL_ADMIN,
 * not TEACHER — may edit, mutate, or act on behalf of another user's:
 *
 *   • Profile (name, bio, avatar, username, phone, social links)
 *   • Posts, comments, reactions, bookmarks
 *   • Stories / Reels
 *   • Followers / following relationships
 *   • Friend requests and friendships
 *   • Block lists
 *   • Privacy settings
 *
 * This file provides two reusable middleware building blocks:
 *
 *   denyNonPlatformAdminEdit
 *     Blocks SCHOOL_ADMIN and TEACHER from any social mutation route.
 *     SUPER_ADMIN is the only non-owner role that may act on social content
 *     (for emergency platform moderation), and only where explicitly allowed.
 *
 *   requireSocialSelfOnly
 *     Blocks EVERY role except the authenticated user themselves.
 *     Used on profile-level mutations where even SUPER_ADMIN has no business.
 *
 * IMPORTANT: Frontend guards are NOT security. These middleware functions are
 * the authoritative enforcement layer — a malicious admin cannot bypass them
 * via Postman, curl, or a modified frontend payload.
 */

const { errorResponse } = require('../utils/response');

/**
 * SOCIAL SELF-ONLY guard.
 *
 * The authenticated user may only mutate their own social/profile data.
 * No admin role — not SUPER_ADMIN, not SCHOOL_ADMIN, not TEACHER — can act
 * on behalf of another user's personal/social content.
 *
 * Usage: Apply to routes where the target is always the authenticated user.
 *   PUT /users/profile
 *   PUT /users/username
 *   POST /users/avatar
 *   etc.
 *
 * This is already enforced on those routes by hardcoding `where: { id: req.user.id }`.
 * This middleware adds a belt-and-suspenders explicit check for future-proofing.
 */
function requireSocialSelf(req, res, next) {
  // If the route has a :userId or :id param that differs from the authenticated user,
  // reject it. Routes that mutate only req.user.id should never hit this case.
  const targetId = req.params.userId || req.params.id;
  if (targetId && targetId !== req.user.id) {
    return errorResponse(
      res,
      'You can only modify your own personal and social data.',
      403
    );
  }
  return next();
}

/**
 * SCHOOL ADMIN / TEACHER social content guard.
 *
 * SCHOOL_ADMIN and TEACHER are Education-domain roles scoped to school management.
 * They have no authority over any user's social/personal content on the platform.
 *
 * This middleware blocks any Education role (SCHOOL_ADMIN, TEACHER, GUARDIAN) from
 * mutating social content. SUPER_ADMIN is allowed through for platform-level emergency
 * moderation (e.g. deleting a post reported for illegal content).
 *
 * Apply to social mutation routes that should be SELF-only but where SUPER_ADMIN
 * retains emergency override:
 *   PATCH /posts/:id        (edit — owner only; SA cannot edit someone else's post)
 *   DELETE /posts/:id       (delete — owner or SA for moderation)
 *   DELETE /stories/:id     (delete — owner or SA for moderation)
 *   DELETE /posts/:id/comments/:cid  (owner or SA)
 *   etc.
 *
 * Note: SUPER_ADMIN CANNOT EDIT another user's post/story body/content.
 * SUPER_ADMIN can only DELETE for platform moderation. Editing is always self-only.
 */
function blockEducationRolesFromSocialMutation(req, res, next) {
  const educationRoles = ['SCHOOL_ADMIN', 'TEACHER', 'GUARDIAN', 'REPRESENTATIVE'];

  // Check the membership role (set by requireSchoolMember if present),
  // the global User.role (legacy users), and the JWT token role.
  // This ensures the check works whether the user is a new MEMBER with a school
  // membership OR a legacy user whose global role is SCHOOL_ADMIN/TEACHER.
  const membershipRole = req.schoolMembership?.role;
  const globalRole     = req.user?.role;
  // req.user is populated by authenticate() from the JWT token which may carry
  // the school-scoped role for legacy users
  const tokenRole      = req.auth?.role || req.user?.role;

  if (
    educationRoles.includes(globalRole) ||
    educationRoles.includes(membershipRole) ||
    educationRoles.includes(tokenRole)
  ) {
    return errorResponse(
      res,
      'School Admins and Teachers cannot modify social or personal content belonging to other users. Personal and social data belongs exclusively to the user.',
      403
    );
  }
  return next();
}

/**
 * SUPER_ADMIN social edit guard.
 *
 * Even SUPER_ADMIN cannot EDIT (change the content of) another user's social content.
 * SUPER_ADMIN can DELETE content for platform moderation, but cannot PUT/PATCH it.
 *
 * Apply to PATCH/PUT routes for posts, stories, comments, profile edits.
 */
function blockSuperAdminFromSocialEdit(req, res, next) {
  if (req.user?.role === 'SUPER_ADMIN') {
    return errorResponse(
      res,
      'Platform administrators cannot edit another user\'s social content. Use the admin panel to delete or report content.',
      403
    );
  }
  return next();
}

module.exports = {
  requireSocialSelf,
  blockEducationRolesFromSocialMutation,
  blockSuperAdminFromSocialEdit,
};
