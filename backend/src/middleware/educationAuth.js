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
const eduStaff = [
  requireSchoolMember(),
  requireSchoolRole('TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN'),
];

// ── Admin: school admin + super admin only ────────────────────────────────────
const eduAdmin = [
  requireSchoolMember(),
  requireSchoolRole('SCHOOL_ADMIN', 'SUPER_ADMIN'),
];

// ── Super admin only ──────────────────────────────────────────────────────────
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
