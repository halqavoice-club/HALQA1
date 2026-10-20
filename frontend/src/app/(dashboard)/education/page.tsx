'use client'

/**
 * Education Hub — /education
 *
 * Role-aware dashboard that shows different navigation tiles based on the
 * user's active school membership role. Acts as the entry point after
 * selecting a school from /school-memberships.
 *
 * If the user has multiple schools, shows a "Switch School" banner at the top.
 * If the user has no school membership, redirects to the school-memberships page.
 */

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useSchoolAccess } from '@/hooks/useSchoolAccess'
import { useSchoolStore } from '@/store/school.store'
import { getFileUrl } from '@/lib/avatar'
import { cn } from '@/lib/utils'
import {
  School, GraduationCap, UserCheck, Users, BookOpen, ClipboardCheck,
  Star, BookMarked, BarChart3, Megaphone, Calendar, DollarSign,
  Headphones, Clock, StickyNote, Trophy, QrCode, Shield,
  ArrowRightLeft, Video, LayoutGrid, FileText, ChevronRight,
} from 'lucide-react'

// ─── Role display config ──────────────────────────────────────────────────────
const ROLE_META: Record<string, {
  label: string
  description: string
  color: string
  bg: string
  border: string
  icon: React.ElementType
}> = {
  SCHOOL_ADMIN: {
    label: 'School Admin',
    description: 'Full management access — students, teachers, classes, fees, reports',
    color: 'text-purple-700', bg: 'bg-purple-50', border: 'border-purple-200',
    icon: Shield,
  },
  TEACHER: {
    label: 'Teacher',
    description: 'Manage classes, record grades and attendance, view student progress',
    color: 'text-green-700', bg: 'bg-green-50', border: 'border-green-200',
    icon: UserCheck,
  },
  STUDENT: {
    label: 'Student',
    description: 'View grades, attendance, assignments and your class schedule',
    color: 'text-blue-700', bg: 'bg-blue-50', border: 'border-blue-200',
    icon: GraduationCap,
  },
  GUARDIAN: {
    label: 'Guardian',
    description: "Track your child's grades, attendance and school announcements",
    color: 'text-orange-700', bg: 'bg-orange-50', border: 'border-orange-200',
    icon: Users,
  },
}

// ─── Navigation items per role ────────────────────────────────────────────────
interface EduItem {
  label: string
  href: string
  icon: React.ElementType
  color: string
  roles: string[]
}

const EDU_ITEMS: EduItem[] = [
  { label: 'My School',         href: '/school-memberships',      icon: School,         color: 'bg-indigo-100 text-indigo-700',  roles: ['SCHOOL_ADMIN','TEACHER','STUDENT','GUARDIAN'] },
  { label: 'Students',          href: '/students',                icon: GraduationCap,  color: 'bg-blue-100 text-blue-700',      roles: ['SCHOOL_ADMIN','TEACHER'] },
  { label: 'Teachers',          href: '/teachers',                icon: UserCheck,      color: 'bg-green-100 text-green-700',    roles: ['SCHOOL_ADMIN'] },
  { label: 'Guardians',         href: '/guardians',               icon: Users,          color: 'bg-orange-100 text-orange-700',  roles: ['SCHOOL_ADMIN'] },
  { label: 'Classes',           href: '/classes',                 icon: BookOpen,       color: 'bg-purple-100 text-purple-700',  roles: ['SCHOOL_ADMIN','TEACHER'] },
  { label: 'Class Schedule',    href: '/schedule',                icon: LayoutGrid,     color: 'bg-violet-100 text-violet-700',  roles: ['SCHOOL_ADMIN','TEACHER','STUDENT','GUARDIAN'] },
  { label: 'Attendance',        href: '/attendance',              icon: ClipboardCheck, color: 'bg-teal-100 text-teal-700',     roles: ['SCHOOL_ADMIN','TEACHER','STUDENT','GUARDIAN'] },
  { label: 'QR Check-in',       href: '/attendance/qr-checkin',  icon: QrCode,         color: 'bg-cyan-100 text-cyan-700',      roles: ['SCHOOL_ADMIN','TEACHER','STUDENT'] },
  { label: 'Attendance Report', href: '/attendance/report',      icon: FileText,       color: 'bg-sky-100 text-sky-700',        roles: ['SCHOOL_ADMIN','TEACHER'] },
  { label: 'Grades',            href: '/grades',                  icon: BookMarked,     color: 'bg-amber-100 text-amber-700',    roles: ['SCHOOL_ADMIN','TEACHER','STUDENT','GUARDIAN'] },
  { label: 'Behavior',          href: '/behavior',                icon: Star,           color: 'bg-yellow-100 text-yellow-700',  roles: ['SCHOOL_ADMIN','TEACHER','STUDENT','GUARDIAN'] },
  { label: 'Live Classes',      href: '/live-class',              icon: Video,          color: 'bg-red-100 text-red-700',        roles: ['SCHOOL_ADMIN','TEACHER','STUDENT','GUARDIAN'] },
  { label: 'Audio Lessons',     href: '/audio',                   icon: Headphones,     color: 'bg-pink-100 text-pink-700',      roles: ['SCHOOL_ADMIN','TEACHER','STUDENT'] },
  { label: 'Calendar',          href: '/calendar',                icon: Calendar,       color: 'bg-lime-100 text-lime-700',      roles: ['SCHOOL_ADMIN','TEACHER','STUDENT','GUARDIAN'] },
  { label: 'Announcements',     href: '/announcements',           icon: Megaphone,      color: 'bg-rose-100 text-rose-700',      roles: ['SCHOOL_ADMIN','TEACHER','STUDENT','GUARDIAN'] },
  { label: 'Assignments',       href: '/assignments',             icon: ClipboardCheck, color: 'bg-fuchsia-100 text-fuchsia-700', roles: ['SCHOOL_ADMIN','TEACHER','STUDENT'] },
  { label: 'Exams',             href: '/exams',                   icon: FileText,       color: 'bg-orange-100 text-orange-700',  roles: ['SCHOOL_ADMIN','TEACHER','STUDENT'] },
  { label: 'Quizzes',          href: '/quizzes',                 icon: ClipboardCheck, color: 'bg-violet-100 text-violet-700',  roles: ['SCHOOL_ADMIN','TEACHER','STUDENT'] },
  { label: 'Leaderboard',      href: '/leaderboard',             icon: Trophy,         color: 'bg-yellow-100 text-yellow-700',  roles: ['SCHOOL_ADMIN','TEACHER','STUDENT'] },
  { label: 'Library',           href: '/library',                 icon: BookOpen,       color: 'bg-emerald-100 text-emerald-700', roles: ['SCHOOL_ADMIN','TEACHER','STUDENT'] },
  { label: 'Fees',              href: '/fees',                    icon: DollarSign,     color: 'bg-green-100 text-green-700',    roles: ['SCHOOL_ADMIN','GUARDIAN'] },
  { label: 'Reports',           href: '/reports',                 icon: BarChart3,      color: 'bg-slate-100 text-slate-700',    roles: ['SCHOOL_ADMIN','TEACHER'] },
  { label: 'Activities',        href: '/activities',              icon: Clock,          color: 'bg-indigo-100 text-indigo-700',  roles: ['SCHOOL_ADMIN','TEACHER'] },
  { label: 'Notes',             href: '/notes',                   icon: StickyNote,     color: 'bg-yellow-100 text-yellow-700',  roles: ['SCHOOL_ADMIN','TEACHER','STUDENT'] },
  { label: 'My ID Card',        href: '/my-id-card',              icon: QrCode,         color: 'bg-indigo-100 text-indigo-700',  roles: ['STUDENT'] },
]

