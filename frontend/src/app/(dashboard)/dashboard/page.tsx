'use client'

import { useAuthStore } from '@/store/auth.store'
import { useEducationRole } from '@/hooks/useEducationRole'
import { useSchoolAccess } from '@/hooks/useSchoolAccess'
import { AdminDashboard } from '@/components/dashboard/admin-dashboard'
import { TeacherDashboard } from '@/components/dashboard/teacher-dashboard'
import { StudentDashboard } from '@/components/dashboard/student-dashboard'
import { GuardianDashboard } from '@/components/dashboard/guardian-dashboard'
import { PageLoader } from '@/components/ui/page-loader'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useSchoolStore } from '@/store/school.store'
import { Shield, LayoutDashboard, Users, School, BarChart3, Activity, ArrowRight } from 'lucide-react'
import Link from 'next/link'

/**
 * SUPER_ADMIN landing page shown at /dashboard.
 *
 * SUPER_ADMIN is a platform-management role — they have no school context.
 * Showing them the school admin dashboard (AdminDashboard) is wrong because:
 *   - AdminDashboard calls /api/v1/dashboard/admin which requires school membership
 *   - SUPER_ADMIN has no school, so they get empty data and broken charts
 *
 * Instead we show a clean platform admin home with direct links to the
 * admin sections they actually need, and auto-redirect to /admin.
 */
function SuperAdminLanding() {
  const router = useRouter()
  const clearActiveSchool = useSchoolStore(s => s.clearActiveSchool)

  useEffect(() => {
    // Clear any stale school context immediately — SUPER_ADMIN is platform-only
    clearActiveSchool()
    // Auto-redirect to platform admin dashboard
    const t = setTimeout(() => router.replace('/admin'), 1500)
    return () => clearTimeout(t)
  }, [router, clearActiveSchool])

  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="max-w-md w-full mx-auto px-6 py-12 text-center space-y-6">
        <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 rounded-2xl flex items-center justify-center mx-auto">
          <Shield className="w-8 h-8 text-red-600 dark:text-red-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Platform Administration</h1>
          <p className="text-gray-500 mt-2 text-sm">
            You are logged in as <span className="font-semibold text-red-600 dark:text-red-400">Super Admin</span>.
            Redirecting to the admin dashboard…
          </p>
        </div>

        {/* Quick links in case redirect is slow */}
        <div className="grid grid-cols-2 gap-3 text-left">
          {[
            { href: '/admin',              icon: LayoutDashboard, label: 'Admin Overview',   color: 'text-indigo-600' },
            { href: '/admin/users',        icon: Users,           label: 'Users',             color: 'text-blue-600' },
            { href: '/admin/schools',      icon: School,          label: 'Schools',           color: 'text-purple-600' },
            { href: '/admin/analytics',    icon: BarChart3,       label: 'Analytics',         color: 'text-green-600' },
            { href: '/admin/moderation',   icon: Shield,          label: 'Moderation',        color: 'text-red-600' },
            { href: '/admin/system-health',icon: Activity,        label: 'System Health',     color: 'text-orange-600' },
          ].map(item => {
            const Icon = item.icon
            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center gap-2.5 p-3 rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 hover:border-indigo-300 dark:hover:border-indigo-600 transition-colors group"
              >
                <Icon className={`w-4 h-4 flex-shrink-0 ${item.color}`} />
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300 flex-1">{item.label}</span>
                <ArrowRight className="w-3.5 h-3.5 text-gray-300 group-hover:text-gray-500 flex-shrink-0" />
              </Link>
            )
          })}
        </div>

        <Link
          href="/admin"
          className="inline-flex items-center gap-2 px-6 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl font-medium text-sm transition-colors"
        >
          Go to Admin Dashboard
          <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    </div>
  )
}

export default function DashboardPage() {
  const { user, isAuthenticated } = useAuthStore()
  const { activeRole } = useSchoolAccess()

  if (!isAuthenticated || !user) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 bg-gray-200 rounded animate-pulse" />
        <PageLoader rows={4} type="cards" />
      </div>
    )
  }

  // SUPER_ADMIN: platform management role — send to platform admin home
  // Do NOT show school admin dashboard — SUPER_ADMIN has no school context
  if (user.role === 'SUPER_ADMIN') return <SuperAdminLanding />

  // School-scoped role from active SchoolMembership (new-arch MEMBER users)
  if (activeRole === 'SCHOOL_ADMIN') return <AdminDashboard />
  if (activeRole === 'TEACHER')      return <TeacherDashboard />
  if (activeRole === 'STUDENT')      return <StudentDashboard />
  if (activeRole === 'GUARDIAN')     return <GuardianDashboard />

  // Legacy: User.role still holds education role (old accounts before migration)
  const legacyDashboards: Record<string, React.ReactNode> = {
    SCHOOL_ADMIN:   <AdminDashboard />,
    TEACHER:        <TeacherDashboard />,
    STUDENT:        <StudentDashboard />,
    GUARDIAN:       <GuardianDashboard />,
    REPRESENTATIVE: <AdminDashboard />,
  }
  if (legacyDashboards[user.role]) return <>{legacyDashboards[user.role]}</>

  // Default: social-only MEMBER with no school — show social home
  return (
    <div className="space-y-4 py-6 px-4 max-w-xl mx-auto text-center">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Welcome to HALQA</h1>
      <p className="text-gray-500 text-sm">
        You do not belong to a school yet. Use the social features or join a school to access education tools.
      </p>
      <div className="flex gap-3 justify-center">
        <Link href="/feed" className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700">
          Go to Feed
        </Link>
        <Link href="/schools/join" className="px-4 py-2 border border-gray-200 text-gray-700 dark:text-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800">
          Join a School
        </Link>
      </div>
    </div>
  )
}
