'use client'

/**
 * My Schools — School Switcher Page
 *
 * Shows all of the user's schools. Tapping/clicking a school:
 *   1. Sets it as the active school context (useSchoolStore)
 *   2. Navigates to /education — the sidebar and all Education pages
 *      will now reflect the role for THAT school.
 *
 * One account can be TEACHER at school A, SCHOOL_ADMIN at school B,
 * STUDENT at school C. This page is the central switcher.
 *
 * LEAVE SCHOOL: Members (Student / Teacher / Guardian) can leave a school
 * from this page. After leaving, the one-student-per-school rule is lifted
 * so they can join a new school as Student. SCHOOL_ADMIN cannot self-leave
 * here — they must transfer ownership or use the School Settings danger zone.
 */

import { useState } from 'react'
import { useSchoolAccess } from '@/hooks/useSchoolAccess'
import { useSchoolStore } from '@/store/school.store'
import { useAuthStore } from '@/store/auth.store'
import { useRouter } from 'next/navigation'
import { getFileUrl } from '@/lib/avatar'
import api from '@/lib/api'
import {
  School, GraduationCap, UserCheck, Users, Shield,
  ChevronRight, CheckCircle2, Clock, Plus, ArrowRight, Settings,
  LogOut, AlertTriangle, Loader2,
} from 'lucide-react'
import Link from 'next/link'
import { cn } from '@/lib/utils'

const ROLE_META: Record<string, {
  label: string
  color: string
  bg: string
  ring: string
  icon: React.ElementType
  description: string
}> = {
  SCHOOL_ADMIN: {
    label: 'School Admin',
    color: 'text-purple-700',
    bg:    'bg-purple-100',
    ring:  'ring-purple-300',
    icon:  Shield,
    description: 'Full school management — students, teachers, classes, fees, reports',
  },
  TEACHER: {
    label: 'Teacher',
    color: 'text-green-700',
    bg:    'bg-green-100',
    ring:  'ring-green-300',
    icon:  UserCheck,
    description: 'Manage classes, record grades and attendance, view student progress',
  },
  STUDENT: {
    label: 'Student',
    color: 'text-blue-700',
    bg:    'bg-blue-100',
    ring:  'ring-blue-300',
    icon:  GraduationCap,
    description: 'View grades, attendance, assignments and class schedule',
  },
  GUARDIAN: {
    label: 'Guardian',
    color: 'text-orange-700',
    bg:    'bg-orange-100',
    ring:  'ring-orange-300',
    icon:  Users,
    description: "Monitor your child's grades, attendance and school announcements",
  },
}

// Items each role can access — shown as quick-access chips on the card
const ROLE_QUICK_ACCESS: Record<string, string[]> = {
  SCHOOL_ADMIN: ['Students', 'Teachers', 'Classes', 'Attendance', 'Grades', 'Fees', 'Reports', 'Announcements'],
  TEACHER:      ['My Classes', 'Attendance', 'Grades', 'Assignments', 'Behavior', 'Announcements'],
  STUDENT:      ['Grades', 'Attendance', 'Assignments', 'Library', 'Leaderboard'],
  GUARDIAN:     ['Attendance', 'Grades', 'Announcements', 'Calendar'],
}

