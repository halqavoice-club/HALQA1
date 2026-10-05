'use strict';

/**
 * educationAuth.js
 *
 * Convenience re-exports + composites for Education route authorization.
 *
 * Instead of repeating:
 *   requireSchoolMember(), requireSchoolRole('TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN')
 *
 * on every route, use the named composites here:
 *
 *   const { eduMember, eduAdmin, eduStaff, eduAll } = require('../middleware/educationAuth')
 *
 *   router.get('/',   ...eduAll,   ctrl.list)     // any school member
 *   router.post('/',  ...eduStaff, ctrl.create)   // teacher + admin
 *   router.delete('/',...eduAdmin, ctrl.delete)   // admin only
 *
 * Each composite is an array of middleware — spread it into the route args.
 *
 * BACKWARD COMPATIBILITY:
 *   The old authorize('SUPER_ADMIN', 'SCHOOL_ADMIN') checks against user.role
 *   (global role). These new composites check school_memberships (school-scoped).
 *   For existing users whose user.role === educationRole, both paths resolve
 *   identically. For new MEMBER users who joined a school, only the new path works.
 */

const { requireSchoolMember, requireSchoolRole } = require('./schoolAuth.middleware');

// ── Base: any authenticated school member (ACTIVE membership) ─────────────────
const eduMember = [
  requireSchoolMember(),
];

// ── Staff: teacher + admin roles ──────────────────────────────────────────────
// P3-001 FIX: Removed 'SUPER_ADMIN' from requireSchoolRole arrays.
// The Prisma schema states: "SUPER_ADMIN is NOT a valid school membership role."
// The DB CHECK constraint chk_membership_role (migration 20260821) enforces this.
// requireSchoolMember() already blocks platform SUPER_ADMIN before this check runs,
// so including 'SUPER_ADMIN' here is dead code and a defense-in-depth gap.
const eduStaff = [
  requireSchoolMember(),
  requireSchoolRole('TEACHER', 'SCHOOL_ADMIN'),
];

// ── Admin: school admin only ────────────────────────────────────────────────────
// P3-001 FIX: Removed 'SUPER_ADMIN' — same reasoning as eduStaff above.
const eduAdmin = [
  requireSchoolMember(),
  requireSchoolRole('SCHOOL_ADMIN'),
];

// ── Super admin only (school-scoped — requires SUPER_ADMIN SchoolMembership) ───
// NOTE: This is kept for completeness but should rarely be used.
// Platform SUPER_ADMIN (User.role = 'SUPER_ADMIN') is blocked by requireSchoolMember()
// and cannot reach requireSchoolRole(). This composite only passes if a user has
// a SchoolMembership with role = 'SUPER_ADMIN', which the DB CHECK constraint prevents.
// In practice, use authorize('SUPER_ADMIN') for platform admin operations instead.
const eduSuperAdmin = [
  requireSchoolMember(),
  requireSchoolRole('SUPER_ADMIN'),
];

// ── All education-aware: any member can view (read), staff can write ───────────
// Use separate GET / mutation middleware for fine-grained control.
const eduView = eduMember;   // alias — reads are accessible to all members

module.exports = {
  eduMember,
  eduStaff,
  eduAdmin,
  eduSuperAdmin,
  eduView,
  // Re-export primitives for custom combinations
  requireSchoolMember,
  requireSchoolRole,
};
