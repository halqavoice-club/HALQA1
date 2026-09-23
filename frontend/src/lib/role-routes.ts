/**
 * role-routes.ts
 *
 * Social platform route access configuration.
 *
 * IMPORTANT ARCHITECTURE NOTE:
 * ─────────────────────────────
 * This file controls SOCIAL platform access only.
 * Education features (/students, /classes, /attendance, etc.) are controlled
 * by school membership and school role, NOT by the global user.role.
 * See: useSchoolAccess.ts for Education authorization.
 *
 * The global user.role values are:
 *   MEMBER        — Social-only user (no school membership required)
 *   SUPER_ADMIN   — Legacy: global platform admin (also a school admin)
 *   SCHOOL_ADMIN  — Legacy: school admin (kept for backward compat)
 *   TEACHER       — Legacy: school teacher (kept for backward compat)
 *   STUDENT       — Legacy: school student (kept for backward compat)
 *   GUARDIAN      — Legacy: school guardian (kept for backward compat)
 *   REPRESENTATIVE — Legacy: representative (kept for backward compat)
 *
 * For NEW users: role is MEMBER. Education roles live in SchoolMembership.
 * For EXISTING users: role is their legacy Education role. They also have
 *   normal Social access (all legacy roles can use the Social platform).
 *
 * Rule: ALL authenticated users (any role) have Social platform access.
 * Education access is determined separately by school membership.
 */

export type UserRole =
  | 'MEMBER'
  | 'SUPER_ADMIN'
  | 'SCHOOL_ADMIN'
  | 'TEACHER'
  | 'STUDENT'
  | 'GUARDIAN'
  | 'REPRESENTATIVE'

interface RoleConfig {
  defaultRoute: string
  label: string
  color: string
  // '*' means all routes are allowed (only restricted ones are blocked)
  allowedRoutes: string[]
  // Routes this role CANNOT access (checked before allowedRoutes)
  restrictedRoutes: string[]
}

// ─── Social platform route config ────────────────────────────────────────────
// These routes are available to ALL authenticated users regardless of role.
// Education routes (/students, /classes, etc.) are not listed here because
// they are controlled by SchoolMembership, not global role.
const SOCIAL_ROUTES = [
  '/dashboard',
  '/feed', '/explore', '/communities', '/voice-club', '/live-class', '/live-stream',
  '/dm', '/group-chat', '/messages', '/social',
  '/creator', '/wallet', '/marketplace',
  '/notifications', '/profile', '/settings',
  '/access-denied',
  '/school-memberships', // school switcher — all authenticated users
  '/education',          // Education hub — all users with school membership
  '/my-id-card',         // Own student ID card — students only (page handles its own guard)
]

