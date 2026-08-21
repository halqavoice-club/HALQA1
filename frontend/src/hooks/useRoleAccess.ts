'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { useAuthStore } from '@/store/auth.store'
import { useSchoolAccess } from '@/hooks/useSchoolAccess'
import { canAccessRoute, getDefaultRoute } from '@/lib/role-routes'

// Pages that should never trigger an access-denied redirect
const ALWAYS_ALLOWED = [
  '/dashboard', '/access-denied', '/profile', '/notifications', '/settings/blocked',
  // School pages — all authenticated users can view their own school info
  '/schools',
  // Education onboarding pages — accessible without school membership
  '/schools/join', '/school-memberships/create',
]

/**
 * Hook that enforces role-based access control for the Social platform.
 *
 * ARCHITECTURE NOTE:
 * ──────────────────
 * New users have User.role = MEMBER. Their Education role (STUDENT/TEACHER/GUARDIAN/
 * SCHOOL_ADMIN) lives in SchoolMembership.role, not User.role.
 *
 * So for route access checks we must consider BOTH:
 *   1. user.role  — platform role (MEMBER, SUPER_ADMIN, or legacy education role)
 *   2. activeRole — school-scoped role from SchoolMembership (for new-arch users)
 *
 * A MEMBER with SchoolMembership.role = STUDENT should get STUDENT route access,
 * not MEMBER route access. We resolve the effective role for route checking here.
 *
 * NOTE: Hiding a route client-side is NOT authorization. The backend always
 * re-validates school membership and role server-side on every API call.
 */
export function useRoleAccess() {
  const { user, isAuthenticated } = useAuthStore()
  const { activeRole } = useSchoolAccess()
  const pathname = usePathname()
  const router = useRouter()

  useEffect(() => {
    if (!isAuthenticated || !user) return

    // Never block these pages
    if (ALWAYS_ALLOWED.some(p => pathname === p || pathname.startsWith(p + '/'))) return

    // Resolve effective role for route access:
    // - SUPER_ADMIN always uses their platform role
    // - For MEMBER users with a school role, use the school-scoped role
    //   (e.g. MEMBER + SchoolMembership STUDENT → check STUDENT routes)
    // - For legacy users (User.role = STUDENT/TEACHER/etc.), use User.role
    let effectiveRole = user.role
    if (user.role === 'MEMBER' && activeRole) {
      effectiveRole = activeRole
    }

    // Check if user can access current route based on effective role
    if (!canAccessRoute(effectiveRole, pathname)) {
      router.replace('/access-denied')
    }
  }, [pathname, user, isAuthenticated, activeRole, router])

  // Resolve effective role for external use
  const effectiveRole = (user?.role === 'MEMBER' && activeRole) ? activeRole : user?.role

  return {
    canAccess: user ? canAccessRoute(effectiveRole ?? '', pathname) : false,
    userRole: effectiveRole,
    defaultRoute: user ? getDefaultRoute(effectiveRole ?? user.role) : '/login'
  }
}
