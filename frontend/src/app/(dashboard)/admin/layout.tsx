'use client'

/**
 * Super Admin Layout
 * Wraps all /admin/* pages with a consistent admin shell.
 * Guards: SUPER_ADMIN only. All other roles see access-denied.
 *
 * FIX (HALQA-UI-03): Clears any stale school context from localStorage on mount.
 * A previous session as SCHOOL_ADMIN could have left an activeSchoolId in
 * localStorage. We must not let that value make the platform dashboard school-scoped.
 */

import { useEffect } from 'react'
import { useAuthStore } from '@/store/auth.store'
import { useSchoolStore } from '@/store/school.store'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard, Users, School, Shield, Radio,
  CreditCard, Gift, Lock, UserCog, BarChart3, Settings,
  FileText, Activity, AlertTriangle, ChevronRight,
} from 'lucide-react'

const NAV: { label: string; href: string; icon: React.ElementType; badge?: string }[] = [
  { label: 'Overview',          href: '/admin',                    icon: LayoutDashboard },
  { label: 'Users',             href: '/admin/users',              icon: Users },
  { label: 'Schools',           href: '/admin/schools',            icon: School },
  { label: 'Moderation',        href: '/admin/moderation',         icon: Shield },
  { label: 'Live & Voice',      href: '/admin/live-voice',         icon: Radio },
  { label: 'Payments',          href: '/admin/payments',           icon: CreditCard },
  { label: 'Gifts & Coins',     href: '/admin/gifts',              icon: Gift },
  { label: 'Security',          href: '/admin/security',           icon: Lock },
  { label: 'Staff & Perms',     href: '/admin/admins',             icon: UserCog },
  { label: 'Analytics',         href: '/admin/analytics',          icon: BarChart3 },
  { label: 'Platform Settings', href: '/admin/settings',           icon: Settings },
  { label: 'Audit Logs',        href: '/admin/audit-logs',         icon: FileText },
  { label: 'Announcements',     href: '/admin/announcements',      icon: AlertTriangle },
  { label: 'System Health',     href: '/admin/system-health',      icon: Activity },
]

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = useAuthStore(s => s.user)
  const clearActiveSchool = useSchoolStore(s => s.clearActiveSchool)
  const pathname = usePathname()

  // FIX (HALQA-UI-03): SUPER_ADMIN must never operate inside a school context.
  // Clear any stale activeSchoolId from localStorage on every admin page mount.
  // This prevents a scenario where logging in as SCHOOL_ADMIN, switching schools,
  // then logging in as SUPER_ADMIN would retain the old school selection.
  useEffect(() => {
    if (user?.role === 'SUPER_ADMIN') {
      clearActiveSchool()
    }
  }, [user?.role, clearActiveSchool])

  if (!user || user.role !== 'SUPER_ADMIN') {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-2">
          <Shield className="w-10 h-10 text-red-400 mx-auto" />
          <p className="font-semibold text-gray-700 dark:text-gray-300">Platform Admin Only</p>
          <p className="text-sm text-gray-500">This area requires SUPER_ADMIN access.</p>
          <Link href="/dashboard" className="text-sm text-indigo-500 hover:underline">
            Back to Dashboard
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen bg-gray-50 dark:bg-gray-950">
      {/* Admin sidebar */}
      <aside className="hidden lg:flex flex-col w-52 bg-gray-900 text-white flex-shrink-0">
        <div className="px-4 py-4 border-b border-gray-700">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-red-600 rounded flex items-center justify-center">
              <Shield className="w-3.5 h-3.5 text-white" />
            </div>
            <div>
              <p className="text-xs font-bold leading-none">HALQA ADMIN</p>
              <p className="text-[10px] text-gray-400 leading-none mt-0.5">Platform Control</p>
            </div>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto py-2 px-1.5 space-y-0.5">
          {NAV.map(item => {
            const Icon = item.icon
            const isActive = item.href === '/admin'
              ? pathname === '/admin'
              : pathname.startsWith(item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs font-medium transition-colors',
                  isActive
                    ? 'bg-red-700 text-white'
                    : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                )}
              >
                <Icon className="w-3.5 h-3.5 flex-shrink-0" />
                <span className="flex-1 truncate">{item.label}</span>
              </Link>
            )
          })}
        </nav>
        <div className="px-3 py-3 border-t border-gray-700">
          <p className="text-[10px] text-gray-500">
            Logged in as {user.firstName} {user.lastName}
          </p>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 min-w-0">
        {/* Mobile breadcrumb */}
        <div className="lg:hidden flex items-center gap-1 px-4 py-3 bg-gray-900 text-white text-xs">
          <Shield className="w-3.5 h-3.5 text-red-400" />
          <span className="text-gray-400">Admin</span>
          <ChevronRight className="w-3 h-3 text-gray-600" />
          <span className="text-white">
            {NAV.find(n => n.href === '/admin' ? pathname === '/admin' : pathname.startsWith(n.href))?.label ?? 'Dashboard'}
          </span>
        </div>
        <main className="flex-1">
          {children}
        </main>
      </div>
    </div>
  )
}
