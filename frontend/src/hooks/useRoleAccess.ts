'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { useAuthStore } from '@/store/auth.store'
import { canAccessRoute, getDefaultRoute } from '@/lib/role-routes'

// Pages that should never trigger an access-denied redirect
const ALWAYS_ALLOWED = ['/dashboard', '/access-denied', '/profile', '/notifications', '/settings/blocked']

/**
 * Hook that enforces role-based access control.
 * Redirects to /access-denied if user tries to access a restricted page.
 */
export function useRoleAccess() {
  const { user, isAuthenticated } = useAuthStore()
  const pathname = usePathname()
  const router = useRouter()

  useEffect(() => {
    if (!isAuthenticated || !user) return

    // Never block these pages
    if (ALWAYS_ALLOWED.some(p => pathname === p || pathname.startsWith(p + '/'))) return

    // Check if user can access current route
    if (!canAccessRoute(user.role, pathname)) {
      router.replace('/access-denied')
    }
  }, [pathname, user, isAuthenticated, router])

  return {
    canAccess: user ? canAccessRoute(user.role, pathname) : false,
    userRole: user?.role,
    defaultRoute: user ? getDefaultRoute(user.role) : '/login'
  }
}