export const ROLE_CONFIG: Record<UserRole, RoleConfig> = {
  // ── New Social-only users ──────────────────────────────────────────────────
  MEMBER: {
    defaultRoute: '/feed',
    label: 'Member',
    color: 'bg-blue-100 text-blue-700',
    // ALL routes are potentially accessible — education routes are gated by school
    // membership on the backend. The frontend only guards against routes that are
    // truly off-limits for users with NO school at all (handled in useRoleAccess
    // by checking memberships.length before blocking).
    allowedRoutes: [
      ...SOCIAL_ROUTES,
      '/leaderboard',
      '/schools',
      '/school-memberships',
      '/education',
      // Education routes — accessible when user has a school membership.
      // Backend enforces school membership + role on every API call.
      '/students', '/teachers', '/guardians', '/classes',
      '/attendance', '/grades', '/behavior', '/activities',
      '/fees', '/terms', '/reports', '/schedule',
      '/audio', '/notes', '/library',
      '/assignments', '/exams', '/certificates',
      '/analytics', '/leaderboard',
      '/announcements', '/calendar',
    ],
    restrictedRoutes: [
      // Platform admin routes — MEMBER users cannot access these ever
      '/admin',
      // Import/audit require SCHOOL_ADMIN — but these are also protected by backend
      '/import', '/audit', '/users',
    ]
  },

  // ── Legacy global roles — ALL have Social access ──────────────────────────
  // Social is NOT restricted for any legacy role.
  // Education routes are visible based on school membership (sidebar handles this).

  SUPER_ADMIN: {
    defaultRoute: '/admin',
    label: 'Super Admin',
    color: 'bg-red-100 text-red-700',
    // SA-ROUTE-01: SUPER_ADMIN = Platform Administration ONLY.
    // Can access admin panel + read-only social pages (feed, explore — for moderation oversight).
    // CANNOT access social content creation pages or school education pages.
    allowedRoutes: [
      '/dashboard',
      '/admin',          // Platform admin panel (all sub-pages)
      '/profile',        // Own profile view
      '/settings',       // Account settings
      '/notifications',  // Notification inbox (receives report alerts)
      '/access-denied',
      '/schools',        // School list (read — for admin overview)
      // Read-only social oversight (no creation UI shown — blocked in components)
      '/feed',
      '/explore',
      '/communities',
      '/voice-club',
      '/live-class',
      '/live-stream',  // Public live streams — SA can view for moderation
    ],
    restrictedRoutes: [
      // Social content creation — SUPER_ADMIN must not post/comment/react
      '/create-post',
      '/reels',          // Content creation surface
      // Social participation features
      '/dm',
      '/group-chat',
      '/messages',
      '/social',
      '/creator',
      '/wallet',
      '/marketplace',
      '/leaderboard',
      // School education features — SUPER_ADMIN has no school membership context
      '/students', '/teachers', '/guardians', '/classes',
      '/attendance', '/grades', '/behavior', '/activities',
      '/fees', '/terms', '/reports', '/schedule',
      '/audio', '/notes', '/library',
      '/import', '/audit',
      '/assignments', '/exams', '/certificates',
      '/analytics', '/users',
      '/announcements', '/calendar',
      // School membership switcher — SUPER_ADMIN uses /admin/schools instead
    ]
  },

  SCHOOL_ADMIN: {
    defaultRoute: '/feed',
    label: 'School Admin',
    color: 'bg-purple-100 text-purple-700',
    allowedRoutes: ['*'],
    restrictedRoutes: [] // SCHOOL_ADMIN can view /schools (their own school card)
  },

  TEACHER: {
    defaultRoute: '/feed',
    label: 'Teacher (Ustaaz)',
    color: 'bg-green-100 text-green-700',
    // Full social access + relevant education routes
    allowedRoutes: [
      ...SOCIAL_ROUTES,
      '/dashboard', '/attendance', '/students', '/classes',
      '/grades', '/behavior', '/activities',
      '/announcements', '/calendar', '/schedule', '/notes',
      '/audio', '/live-class', '/library',
      '/reports', '/assignments', '/exams', '/leaderboard',
      '/schools',            // "My School" page
      '/school-memberships', // school switcher
      '/education',          // Education hub
    ],
    restrictedRoutes: [
      '/users', '/audit', '/import', '/fees',
      '/teachers/new', '/teachers/edit',
      '/guardians/new', '/guardians/edit',
      '/terms'
    ]
  },

  STUDENT: {
    defaultRoute: '/feed',
    label: 'Student',
    color: 'bg-blue-100 text-blue-700',
    // Full social access + student education routes
    allowedRoutes: [
      ...SOCIAL_ROUTES,
      '/dashboard', '/grades', '/attendance', '/behavior', '/notes',
      '/announcements', '/calendar',
      '/audio', '/live-class',
      '/library',
      '/assignments', '/exams', '/leaderboard',
      '/schools',       // "My School" page
      '/school-memberships', // school switcher
      '/education',     // Education hub
      '/my-id-card',    // Own student ID card
      '/students',      // View own student profile
      '/schedule',      // Class schedule
    ],
    restrictedRoutes: [
      '/students/new',
      '/teachers', '/guardians', '/classes',
      '/users', '/audit', '/import', '/fees',
      '/terms', '/reports',
      '/activities',
    ]
  },

  GUARDIAN: {
    defaultRoute: '/feed',
    label: 'Guardian / Parent',
    color: 'bg-orange-100 text-orange-700',
    // Full social access + guardian education routes
    allowedRoutes: [
      ...SOCIAL_ROUTES,
      '/dashboard', '/announcements', '/attendance', '/grades',
      '/calendar', '/live-class',
      '/leaderboard',
      '/schools',            // "My School" page
      '/school-memberships', // school switcher
      '/education',          // Education hub
      '/students',           // View linked student profiles + their ID cards
    ],
    restrictedRoutes: [
      '/students/new', '/teachers', '/classes',
      '/behavior',
      '/users', '/audit', '/import',
      '/fees', '/terms', '/reports',
      '/audio', '/activities', '/notes'
    ]
  },

  REPRESENTATIVE: {
    defaultRoute: '/feed',
    label: 'Representative',
    // NOTE: REPRESENTATIVE is a legacy role with no defined Education domain meaning.
    // It behaves like MEMBER (Social-only access). If you need school-scoped
    // representative functionality, use SchoolMembership with a custom role string.
    // This role is kept to avoid breaking existing DB records and will be formally
    // deprecated in a future migration.
    color: 'bg-gray-100 text-gray-700',
    allowedRoutes: [
      ...SOCIAL_ROUTES,
      '/dashboard', '/students', '/classes',
      '/announcements', '/leaderboard',
    ],
    restrictedRoutes: []
  }
}

/**
 * Get the default route for a role after login.
 */
export function getDefaultRoute(role: string): string {
  return ROLE_CONFIG[role as UserRole]?.defaultRoute || '/dashboard'
}

/**
 * Check if a role can access a given route.
 * This checks SOCIAL platform access only.
 * Education route access is handled by useSchoolAccess().
 */
export function canAccessRoute(role: string, pathname: string): boolean {
  const config = ROLE_CONFIG[role as UserRole]

  // Unknown role — treat as MEMBER (social-only access)
  if (!config) {
    return ROLE_CONFIG.MEMBER.allowedRoutes.some(r =>
      pathname === r || pathname.startsWith(r + '/')
    ) && !ROLE_CONFIG.MEMBER.restrictedRoutes.some(r => pathname.startsWith(r))
  }

  // Wildcard — can access everything except restricted
  if (config.allowedRoutes.includes('*')) {
    return !config.restrictedRoutes.some(r => pathname.startsWith(r))
  }

  // Check restricted routes first (more specific wins)
  if (config.restrictedRoutes.some(r => pathname.startsWith(r))) return false

  // Check allowed routes
  return config.allowedRoutes.some(r => pathname === r || pathname.startsWith(r + '/'))
}

/**
 * Get role display info.
 */
export function getRoleInfo(role: string) {
  return ROLE_CONFIG[role as UserRole] || {
    label: role || 'User',
    color: 'bg-gray-100 text-gray-700'
  }
}

/**
 * Check if a role is an Education (school-scoped) role.
 * These roles have school memberships; their Education permissions
 * should be determined by SchoolMembership, not this config.
 */
export function isEducationRole(role: string): boolean {
  return ['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER', 'STUDENT', 'GUARDIAN'].includes(role)
}

/**
 * Check if a user has Social platform access (all authenticated users do).
 */
export function hasSocialAccess(role: string): boolean {
  // All authenticated users have social access — the role doesn't restrict it
  return true
}
