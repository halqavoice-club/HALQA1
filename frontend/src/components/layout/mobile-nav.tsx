'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/store/auth.store'
import { useTranslation } from '@/hooks/useTranslation'
import {
  LayoutDashboard, ClipboardCheck, Star, BookMarked,
  MessageSquare, MoreHorizontal, X, GraduationCap,
  BookOpen, Users, UserCheck, Calendar, StickyNote,
  BarChart3, Megaphone, Clock, Upload, Shield, Settings,
  CalendarDays, School, Bell, LayoutGrid, Headphones,
  DollarSign, Radio, UserPlus, MessagesSquare, Video,
  Rss, UsersRound, Compass, Sparkles, Wallet, Home,
  GraduationCap as EduIcon, Wrench,
} from 'lucide-react'
import { useSocialStore } from '@/store/social.store'
import { useDmStore } from '@/store/dm.store'

export function MobileNav() {
  const pathname = usePathname()
  const { user } = useAuthStore()
  const { t } = useTranslation()
  const [showMore, setShowMore] = useState(false)
  const { pendingCount } = useSocialStore()
  const { totalUnread: dmUnread } = useDmStore()

  // Bottom bar: 4 most-used items + More
  const primaryNav = [
    { label: 'Home',   href: '/dashboard', icon: LayoutDashboard },
    { label: 'Feed',   href: '/feed',      icon: Rss },
    { label: 'Chat',   href: '/dm',        icon: MessagesSquare, badge: 'dm'     as const },
    { label: 'Social', href: '/social',    icon: UserPlus,       badge: 'social' as const },
  ]

  // More drawer — grouped by ecosystem
  const moreNavGroups = [
    {
      title: 'Home',
      icon: Home,
      items: [
        { label: t.dashboard,    href: '/dashboard',    icon: LayoutDashboard },
        { label: 'Notifications',href: '/notifications',icon: Bell },
      ]
    },
    {
      title: 'Social',
      icon: Rss,
      items: [
        { label: 'Explore',      href: '/explore',      icon: Compass },
        { label: 'Communities',  href: '/communities',  icon: UsersRound },
        { label: t.voiceClub,    href: '/voice-club',   icon: Radio },
        { label: 'Live Rooms',   href: '/live-class',   icon: Video },
        { label: t.messages,     href: '/messages',     icon: MessageSquare },
        { label: 'Creator',      href: '/creator',      icon: Sparkles },
        { label: 'Wallet',       href: '/wallet',       icon: Wallet },
      ]
    },
    {
      title: 'Education',
      icon: EduIcon,
      items: [
        { label: t.students,     href: '/students',            icon: GraduationCap, roles: ['SUPER_ADMIN','SCHOOL_ADMIN','TEACHER'] },
        { label: t.teachers,     href: '/teachers',            icon: UserCheck,     roles: ['SUPER_ADMIN','SCHOOL_ADMIN'] },
        { label: t.guardians,    href: '/guardians',           icon: Users,         roles: ['SUPER_ADMIN','SCHOOL_ADMIN'] },
        { label: t.classes,      href: '/classes',             icon: BookOpen,      roles: ['SUPER_ADMIN','SCHOOL_ADMIN','TEACHER'] },
        { label: t.attendance,   href: '/attendance',          icon: ClipboardCheck },
        { label: t.grades,       href: '/grades',              icon: BookMarked },
        { label: t.behavior,     href: '/behavior',            icon: Star },
        { label: t.audio,        href: '/audio',               icon: Headphones },
        { label: t.library,      href: '/library',             icon: BookOpen,      roles: ['SUPER_ADMIN','SCHOOL_ADMIN','TEACHER','STUDENT'] },
        { label: t.fees,         href: '/fees',                icon: DollarSign,    roles: ['SUPER_ADMIN','SCHOOL_ADMIN'] },
        { label: t.reports,      href: '/reports',             icon: BarChart3,     roles: ['SUPER_ADMIN','SCHOOL_ADMIN','TEACHER'] },
        { label: t.announcements,href: '/announcements',       icon: Megaphone },
        { label: t.calendar,     href: '/calendar',            icon: Calendar },
        { label: t.notes,        href: '/notes',               icon: StickyNote,    roles: ['SUPER_ADMIN','SCHOOL_ADMIN','TEACHER','STUDENT'] },
        { label: t.schedule,     href: '/activities',          icon: Clock,         roles: ['SUPER_ADMIN','SCHOOL_ADMIN','TEACHER'] },
      ]
    },
    {
      title: 'Administration',
      icon: Wrench,
      items: [
        { label: t.schools,  href: '/schools', icon: School,      roles: ['SUPER_ADMIN'] },
        { label: t.users,    href: '/users',   icon: Users,       roles: ['SUPER_ADMIN','SCHOOL_ADMIN'] },
        { label: t.import,   href: '/import',  icon: Upload,      roles: ['SUPER_ADMIN','SCHOOL_ADMIN'] },
        { label: t.terms,    href: '/terms',   icon: CalendarDays,roles: ['SUPER_ADMIN','SCHOOL_ADMIN'] },
        { label: t.audit,    href: '/audit',   icon: Shield,      roles: ['SUPER_ADMIN','SCHOOL_ADMIN'] },
        { label: t.settings, href: '/settings',icon: Settings },
      ]
    },
  ]

  const isMoreActive = !primaryNav.some(item => pathname === item.href)

  return (
    <>
      {/* Bottom nav bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-40 safe-bottom">
        <div className="flex items-center justify-around h-16">
          {primaryNav.map(item => {
            const isActive = pathname === item.href
            const Icon = item.icon
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex flex-col items-center gap-0.5 px-3 py-2 rounded-lg transition-colors min-w-0 relative',
                  isActive ? 'text-halqa-700' : 'text-gray-500'
                )}
              >
                <div className="relative">
                  <Icon className="w-5 h-5" />
                  {item.badge === 'dm' && dmUnread > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-indigo-500 rounded-full text-[9px] font-black text-white flex items-center justify-center">
                      {dmUnread > 9 ? '9+' : dmUnread}
                    </span>
                  )}
                  {item.badge === 'social' && pendingCount > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 rounded-full text-[9px] font-black text-white flex items-center justify-center">
                      {pendingCount > 9 ? '9+' : pendingCount}
                    </span>
                  )}
                </div>
                <span className="text-[10px] font-medium">{item.label}</span>
              </Link>
            )
          })}

          <button
            onClick={() => setShowMore(true)}
            className={cn(
              'flex flex-col items-center gap-0.5 px-3 py-2 rounded-lg transition-colors',
              isMoreActive ? 'text-halqa-700' : 'text-gray-500'
            )}
          >
            <MoreHorizontal className="w-5 h-5" />
            <span className="text-[10px] font-medium">More</span>
          </button>
        </div>
      </nav>

      {/* More drawer */}
      {showMore && (
        <div className="md:hidden fixed inset-0 z-50 flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowMore(false)} />
          <div className="relative bg-white rounded-t-2xl max-h-[85vh] overflow-y-auto pb-safe">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 sticky top-0 bg-white z-10">
              <h3 className="font-semibold text-gray-900">Menu</h3>
              <button onClick={() => setShowMore(false)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 space-y-5">
              {moreNavGroups.map(group => {
                const visibleItems = group.items.filter(item =>
                  !item.roles || item.roles.includes(user?.role || '')
                )
                if (visibleItems.length === 0) return null
                const GroupIcon = group.icon
                return (
                  <div key={group.title}>
                    <div className="flex items-center gap-2 mb-2">
                      <GroupIcon className="w-3.5 h-3.5 text-gray-400" />
                      <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                        {group.title}
                      </p>
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                      {visibleItems.map(item => {
                        const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
                        const Icon = item.icon
                        return (
                          <Link
                            key={item.href + item.label}
                            href={item.href}
                            onClick={() => setShowMore(false)}
                            className={cn(
                              'flex flex-col items-center gap-1.5 p-3 rounded-xl transition-all relative',
                              isActive
                                ? 'bg-halqa-100 text-halqa-700'
                                : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
                            )}
                          >
                            <Icon className="w-5 h-5" />
                            <span className="text-[10px] font-medium text-center leading-tight">
                              {item.label}
                            </span>
                          </Link>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
