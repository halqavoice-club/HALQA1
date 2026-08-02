/**
 * Role-based routing configuration
 * Defines where each role lands after login and what they can access
 */

export type UserRole = 'SUPER_ADMIN' | 'SCHOOL_ADMIN' | 'TEACHER' | 'STUDENT' | 'GUARDIAN' | 'REPRESENTATIVE'

interface RoleConfig {
  defaultRoute: string
  label: string
  color: string
  // Routes this role CAN access (prefix match). '*' = all.
  allowedRoutes: string[]
  // Routes this role CANNOT access (checked before allowedRoutes)
  restrictedRoutes: string[]
}

export const ROLE_CONFIG: Record<UserRole, RoleConfig> = {
  SUPER_ADMIN: {
    defaultRoute: '/dashboard',
    label: 'Super Admin',
    color: 'bg-red-100 text-red-700',
    allowedRoutes: ['*'],
    restrictedRoutes: []
  },

  SCHOOL_ADMIN: {
    defaultRoute: '/dashboard',
    label: 'School Admin',
    color: 'bg-purple-100 text-purple-700',
    allowedRoutes: ['*'],
    restrictedRoutes: ['/schools'] // can't manage other schools
  },

  TEACHER: {
    defaultRoute: '/dashboard',
    label: 'Teacher (Ustaaz)',
    color: 'bg-green-100 text-green-700',
    allowedRoutes: [
      '/dashboard', '/attendance', '/students', '/classes',
      '/grades', '/behavior', '/activities', '/messages', '/dm',
      '/announcements', '/calendar', '/schedule', '/notes',
      '/audio', '/voice-club', '/live-class', '/library',
      '/social', '/wallet', '/reports',
      '/notifications', '/profile', '/settings',
      '/feed', '/explore', '/communities', '/creator',
      '/group-chat', '/assignments', '/exams', '/leaderboard',
      '/access-denied'
    ],
    restrictedRoutes: [
      '/users', '/schools', '/audit', '/import', '/fees',
      '/teachers/new', '/teachers/edit',
      '/guardians/new', '/guardians/edit',
      '/terms'
    ]
  },

  STUDENT: {
    defaultRoute: '/dashboard',
    label: 'Student',
    color: 'bg-blue-100 text-blue-700',
    allowedRoutes: [
      '/dashboard', '/grades', '/attendance', '/behavior', '/notes',
      '/announcements', '/calendar', '/messages', '/dm',
      '/audio', '/voice-club', '/live-class',
      '/library', '/social', '/wallet',
      '/notifications', '/profile',
      '/feed', '/explore', '/communities', '/creator',
      '/group-chat', '/assignments', '/exams', '/leaderboard',
      '/access-denied'
    ],
    restrictedRoutes: [
      '/students/new',
      '/teachers', '/guardians', '/classes',
      '/users', '/schools', '/audit', '/import', '/fees',
      '/terms', '/settings', '/reports',
      '/activities', '/schedule'
    ]
  },

  GUARDIAN: {
    defaultRoute: '/dashboard',
    label: 'Guardian / Parent',
    color: 'bg-orange-100 text-orange-700',
    allowedRoutes: [
      '/dashboard', '/announcements', '/attendance', '/grades',
      '/calendar', '/messages', '/dm',
      '/voice-club', '/live-class', '/social', '/wallet',
      '/notifications', '/profile',
      '/feed', '/explore', '/communities', '/leaderboard',
      '/access-denied'
    ],
    restrictedRoutes: [
      '/students/new', '/teachers', '/classes',
      '/behavior',
      '/users', '/schools', '/audit', '/import',
      '/fees', '/terms', '/settings', '/reports',
      '/audio', '/activities', '/schedule', '/notes'
    ]
  },

  REPRESENTATIVE: {
    defaultRoute: '/dashboard',
    label: 'Representative',
    color: 'bg-gray-100 text-gray-700',
    allowedRoutes: [
      '/dashboard', '/students', '/classes',
      '/announcements', '/voice-club', '/social', '/wallet',
      '/notifications', '/profile',
      '/feed', '/explore', '/communities', '/leaderboard',
      '/access-denied'
    ],
    restrictedRoutes: []
  }
}

/**
 * Get the default route for a role after login
 */
export function getDefaultRoute(role: string): string {
  return ROLE_CONFIG[role as UserRole]?.defaultRoute || '/dashboard'
}

/**
 * Check if a role can access a given route
 */
export function canAccessRoute(role: string, pathname: string): boolean {
  const config = ROLE_CONFIG[role as UserRole]
  if (!config) return false

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
 * Get role display info
 */
export function getRoleInfo(role: string) {
  return ROLE_CONFIG[role as UserRole] || {
    label: role,
    color: 'bg-gray-100 text-gray-700'
  }
}