export default function MySchoolsPage() {
  const { memberships, activeSchoolId } = useSchoolAccess()
  const { setActiveSchoolId, clearActiveSchool } = useSchoolStore()
  const { fetchMe } = useAuthStore()
  const router = useRouter()

  // Leave-school state
  const [leavingId, setLeavingId]     = useState<string | null>(null) // membershipId being confirmed
  const [leaveLoading, setLeaveLoading] = useState(false)
  const [leaveError, setLeaveError]   = useState<string | null>(null)

  function handleSelectSchool(schoolId: string) {
    setActiveSchoolId(schoolId)
    router.push('/education')
  }

  // Confirm + execute leave
  async function handleLeave(membershipId: string, schoolId: string) {
    setLeaveLoading(true)
    setLeaveError(null)
    try {
      await api.delete(`/school-memberships/${membershipId}`)
      // If leaving the active school, clear the context
      if (activeSchoolId === schoolId) clearActiveSchool()
      // Refresh memberships from server
      await fetchMe()
      setLeavingId(null)
    } catch (err: any) {
      setLeaveError(err.response?.data?.message || 'Failed to leave school. Please try again.')
    } finally {
      setLeaveLoading(false)
    }
  }

  if (memberships.length === 0) {
    return (
      <div className="max-w-xl mx-auto py-16 text-center space-y-4">
        <div className="w-16 h-16 bg-halqa-100 rounded-2xl flex items-center justify-center mx-auto">
          <School className="w-8 h-8 text-halqa-700" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900">No Schools Yet</h1>
        <p className="text-gray-500 text-sm">
          Join an existing school or create your own to access the Education section.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center mt-6">
          <Link
            href="/schools/join"
            className="flex items-center justify-center gap-2 px-5 py-3 bg-halqa-700 text-white rounded-xl font-semibold text-sm hover:bg-halqa-800 transition-colors"
          >
            <ArrowRight className="w-4 h-4" /> Join a School
          </Link>
          <Link
            href="/school-memberships/create"
            className="flex items-center justify-center gap-2 px-5 py-3 border border-halqa-300 text-halqa-700 rounded-xl font-semibold text-sm hover:bg-halqa-50 transition-colors"
          >
            <Plus className="w-4 h-4" /> Create a School
          </Link>
        </div>
      </div>
    )
  }

  // The membership being confirmed for leave (full object needed for name/role)
  const leavingMembership = leavingId ? memberships.find(m => m.id === leavingId) : null

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">My Schools</h1>
        <p className="text-gray-500 text-sm mt-1">
          Tap a school to switch context and open its dashboard.
        </p>
      </div>

      {/* ── Leave School confirm overlay ─────────────────────────────────── */}
      {leavingMembership && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-red-100 rounded-xl flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <h3 className="font-bold text-gray-900">Leave {leavingMembership.school.name}?</h3>
                <p className="text-xs text-gray-500 mt-0.5">You are currently a <strong>{leavingMembership.role.replace(/_/g, ' ').toLowerCase()}</strong></p>
              </div>
            </div>

            <p className="text-sm text-gray-600">
              You will lose access to all Education features for this school. Your grades, attendance, and records will remain saved — you just won&apos;t be able to view them until an admin re-invites you.
            </p>

            {leavingMembership.role === 'STUDENT' && (
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-700">
                <strong>Switching schools?</strong> After leaving, you can join a new school as a Student. Your old data stays safe.
              </div>
            )}

            {leaveError && (
              <p className="text-sm text-red-600 bg-red-50 p-2 rounded-lg">{leaveError}</p>
            )}

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => { setLeavingId(null); setLeaveError(null) }}
                disabled={leaveLoading}
                className="flex-1 py-2.5 text-sm font-semibold text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => handleLeave(leavingMembership.id, leavingMembership.schoolId)}
                disabled={leaveLoading}
                className="flex-1 py-2.5 text-sm font-semibold text-white bg-red-600 rounded-xl hover:bg-red-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {leaveLoading
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Leaving…</>
                  : <><LogOut className="w-4 h-4" /> Leave School</>
                }
              </button>
            </div>
          </div>
        </div>
      )}

      {/* School cards */}
      <div className="space-y-3">
        {memberships.map(m => {
          const meta       = ROLE_META[m.role] ?? ROLE_META.STUDENT
          const RoleIcon   = meta.icon
          const isActive   = m.schoolId === activeSchoolId
          const quickItems = ROLE_QUICK_ACCESS[m.role] ?? []
          // SCHOOL_ADMIN can't self-leave here — must use School Settings / transfer ownership
          const canLeave   = m.role !== 'SCHOOL_ADMIN'

          return (
            <div key={m.schoolId} className="space-y-1">
              <button
                onClick={() => handleSelectSchool(m.schoolId)}
                className={cn(
                  'w-full text-left bg-white rounded-2xl p-5 border-2 transition-all duration-150',
                  'hover:shadow-md hover:border-halqa-300 active:scale-[0.99]',
                  isActive
                    ? 'border-halqa-500 ring-2 ring-halqa-200 shadow-md'
                    : 'border-gray-100 shadow-sm',
                )}
              >
                <div className="flex items-start gap-4">
                  {/* Logo */}
                  <div className="w-14 h-14 rounded-xl overflow-hidden bg-halqa-100 flex items-center justify-center flex-shrink-0 border border-gray-100">
                    {m.school.logoUrl
                      ? <img src={getFileUrl(m.school.logoUrl)} alt={m.school.name} className="w-full h-full object-contain p-1" />
                      : <School className="w-7 h-7 text-halqa-600" />
                    }
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-bold text-gray-900 truncate text-base">{m.school.name}</h3>
                      {isActive && (
                        <span className="flex items-center gap-1 text-[10px] font-bold text-halqa-700 bg-halqa-100 px-2 py-0.5 rounded-full flex-shrink-0">
                          <CheckCircle2 className="w-2.5 h-2.5" /> Active
                        </span>
                      )}
                    </div>

                    {/* Role badge */}
                    <div className="flex items-center gap-1.5 mt-1.5">
                      <span className={cn('flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full', meta.bg, meta.color)}>
                        <RoleIcon className="w-3 h-3" />
                        {meta.label}
                      </span>
                      <span className="text-xs text-gray-400 capitalize">{m.school.type || 'school'}</span>
                    </div>

                    {/* Role description */}
                    <p className="text-xs text-gray-500 mt-1.5 leading-relaxed">{meta.description}</p>

                    {/* Quick access chips */}
                    <div className="flex flex-wrap gap-1 mt-2.5">
                      {quickItems.map(item => (
                        <span key={item} className="text-[10px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                          {item}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Arrow */}
                  <ChevronRight className={cn('w-5 h-5 flex-shrink-0 mt-1 transition-colors', isActive ? 'text-halqa-500' : 'text-gray-300')} />
                </div>
              </button>

              {/* Below-card row: settings (admin) + leave (non-admin) */}
              <div className="flex items-center justify-between px-1">
                {m.role === 'SCHOOL_ADMIN' ? (
                  <Link
                    href={`/schools/${m.schoolId}`}
                    className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-halqa-600 transition-colors"
                  >
                    <Settings className="w-3 h-3" />
                    School Settings
                  </Link>
                ) : (
                  <span /> /* spacer */
                )}

                {canLeave && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setLeaveError(null); setLeavingId(m.id) }}
                    className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-600 transition-colors"
                    title="Leave this school"
                  >
                    <LogOut className="w-3 h-3" />
                    Leave school
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Add another school */}
      <div className="flex gap-3 pt-2">
        <Link
          href="/schools/join"
          className="flex items-center gap-2 text-sm text-halqa-600 font-medium hover:text-halqa-800 transition-colors"
        >
          <Plus className="w-4 h-4" /> Join another school
        </Link>
        <span className="text-gray-300">·</span>
        <Link
          href="/school-memberships/create"
          className="flex items-center gap-2 text-sm text-halqa-600 font-medium hover:text-halqa-800 transition-colors"
        >
          <Plus className="w-4 h-4" /> Create a school
        </Link>
      </div>
    </div>
  )
}