export default function EducationHubPage() {
  const router = useRouter()
  const { memberships, hasSchools, activeSchool, activeRole, switchSchool } = useSchoolAccess()
  const { activeSchoolId } = useSchoolStore()

  // No school → redirect to school switcher
  useEffect(() => {
    if (!hasSchools) router.replace('/school-memberships')
  }, [hasSchools, router])

  if (!hasSchools || !activeSchool || !activeRole) return null

  const meta        = ROLE_META[activeRole] ?? ROLE_META.STUDENT
  const RoleIcon    = meta.icon
  const visibleItems = EDU_ITEMS.filter(item => item.roles.includes(activeRole))

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Active school banner */}
      <div className={cn('rounded-2xl border p-5 flex items-start gap-4', meta.bg, meta.border)}>
        {/* Logo */}
        <div className="w-14 h-14 rounded-xl overflow-hidden bg-white/60 flex items-center justify-center flex-shrink-0 border border-white/50">
          {activeSchool.logoUrl
            ? <img src={getFileUrl(activeSchool.logoUrl)} alt={activeSchool.name} className="w-full h-full object-contain p-1" />
            : <School className={cn('w-7 h-7', meta.color)} />
          }
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-gray-900 truncate">{activeSchool.name}</h1>
          <div className={cn('flex items-center gap-1.5 mt-1 text-sm font-semibold', meta.color)}>
            <RoleIcon className="w-4 h-4" />
            {meta.label}
          </div>
          <p className="text-xs text-gray-500 mt-1">{meta.description}</p>
        </div>
        {/* Switch school button — only if multiple */}
        {memberships.length > 1 && (
          <Link
            href="/school-memberships"
            className={cn(
              'flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg bg-white/70 border border-white/50 flex-shrink-0',
              meta.color, 'hover:bg-white/90 transition-colors'
            )}
          >
            <ArrowRightLeft className="w-3.5 h-3.5" />
            Switch
          </Link>
        )}
      </div>

      {/* Multiple schools indicator */}
      {memberships.length > 1 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-gray-500 font-medium">Also a member of:</span>
          {memberships
            .filter(m => m.schoolId !== activeSchoolId)
            .map(m => (
              <button
                key={m.schoolId}
                onClick={() => { switchSchool(m.schoolId); }}
                className="flex items-center gap-1.5 text-xs bg-gray-100 hover:bg-halqa-100 hover:text-halqa-700 text-gray-600 px-3 py-1.5 rounded-full font-medium transition-colors"
              >
                {m.school.name}
                <span className="opacity-60">({m.role.replace(/_/g, ' ').toLowerCase()})</span>
                <ChevronRight className="w-3 h-3 opacity-50" />
              </button>
            ))
          }
        </div>
      )}

      {/* Navigation grid */}
      <div>
        <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4">
          {meta.label} Dashboard
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {visibleItems.map(item => {
            const Icon = item.icon
            return (
              <Link
                key={item.href + item.label}
                href={item.href}
                className="flex flex-col items-center gap-2.5 p-4 bg-white rounded-xl border border-gray-100 shadow-sm hover:shadow-md hover:border-halqa-200 transition-all group"
              >
                <div className={cn('w-11 h-11 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform', item.color)}>
                  <Icon className="w-5 h-5" />
                </div>
                <span className="text-xs font-semibold text-gray-700 text-center leading-tight group-hover:text-halqa-700 transition-colors">
                  {item.label}
                </span>
              </Link>
            )
          })}
        </div>
      </div>
    </div>
  )
}
