'use strict';
/**
 * roleGuard.js — Server-side Role Field Protection
 * ─────────────────────────────────────────────────────────────────────────────
 * Provides utility functions that enforce server-side control over User.role
 * and SchoolMembership.role fields.
 *
 * SECURITY PRINCIPLE:
 *   - User.role = 'SUPER_ADMIN' must NEVER be written through ordinary
 *     application code paths (registration, profile update, school operations).
 *   - User.role must always be server-controlled (hardcoded values only).
 *   - SchoolMembership.role must be constrained to the allowed education roles.
 *   - Request body data must never reach Prisma role fields unchecked.
 *
 * USAGE:
 *   const { assertSafeUserRole, assertSafeMembershipRole, sanitizeUserData,
 *           ALLOWED_MEMBERSHIP_ROLES } = require('../utils/roleGuard');
 *
 *   // Before writing User.role from application logic:
 *   assertSafeUserRole(role);  // throws if SUPER_ADMIN attempted
 *
 *   // Before writing SchoolMembership.role:
 *   assertSafeMembershipRole(role);  // throws if invalid
 *
 *   // Strip role from any object derived from request body:
 *   const safeData = sanitizeUserData(req.body);  // role field removed
 */

const logger = require('./logger');

// ─── Allowed values ───────────────────────────────────────────────────────────

/**
 * Roles that can be assigned to SchoolMembership.role through application APIs.
 * SUPER_ADMIN is intentionally excluded — it must not be assignable via invite
 * or membership management APIs.
 */
const ALLOWED_MEMBERSHIP_ROLES = Object.freeze([
  'SCHOOL_ADMIN',
  'TEACHER',
  'STUDENT',
  'GUARDIAN',
]);

/**
 * Roles that can be assigned to User.role through ordinary application code.
 * SUPER_ADMIN is excluded — it can only be set through the internal provisioning
 * endpoint (internal.routes.js) which is separately guarded.
 */
const ALLOWED_USER_ROLES_APP = Object.freeze([
  'MEMBER',
  'SCHOOL_ADMIN',
  'TEACHER',
  'STUDENT',
  'GUARDIAN',
  'REPRESENTATIVE',
]);

// ─── Assertion functions ──────────────────────────────────────────────────────

/**
 * Assert that a role value is safe to write to User.role through application code.
 * Throws an error if SUPER_ADMIN or an unknown role is attempted.
 *
 * @param {string} role
 * @param {string} [context='unknown'] — calling context for logging
 * @throws {Error} if role is SUPER_ADMIN or not in ALLOWED_USER_ROLES_APP
 */
function assertSafeUserRole(role, context = 'unknown') {
  if (role === 'SUPER_ADMIN') {
    const msg = `[roleGuard] PRIVILEGE ESCALATION BLOCKED: Attempt to set User.role = 'SUPER_ADMIN' through application code (context: ${context}). Use the internal provisioning endpoint.`;
    logger.error(msg);
    throw new Error('SUPER_ADMIN role cannot be assigned through this operation');
  }
  if (!ALLOWED_USER_ROLES_APP.includes(role)) {
    const msg = `[roleGuard] INVALID ROLE BLOCKED: Attempt to set User.role = '${role}' (context: ${context}). Allowed: ${ALLOWED_USER_ROLES_APP.join(', ')}`;
    logger.error(msg);
    throw new Error(`Invalid role '${role}'`);
  }
}

/**
 * Assert that a role value is safe to write to SchoolMembership.role.
 * Throws an error if SUPER_ADMIN or an invalid role is attempted.
 *
 * @param {string} role
 * @param {string} [context='unknown']
 * @throws {Error} if role is not in ALLOWED_MEMBERSHIP_ROLES
 */
function assertSafeMembershipRole(role, context = 'unknown') {
  if (!ALLOWED_MEMBERSHIP_ROLES.includes(role)) {
    const msg = `[roleGuard] INVALID MEMBERSHIP ROLE BLOCKED: Attempt to set SchoolMembership.role = '${role}' (context: ${context}). Allowed: ${ALLOWED_MEMBERSHIP_ROLES.join(', ')}`;
    logger.error(msg);
    throw new Error(`Invalid membership role '${role}'`);
  }
}

// ─── Sanitization helpers ─────────────────────────────────────────────────────

/**
 * Strip role field (and other privileged fields) from any object derived from
 * request body before it reaches Prisma. Use this as a defense-in-depth layer
 * wherever req.body might contain a role field.
 *
 * Fields removed:
 *   - role         (never accept from client for User operations)
 *   - passwordHash (never accept from client)
 *   - deletedAt    (never accept from client — soft-delete is server-controlled)
 *   - status       (removed unless explicitly allowed by the endpoint)
 *   - schoolId     (removed unless explicitly set by server-side context)
 *   - emailVerified (server-controlled only)
 *   - mustChangePassword (server-controlled only)
 *
 * @param {Object} data — object to sanitize (typically req.body or subset of it)
 * @returns {Object} new object with privileged fields removed
 */
function sanitizeUserData(data) {
  if (!data || typeof data !== 'object') return {};
  const {
    role,
    passwordHash,
    deletedAt,
    status,
    schoolId,
    emailVerified,
    mustChangePassword,
    twoFactorSecret,
    twoFactorEnabled,
    ...safe
  } = data;
  // Log if any privileged fields were in the input (could indicate attack attempt)
  const stripped = { role, passwordHash, deletedAt, status, schoolId, emailVerified, mustChangePassword, twoFactorSecret, twoFactorEnabled };
  const found = Object.entries(stripped).filter(([, v]) => v !== undefined).map(([k]) => k);
  if (found.length > 0) {
    logger.warn(`[roleGuard] sanitizeUserData stripped privileged fields: ${found.join(', ')}`);
  }
  return safe;
}

/**
 * Strip privileged fields from SchoolMembership data coming from untrusted input.
 * Only status changes from application APIs — role must be explicitly set.
 *
 * @param {Object} data
 * @returns {Object}
 */
function sanitizeMembershipData(data) {
  if (!data || typeof data !== 'object') return {};
  const { role, userId, schoolId, deletedAt, invitedBy, joinedAt, ...safe } = data;
  return safe;
}

/**
 * Validate a role value from req.body for membership operations.
 * Returns the validated role if safe, throws if not.
 *
 * @param {*} rawRole — value from req.body.role
 * @param {string} [context]
 * @returns {string} validated role
 */
function validateMembershipRoleFromBody(rawRole, context = 'unknown') {
  if (typeof rawRole !== 'string') {
    throw new Error('role must be a string');
  }
  assertSafeMembershipRole(rawRole, context);
  return rawRole;
}

module.exports = {
  ALLOWED_MEMBERSHIP_ROLES,
  ALLOWED_USER_ROLES_APP,
  assertSafeUserRole,
  assertSafeMembershipRole,
  sanitizeUserData,
  sanitizeMembershipData,
  validateMembershipRoleFromBody,
};
