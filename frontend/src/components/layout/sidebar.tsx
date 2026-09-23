'use client'

import { useState, useCallback, useMemo, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/store/auth.store'
import { useThemeStore } from '@/store/theme.store'
import { useSchoolAccess } from '@/hooks/useSchoolAccess'
import {
  LayoutDashboard, Users, GraduationCap, BookOpen, ClipboardCheck,
  Star, BarChart3, MessageSquare, Calendar, Settings,
  ChevronLeft, ChevronRight, ChevronDown, School, Clock, StickyNote,
  UserCheck, Shield, LogOut, BookMarked, Upload, Megaphone,
  CalendarDays, LayoutGrid, Headphones, DollarSign, Radio,
  UserPlus, MessagesSquare, Video, Wallet, Rss, UsersRound,
  Compass, Sparkles, Bell, Home, GraduationCap as EduIcon,
  Wrench, QrCode, Trophy, PlusCircle, Activity, Globe,
} from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { getAvatarUrl } from '@/lib/avatar'
import { resolveMediaUrl } from '@/lib/media'
import { useTranslation } from '@/hooks/useTranslation'
import { useSocialStore } from '@/store/social.store'
import { useDmStore } from '@/store/dm.store'
import { useGroupChatStore } from '@/store/groupChat.store'

// ─── Types ────────────────────────────────────────────────────────────────────
interface NavItem {
  label:  string
  href:   string
  icon:   React.ElementType
  roles?: string[]
  badge?: 'social' | 'dm' | 'group'  // which badge counter to show
  future?: boolean                    // grey-out future placeholder
}

interface NavGroup {
  id:     string
  label:  string
  icon:   React.ElementType
  items:  NavItem[]
}

// ─── Collapsible group component ──────────────────────────────────────────────
function NavGroupSection({
  group, collapsed, isRTL, pathname, pendingCount, dmUnread, groupUnread,
  isOpen, onToggle
}: {
  group: NavGroup
  collapsed: boolean
  isRTL: boolean
  pathname: string
  pendingCount: number
  dmUnread: number
  groupUnread: number
  isOpen: boolean
  onToggle: () => void
}) {
  const GroupIcon = group.icon
  const hasActive = group.items.some(
    item => pathname === item.href || pathname.startsWith(item.href + '/')
  )

  if (collapsed) {
    // In collapsed mode: just show items as icon-only
    return (
      <div className="space-y-0.5">
        {/* Group divider */}
        <div className="h-px bg-white/10 mx-2 my-1.5" />
        {group.items.map(item => {
          if (item.future) return null
          const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
          const Icon = item.icon
          return (
            <Link
              key={`${item.href}__${item.label}`}
              href={item.href}
              title={item.label}
              className={cn(
                'flex items-center justify-center w-10 h-10 mx-auto rounded-lg transition-all duration-150',
                isActive ? 'bg-halqa-700 text-white' : 'text-halqa-300 hover:bg-halqa-800 hover:text-white'
              )}
            >
              <div className="relative">
                <Icon className="w-5 h-5" />
                {item.badge === 'social' && pendingCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 bg-red-500 rounded-full text-[8px] font-black text-white flex items-center justify-center">
                    {pendingCount > 9 ? '9+' : pendingCount}
                  </span>
                )}
                {item.badge === 'dm' && dmUnread > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 bg-indigo-500 rounded-full text-[8px] font-black text-white flex items-center justify-center">
                    {dmUnread > 9 ? '9+' : dmUnread}
                  </span>
                )}
                {item.badge === 'group' && groupUnread > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 bg-purple-500 rounded-full text-[8px] font-black text-white flex items-center justify-center">
                    {groupUnread > 9 ? '9+' : groupUnread}
                  </span>
                )}
              </div>
            </Link>
          )
        })}
      </div>
    )
  }

  return (
    <div className="space-y-0.5">
      {/* Group header — clickable to collapse */}
      <button
        onClick={onToggle}
        className={cn(
          'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors',
          isRTL && 'flex-row-reverse text-right',
          hasActive ? 'text-white' : 'text-halqa-400 hover:text-halqa-200'
        )}
      >
        <GroupIcon className="w-3.5 h-3.5 flex-shrink-0" />
        <span className="flex-1 text-left">{group.label}</span>
        <ChevronDown className={cn(
          'w-3.5 h-3.5 flex-shrink-0 transition-transform duration-200',
          isOpen ? 'rotate-0' : '-rotate-90'
        )} />
      </button>

      {/* Group items */}
      {isOpen && (
        <div className="pl-1 space-y-0.5">
          {group.items.map(item => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
            const Icon = item.icon
            if (item.future) {
              return (
                <div
                  key={`${item.href}__${item.label}`}
                  title="Coming soon"
                  className={cn(
                    'flex items-center gap-3 px-3 py-2 rounded-lg text-sm opacity-40 cursor-not-allowed',
                    isRTL && 'flex-row-reverse text-right',
                    'text-halqa-500'
                  )}
                >
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  <span className="flex-1">{item.label}</span>
                  <span className="text-[9px] text-halqa-500 bg-halqa-800 px-1 py-0.5 rounded">Soon</span>
                </div>
              )
            }
            return (
              <Link
                key={`${item.href}__${item.label}`}
                href={item.href}
                className={cn(
                  'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150',
                  isRTL && 'flex-row-reverse text-right',
                  isActive
                    ? 'bg-halqa-700 text-white'
                    : 'text-halqa-300 hover:bg-halqa-800 hover:text-white'
                )}
              >
                <div className="relative flex-shrink-0">
                  <Icon className="w-4 h-4" />
                  {item.badge === 'social' && pendingCount > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 rounded-full text-[9px] font-black text-white flex items-center justify-center">
                      {pendingCount > 9 ? '9+' : pendingCount}
                    </span>
                  )}
                  {item.badge === 'dm' && dmUnread > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-indigo-500 rounded-full text-[9px] font-black text-white flex items-center justify-center">
                      {dmUnread > 9 ? '9+' : dmUnread}
                    </span>
                  )}
                  {item.badge === 'group' && groupUnread > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-purple-500 rounded-full text-[9px] font-black text-white flex items-center justify-center">
                      {groupUnread > 9 ? '9+' : groupUnread}
                    </span>
                  )}
                </div>
                <span className="flex-1 truncate">{item.label}</span>
                {item.badge === 'social' && pendingCount > 0 && (
                  <span className="ml-auto bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0">
                    {pendingCount}
                  </span>
                )}
                {item.badge === 'dm' && dmUnread > 0 && (
                  <span className="ml-auto bg-indigo-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0">
                    {dmUnread}
                  </span>
                )}
                {item.badge === 'group' && groupUnread > 0 && (
                  <span className="ml-auto bg-purple-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0">
                    {groupUnread}
                  </span>
                )}
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Main Sidebar ─────────────────────────────────────────────────────────────
export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false)
  // Remember which groups are open (default: HOME + SOCIAL open, rest closed)
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    home:          true,
    social:        true,
    education:     false,
    administration: false,
    platform:      false,
  })

  const pathname    = usePathname()
  const { user, logout } = useAuthStore()
  const { t }       = useTranslation()
  const { language } = useThemeStore()
  const isRTL       = language === 'ar'
  const { pendingCount } = useSocialStore()
  const { totalUnread: dmUnread } = useDmStore()
  const groupUnread = useGroupChatStore(s =>
    s.conversations.reduce((sum, c) => sum + (c.unread ?? 0), 0)
  )

  const role = user?.role || ''   // kept for legacy footer display only

  const toggleGroup = useCallback((id: string) => {
    setOpenGroups(prev => ({ ...prev, [id]: !prev[id] }))
  }, [])

  // ── School access (Education domain) ──────────────────────────────────────
  const {
    hasSchools,
    activeSchool,
    activeRole,
    memberships,
    canEducation,
    switchSchool
  } = useSchoolAccess()

  // ── Navigation groups ──────────────────────────────────────────────────────
  const groups: NavGroup[] = useMemo(() => {
    // ── Education items — dynamically built from active school role ──────────
    // These are shown ONLY when the user has an active school membership.
    // Each item's visibility is controlled by canEducation() to respect the
    // school-scoped role (not the global user.role).
    const educationItems: NavItem[] = hasSchools ? [
      // My School — opens the school switcher so the user can pick which school context to enter
      ...(canEducation('VIEW_SCHOOL') ? [
        { label: 'My Schools', href: '/school-memberships', icon: School }
      ] : []),
      // School management — admin only (uses MANAGE_SCHOOL)
      ...(canEducation('VIEW_STUDENTS') ? [
        { label: t.students, href: '/students', icon: GraduationCap }
      ] : []),
      ...(canEducation('VIEW_TEACHERS') ? [
        { label: t.teachers, href: '/teachers', icon: UserCheck }
      ] : []),
      ...(canEducation('VIEW_GUARDIANS') ? [
        { label: t.guardians, href: '/guardians', icon: Users }
      ] : []),
      ...(canEducation('VIEW_CLASSES') ? [
        { label: t.classes, href: '/classes', icon: BookOpen }
      ] : []),
      ...(canEducation('VIEW_SCHEDULE') ? [
        { label: 'Class Schedule', href: '/schedule', icon: LayoutGrid }
      ] : []),
      ...(canEducation('VIEW_ATTENDANCE') ? [
        { label: t.attendance, href: '/attendance', icon: ClipboardCheck }
      ] : []),
      ...(canEducation('VIEW_ATTENDANCE') && activeRole !== 'GUARDIAN' ? [
        { label: 'QR Check-in', href: '/attendance/qr-checkin', icon: QrCode }
      ] : []),
      // My ID Card — students can view and print their own card
      ...(activeRole === 'STUDENT' ? [
        { label: 'My ID Card', href: '/my-id-card', icon: QrCode }
      ] : []),
      ...(canEducation('VIEW_ATTENDANCE') && (activeRole === 'TEACHER' || activeRole === 'SCHOOL_ADMIN') ? [
        { label: t.attendanceReport, href: '/attendance/report', icon: BarChart3 }
      ] : []),
      ...(canEducation('VIEW_GRADES') ? [
        { label: t.grades, href: '/grades', icon: BookMarked }
      ] : []),
      ...(canEducation('VIEW_BEHAVIOR') ? [
        { label: t.behavior, href: '/behavior', icon: Star }
      ] : []),
      { label: 'Live Classes', href: '/live-class', icon: Video },
      ...(canEducation('VIEW_AUDIO_LESSONS') ? [
        { label: t.audio, href: '/audio', icon: Headphones }
      ] : []),
      { label: t.calendar, href: '/calendar', icon: Calendar },
      { label: t.announcements, href: '/announcements', icon: Megaphone },
      ...(canEducation('VIEW_ASSIGNMENTS') ? [
        { label: 'Assignments', href: '/assignments', icon: ClipboardCheck }
      ] : []),
      ...(canEducation('VIEW_EXAMS') ? [
        { label: 'Exams', href: '/exams', icon: BookMarked }
      ] : []),
      { label: 'Leaderboard', href: '/leaderboard', icon: Trophy },
      ...(canEducation('VIEW_LIBRARY') ? [
        { label: t.library, href: '/library', icon: BookOpen }
      ] : []),
      ...(canEducation('VIEW_FEES') ? [
        { label: t.fees, href: '/fees', icon: DollarSign }
      ] : []),
      ...(canEducation('MANAGE_TERMS') ? [
        { label: t.terms, href: '/terms', icon: CalendarDays }
      ] : []),
      ...(canEducation('VIEW_REPORTS') ? [
        { label: t.reports, href: '/reports', icon: BarChart3 }
      ] : []),
      ...(canEducation('VIEW_SCHEDULE') ? [
        { label: t.schedule, href: '/activities', icon: Clock }
      ] : []),
      ...(canEducation('VIEW_ANALYTICS') ? [
        { label: 'Analytics', href: '/analytics', icon: BarChart3 }
      ] : []),
      ...(canEducation('VIEW_ASSIGNMENTS') ? [
        { label: 'Certificates', href: '/certificates', icon: Star, future: true }
      ] : []),
    ] : []

    // ── Administration items (Education admin only) ──────────────────────────
    // ── Administration items (Education admin only) ──────────────────────────
    // Administration = school management tools, NOT global HALQA platform admin.
    // Shown only to users with an active SCHOOL_ADMIN membership in their active school.
    // ARCH-01: SUPER_ADMIN platform role alone does NOT grant these items.
    // A SUPER_ADMIN who has been explicitly invited as SCHOOL_ADMIN will see these
    // through their membership (activeRole === 'SCHOOL_ADMIN'), not their platform role.
    const administrationItems: NavItem[] = hasSchools && activeRole === 'SCHOOL_ADMIN' ? [
      { label: 'Members',  href: '/school-memberships/manage', icon: Users },
      { label: t.users,    href: '/users',    icon: Users },
      { label: t.import,   href: '/import',   icon: Upload },
      { label: t.audit,    href: '/audit',    icon: Shield },
      { label: t.settings, href: '/settings', icon: Settings },
    ] : (activeRole === 'TEACHER' ? [
      { label: t.settings, href: '/settings', icon: Settings },
    ] : [])

    return [
      {
        id: 'home',
        label: 'Home',
        icon: Home,
        items: [
          { label: t.dashboard, href: '/dashboard', icon: LayoutDashboard },
          { label: 'Notifications', href: '/notifications', icon: Bell },
        ]
      },
      // ── SOCIAL section — available to ALL authenticated users ──────────────
      // No school required. Every HALQA user can use these features.
      {
        id: 'social',
        label: 'Social',
        icon: Rss,
        items: [
          { label: 'Feed', href: '/feed', icon: Rss },
          { label: 'Explore', href: '/explore', icon: Compass },
          { label: 'Communities', href: '/communities', icon: UsersRound },
          { label: t.voiceClub, href: '/voice-club', icon: Radio },
          { label: 'Live Rooms', href: '/live-class', icon: Video },
          { label: 'Live Streams', href: '/live-stream', icon: Globe },
          { label: 'Messages', href: '/dm', icon: MessagesSquare, badge: 'dm' as const },
          { label: 'Groups', href: '/group-chat', icon: Users, badge: 'group' as const },
          { label: 'Friends', href: '/social', icon: UserPlus, badge: 'social' as const },
          { label: 'Creator', href: '/creator', icon: Sparkles },
          { label: 'Wallet', href: '/wallet', icon: Wallet },
          { label: 'Payout', href: '/wallet/payout', icon: DollarSign },
          { label: 'Marketplace', href: '/marketplace', icon: DollarSign, future: true },
        ]
      },
      // ── EDUCATION section — only shown when user has school membership ──────
      // If no school: show prompts to join or create a school.
      // If has school: show role-appropriate education navigation.
      {
        id: 'education',
        label: 'Education',
        icon: EduIcon,
        items: hasSchools ? educationItems : [
          // No school membership → show onboarding prompts
          { label: 'Join a School', href: '/schools/join', icon: School },
          { label: 'Create a School', href: '/school-memberships/create', icon: PlusCircle },
        ]
      },
      // ── ADMINISTRATION — school admin tools (only for admin roles) ──────────
      ...(administrationItems.length > 0 ? [{
        id: 'administration',
        label: 'Administration',
        icon: Wrench,
        items: administrationItems
      }] : []),
      // ── PLATFORM ADMIN — SUPER_ADMIN global controls ──────────────────────
      ...(user?.role === 'SUPER_ADMIN' ? [{
        id: 'platform',
        label: 'Platform Admin',
        icon: Shield,
        items: [
          { label: 'Admin Dashboard',   href: '/admin',               icon: LayoutDashboard },
          { label: 'Users',             href: '/admin/users',          icon: Users },
          { label: 'Schools',           href: '/admin/schools',        icon: School },
          { label: 'Moderation',        href: '/admin/moderation',     icon: Shield },
          { label: 'Live & Voice',      href: '/admin/live-voice',     icon: Radio },
          { label: 'Payments',          href: '/admin/payments',       icon: DollarSign },
          { label: 'Gifts & Coins',     href: '/admin/gifts',          icon: Sparkles },
          { label: 'Security',          href: '/admin/security',       icon: Shield },
          { label: 'Audit Logs',        href: '/admin/audit-logs',     icon: Shield },
          { label: 'Announcements',     href: '/admin/announcements',  icon: Megaphone },
          { label: 'Analytics',         href: '/admin/analytics',      icon: BarChart3 },
          { label: 'System Health',     href: '/admin/system-health',  icon: Activity },
          { label: 'Platform Settings', href: '/admin/settings',       icon: Settings },
          { label: 'Admin Provisioning',href: '/admin/admins',         icon: Shield },
        ]
      }] : []),
    ]
  }, [t, hasSchools, activeRole, canEducation])

  // Filter items — deduplicate by href within each group
  const filteredGroups = useMemo(() =>
    groups.map(group => ({
      ...group,
      items: group.items.filter((item, idx, arr) => {
        // Keep only the first occurrence of each href within this group
        return arr.findIndex(x => x.href === item.href) === idx
      })
    })).filter(g => g.items.length > 0)
  , [groups])

  // Auto-open group when navigating to a route inside it (useEffect avoids render-time state writes)
  useEffect(() => {
    filteredGroups.forEach(g => {
      if (g.items.some(item => !item.future && (pathname === item.href || pathname.startsWith(item.href + '/')))) {
        setOpenGroups(prev => prev[g.id] ? prev : { ...prev, [g.id]: true })
      }
    })
  }, [pathname]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <aside className={cn(
      'hidden md:flex flex-col bg-halqa-900 text-white transition-all duration-300 ease-in-out',
      collapsed ? 'w-16' : 'w-64'
    )}>
      {/* Logo / Brand */}
      <div className={cn(
        'flex items-center h-16 px-4 border-b border-halqa-700 flex-shrink-0',
        collapsed ? 'justify-center' : 'justify-between'
      )}>
        {!collapsed && (
          <div className="flex items-center gap-2 min-w-0">
            {/* FIX (HALQA-UI-01): SUPER_ADMIN is a platform role — show HALQA Platform,
                NOT the school name/logo. School name is only shown for school-scoped roles. */}
            {user?.role === 'SUPER_ADMIN' ? (
              <>
                <div className="w-8 h-8 bg-gradient-to-br from-red-600 to-red-700 rounded-lg flex items-center justify-center flex-shrink-0">
                  <Shield className="w-4 h-4 text-white" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold leading-none truncate">HALQA</p>
                  <p className="text-[10px] text-halqa-300 leading-none mt-0.5">Platform Administration</p>
                </div>
              </>
            ) : user?.school?.logoUrl ? (
              <>
                <img
                  src={resolveMediaUrl(user.school.logoUrl)}
                  alt={user.school.name}
                  className="w-8 h-8 rounded-lg object-contain bg-white/10 p-0.5 flex-shrink-0"
                />
                <div className="min-w-0">
                  <p className="text-sm font-bold leading-none truncate">
                    {user?.school?.name || 'HALQA'}
                  </p>
                  <p className="text-[10px] text-halqa-300 leading-none mt-0.5">Social Platform</p>
                </div>
              </>
            ) : (
              <>
                <div className="w-8 h-8 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg flex items-center justify-center flex-shrink-0">
                  <Rss className="w-4 h-4 text-white" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold leading-none truncate">HALQA</p>
                  <p className="text-[10px] text-halqa-300 leading-none mt-0.5">Social Platform</p>
                </div>
              </>
            )}
          </div>
        )}
        {collapsed && (
          <div className="w-8 h-8 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg flex items-center justify-center">
            {user?.role === 'SUPER_ADMIN' ? (
              <Shield className="w-4 h-4 text-white" />
            ) : user?.school?.logoUrl
              ? <img src={resolveMediaUrl(user.school.logoUrl)} alt="" className="w-7 h-7 rounded object-contain" />
              : <Rss className="w-4 h-4 text-white" />
            }
          </div>
        )}
        <button
          onClick={() => setCollapsed(v => !v)}
          className="p-1 rounded hover:bg-halqa-700 transition-colors flex-shrink-0 ml-1"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {isRTL
            ? (collapsed ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />)
            : (collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />)
          }
        </button>
      </div>

      {/* Active school selector — only shown when user has multiple schools.
          FIX (HALQA-UI-02): SUPER_ADMIN is a platform role — never show school context.
          Managing schools (/admin/schools) is different from operating inside a school. */}
      {!collapsed && hasSchools && memberships.length > 1 && user?.role !== 'SUPER_ADMIN' && (
        <div className="px-3 py-2 border-b border-halqa-700">
          <p className="text-[9px] font-bold uppercase tracking-wider text-halqa-500 mb-1">Education Context</p>
          <select
            value={activeSchool?.id || ''}
            onChange={(e) => {
              switchSchool(e.target.value)
              // Navigate to the education hub so the new context takes effect immediately
              if (typeof window !== 'undefined') window.location.href = '/education'
            }}
            className="w-full bg-halqa-800 text-white text-xs rounded px-2 py-1 border border-halqa-600 focus:outline-none focus:border-indigo-500"
            aria-label="Switch active school"
          >
            {memberships.map(m => (
              <option key={m.schoolId} value={m.schoolId}>
                {m.school.name} ({m.role.replace(/_/g, ' ')})
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Active school indicator — single school.
          FIX (HALQA-UI-02): Hidden for SUPER_ADMIN — platform role, not school role. */}
      {!collapsed && hasSchools && memberships.length === 1 && user?.role !== 'SUPER_ADMIN' && (
        <div className="px-3 py-1.5 border-b border-halqa-700 flex items-center gap-2">
          {activeSchool?.logoUrl ? (
            <img src={resolveMediaUrl(activeSchool.logoUrl)} alt="" className="w-4 h-4 rounded object-contain flex-shrink-0" />
          ) : (
            <EduIcon className="w-3.5 h-3.5 text-halqa-400 flex-shrink-0" />
          )}
          <div className="min-w-0">
            <p className="text-[10px] text-halqa-300 truncate">{activeSchool?.name}</p>
            <p className="text-[9px] text-halqa-500 capitalize">{activeRole?.replace(/_/g, ' ').toLowerCase()}</p>
          </div>
        </div>
      )}

      {/* Navigation groups */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-1" aria-label="Main navigation">
        {filteredGroups.map(group => (
          <NavGroupSection
            key={group.id}
            group={group}
            collapsed={collapsed}
            isRTL={isRTL}
            pathname={pathname}
            pendingCount={pendingCount}
            dmUnread={dmUnread}
            groupUnread={groupUnread}
            isOpen={!!openGroups[group.id]}
            onToggle={() => toggleGroup(group.id)}
          />
        ))}
      </nav>

      {/* User profile footer */}
      <div className={cn(
        'border-t border-halqa-700 p-3 flex-shrink-0',
        collapsed ? 'flex justify-center' : ''
      )}>
        {!collapsed ? (
          <div className={cn('flex items-center gap-3', isRTL && 'flex-row-reverse')}>
            <Avatar className="w-8 h-8 flex-shrink-0">
              <AvatarImage src={getAvatarUrl(user?.avatarUrl)} />
              <AvatarFallback className="bg-halqa-700 text-white text-xs">
                {user?.firstName?.[0]}{user?.lastName?.[0]}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{user?.firstName} {user?.lastName}</p>
              {user?.role === 'SUPER_ADMIN' ? (
                <p className="text-xs text-red-400 font-semibold truncate">Platform Admin</p>
              ) : (
                <p className="text-xs text-halqa-400 truncate capitalize">{user?.role?.replace(/_/g, ' ').toLowerCase()}</p>
              )}
            </div>
            <button
              onClick={logout}
              className="p-1.5 rounded hover:bg-halqa-700 text-halqa-400 hover:text-white transition-colors flex-shrink-0"
              title="Logout"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <button
            onClick={logout}
            className="p-2 rounded hover:bg-halqa-700 text-halqa-400 hover:text-white transition-colors"
            title="Logout"
          >
            <LogOut className="w-4 h-4" />
          </button>
        )}
      </div>
    </aside>
  )
}
