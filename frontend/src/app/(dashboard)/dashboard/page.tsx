'use client'

import { useAuthStore } from '@/store/auth.store'
import { AdminDashboard } from '@/components/dashboard/admin-dashboard'
import { TeacherDashboard } from '@/components/dashboard/teacher-dashboard'
import { StudentDashboard } from '@/components/dashboard/student-dashboard'
import { GuardianDashboard } from '@/components/dashboard/guardian-dashboard'
import { PageLoader } from '@/components/ui/page-loader'

export default function DashboardPage() {
  const { user, isAuthenticated } = useAuthStore()

  if (!isAuthenticated || !user) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 bg-gray-200 rounded animate-pulse" />
        <PageLoader rows={4} type="cards" />
      </div>
    )
  }

  const dashboards: Record<string, React.ReactNode> = {
    SUPER_ADMIN: <AdminDashboard />,
    SCHOOL_ADMIN: <AdminDashboard />,
    TEACHER: <TeacherDashboard />,
    STUDENT: <StudentDashboard />,
    GUARDIAN: <GuardianDashboard />,
    REPRESENTATIVE: <AdminDashboard />
  }

  return (
    <div>
      {/* Hidden title for SEO/accessibility */}
      <h1 className="sr-only font-bold">Dashboard</h1>
      {/* Each dashboard handles its own error states via onError callbacks */}
      {dashboards[user.role] || <AdminDashboard />}
    </div>
  )
}
