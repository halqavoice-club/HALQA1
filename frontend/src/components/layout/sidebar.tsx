'use client'

import { useState, useCallback, useMemo, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/store/auth.store'
import { useThemeStore } from '@/store/theme.store'
import {
  LayoutDashboard, Users, GraduationCap, BookOpen, ClipboardCheck,
  Star, BarChart3, MessageSquare, Calendar, Settings,
  ChevronLeft, ChevronRight, ChevronDown, School, Clock, StickyNote,
  UserCheck, Shield, LogOut, BookMarked, Upload, Megaphone,
  CalendarDays, LayoutGrid, Headphones, DollarSign, Radio,
  UserPlus, MessagesSquare, Video, Wallet, Rss, UsersRound,
  Compass, Sparkles, Bell, Home, GraduationCap as EduIcon,
  Wrench, QrCode, Trophy,
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

  const role = user?.role || ''

  const toggleGroup = useCallback((id: string) => {
    setOpenGroups(prev => ({ ...prev, [id]: !prev[id] }))
  }, [])

  // ── Navigation groups ──────────────────────────────────────────────────────
  const groups: NavGroup[] = useMemo(() => [
    {
      id: 'home',
      label: 'Home',
      icon: Home,
      items: [
        { label: t.dashboard,     href: '/dashboard',     icon: LayoutDashboard },
        { label: 'Notifications', href: '/notifications', icon: Bell },
      ]
    },
    {
      id: 'social',
      label: 'Social',
      icon: Rss,
      items: [
        { label: 'Feed',        href: '/feed',        icon: Rss },
        { label: 'Explore',     href: '/explore',     icon: Compass },
        { label: 'Communities', href: '/communities', icon: UsersRound },
        { label: t.voiceClub,   href: '/voice-club',  icon: Radio },
        { label: 'Live Rooms',  href: '/live-class',  icon: Video },
        { label: 'Chat',        href: '/dm',          icon: MessagesSquare, badge: 'dm' },
        { label: 'Groups',      href: '/group-chat',  icon: Users,         badge: 'group' },
        { label: t.messages,    href: '/messages',    icon: MessageSquare },
        { label: 'Friends',     href: '/social',      icon: UserPlus, badge: 'social' },
        { label: 'Creator',     href: '/creator',     icon: Sparkles },
        { label: 'Wallet',      href: '/wallet',       icon: Wallet },
        { label: 'Marketplace', href: '/marketplace',  icon: DollarSign, future: true },
      ]
    },
    {
      id: 'education',
      label: 'Education',
      icon: EduIcon,
      items: [
        { label: t.schools,        href: '/schools',            icon: School,         roles: ['SUPER_ADMIN'] },
        { label: t.students,       href: '/students',           icon: GraduationCap,  roles: ['SUPER_ADMIN','SCHOOL_ADMIN','TEACHER'] },
        { label: t.teachers,       href: '/teachers',           icon: UserCheck,      roles: ['SUPER_ADMIN','SCHOOL_ADMIN'] },
        { label: t.guardians,      href: '/guardians',          icon: Users,          roles: ['SUPER_ADMIN','SCHOOL_ADMIN'] },
        { label: t.classes,        href: '/classes',            icon: BookOpen,       roles: ['SUPER_ADMIN','SCHOOL_ADMIN','TEACHER'] },
        { label: 'Class Schedule', href: '/schedule',           icon: LayoutGrid,     roles: ['SUPER_ADMIN','SCHOOL_ADMIN','TEACHER'] },
        { label: t.attendance,       href: '/attendance',          icon: ClipboardCheck, roles: ['SUPER_ADMIN','SCHOOL_ADMIN','TEACHER','STUDENT','GUARDIAN'] },
        { label: 'QR Check-in',      href: '/attendance/qr-checkin',icon: QrCode,         roles: ['SUPER_ADMIN','SCHOOL_ADMIN','TEACHER','STUDENT'] },
        { label: t.attendanceReport, href: '/attendance/report',   icon: BarChart3,      roles: ['SUPER_ADMIN','SCHOOL_ADMIN','TEACHER'] },
        { label: t.grades,         href: '/grades',             icon: BookMarked,     roles: ['SUPER_ADMIN','SCHOOL_ADMIN','TEACHER','STUDENT','GUARDIAN'] },
        { label: t.behavior,       href: '/behavior',           icon: Star,           roles: ['SUPER_ADMIN','SCHOOL_ADMIN','TEACHER','STUDENT'] },
        { label: 'Live Classes',   href: '/live-class',         icon: Video },
        { label: t.audio,          href: '/audio',              icon: Headphones,     roles: ['SUPER_ADMIN','SCHOOL_ADMIN','TEACHER','STUDENT'] },
        { label: t.calendar,       href: '/calendar',           icon: Calendar },
        { label: t.announcements,  href: '/announcements',      icon: Megaphone },
        { label: t.notes,          href: '/notes',              icon: StickyNote,     roles: ['SUPER_ADMIN','SCHOOL_ADMIN','TEACHER','STUDENT'] },
        { label: t.library,        href: '/library',            icon: BookOpen,       roles: ['SUPER_ADMIN','SCHOOL_ADMIN','TEACHER','STUDENT'] },
        { label: t.fees,           href: '/fees',               icon: DollarSign,     roles: ['SUPER_ADMIN','SCHOOL_ADMIN'] },
        { label: t.terms,          href: '/terms',              icon: CalendarDays,   roles: ['SUPER_ADMIN','SCHOOL_ADMIN'] },
        { label: t.reports,        href: '/reports',            icon: BarChart3,      roles: ['SUPER_ADMIN','SCHOOL_ADMIN','TEACHER'] },
        { label: t.schedule,       href: '/activities',         icon: Clock,          roles: ['SUPER_ADMIN','SCHOOL_ADMIN','TEACHER'] },
        { label: 'Analytics',     href: '/analytics',          icon: BarChart3 },
        { label: 'Leaderboard',   href: '/leaderboard',        icon: Trophy },
        { label: 'Assignments',   href: '/assignments',        icon: ClipboardCheck },
        { label: 'Exams',          href: '/exams',              icon: BookMarked },
        { label: 'Certificates',   href: '/certificates',       icon: Star,           future: true },
      ]
    },
    {
      id: 'administration',
      label: 'Administration',
      icon: Wrench,
      items: [
        { label: t.users,    href: '/users',    icon: Users,       roles: ['SUPER_ADMIN','SCHOOL_ADMIN'] },
        { label: t.import,   href: '/import',   icon: Upload,      roles: ['SUPER_ADMIN','SCHOOL_ADMIN'] },
        { label: t.audit,    href: '/audit',    icon: Shield,      roles: ['SUPER_ADMIN','SCHOOL_ADMIN'] },
        { label: t.settings, href: '/settings', icon: Settings,    roles: ['SUPER_ADMIN','SCHOOL_ADMIN','TEACHER'] },
        { label: 'Roles',      href: '/roles',    icon: Shield,    future: true },
        { label: 'Analytics',  href: '/analytics',icon: BarChart3, future: true },
      ]
    },
  ], [t, role])

  // Filter items by role — deduplicate by href within each group (href must be unique per group)
  const filteredGroups = useMemo(() =>
    groups.map(group => ({
      ...group,
      items: group.items.filter((item, idx, arr) => {
        const hasRole = !item.roles || item.roles.includes(role)
        // Keep only the first occurrence of each href within this group
        const isFirstHref = arr.findIndex(x => x.href === item.href) === idx
        return hasRole && isFirstHref
      })
    })).filter(g => g.items.length > 0)
  , [groups, role])

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
            {user?.school?.logoUrl ? (
              <img
                src={resolveMediaUrl(user.school.logoUrl)}
                alt={user.school.name}
                className="w-8 h-8 rounded-lg object-contain bg-white/10 p-0.5 flex-shrink-0"
              />
            ) : (
              <div className="w-8 h-8 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg flex items-center justify-center flex-shrink-0">
                <Rss className="w-4 h-4 text-white" />
              </div>
            )}
            <div className="min-w-0">
              <p className="text-sm font-bold leading-none truncate">
                {user?.school?.name || 'HALQA'}
              </p>
              <p className="text-[10px] text-halqa-300 leading-none mt-0.5">Social Platform</p>
            </div>
          </div>
        )}
        {collapsed && (
          <div className="w-8 h-8 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg flex items-center justify-center">
            {user?.school?.logoUrl
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
              <p className="text-xs text-halqa-400 truncate capitalize">{user?.role?.replace(/_/g, ' ').toLowerCase()}</p>
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
