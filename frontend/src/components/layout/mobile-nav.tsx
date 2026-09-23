'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/store/auth.store'
import { useTranslation } from '@/hooks/useTranslation'
import { useSchoolAccess } from '@/hooks/useSchoolAccess'
import {
  LayoutDashboard, ClipboardCheck, Star, BookMarked,
  MessageSquare, MoreHorizontal, X, GraduationCap,
  BookOpen, Users, UserCheck, Calendar, StickyNote,
  BarChart3, Megaphone, Clock, Upload, Shield, Settings,
  CalendarDays, School, Bell, LayoutGrid, Headphones,
  DollarSign, Radio, UserPlus, MessagesSquare, Video,
  Rss, UsersRound, Compass, Sparkles, Wallet, Home,
  GraduationCap as EduIcon, Wrench, PlusCircle, Trophy,
  QrCode, Globe, Clapperboard,
} from 'lucide-react'
import { useSocialStore } from '@/store/social.store'
import { useDmStore } from '@/store/dm.store'
import { useQuery } from '@tanstack/react-query'
import api from '@/lib/api'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { getAvatarUrl } from '@/lib/avatar'
import { ThemeSwitcher } from '@/components/ui/theme-switcher'
import { LanguageSwitcher } from '@/components/ui/language-switcher'
import { useVoiceStore } from '@/store/voice.store'

export function MobileNav() {
  const pathname = usePathname()
  const { user } = useAuthStore()
  const { t } = useTranslation()
  const [showMore, setShowMore] = useState(false)
  const { pendingCount } = useSocialStore()
  const { totalUnread: dmUnread } = useDmStore()

  // FIX: Hide mobile nav while inside a voice room so the voice room's
  // own bottom bar (gift, hand-raise, mic, chat, react, leave) is fully
  // visible and not covered by the dashboard nav bar.
  // NOTE: useVoiceStore is called here (with all other hooks) — the actual
  // early return is placed AFTER all hooks are called (see below).
  const activeVoiceRoom = useVoiceStore(s => s.activeRoom)

  // ── School access — same hook used by the desktop sidebar ─────────────────
  const { hasSchools, activeRole, canEducation } = useSchoolAccess()

  // ── Notification unread count for mobile header bell ──────────────────────
  const { data: notifData } = useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: () => api.get('/notifications/unread-count').then(r => r.data.data),
    staleTime: 0,
    refetchInterval: 60000,
    refetchIntervalInBackground: false,
  })
  const unreadCount = notifData?.count || 0

  // ── Mobile bottom bar: Feed | Voice | Live | Friend | My School | More ────
  const primaryNav = [
    { label: 'Feed',      href: '/feed',               icon: Rss      },
    { label: 'Voice',     href: '/voice-club',          icon: Radio    },
    { label: 'Live',      href: '/live-class',          icon: Video    },
    { label: 'Friend',    href: '/social',              icon: UserPlus, badge: 'social' as const },
    { label: 'My School', href: '/school-memberships',  icon: School   },
  ]

  // More drawer — grouped by ecosystem, built dynamically from school access
  const moreNavGroups = useMemo(() => {
    // ── Education items — mirrors the desktop sidebar logic ─────────────────
    // SA-NAV-01: Items are gated by school membership role via canEducation(),
    // NOT by user.role (platform role). This ensures STUDENT/TEACHER/SCHOOL_ADMIN
    // memberships are correctly respected, and plain USER sees the onboarding prompts.
    const educationItems = hasSchools ? [
      { label: 'My Schools',    href: '/school-memberships',   icon: School },
      ...(canEducation('VIEW_STUDENTS') ? [{ label: t.students,     href: '/students',     icon: GraduationCap }] : []),
      ...(canEducation('VIEW_TEACHERS') ? [{ label: t.teachers,     href: '/teachers',     icon: UserCheck     }] : []),
      ...(canEducation('VIEW_GUARDIANS')? [{ label: t.guardians,    href: '/guardians',    icon: Users         }] : []),
      ...(canEducation('VIEW_CLASSES')  ? [{ label: t.classes,      href: '/classes',      icon: BookOpen      }] : []),
      ...(canEducation('VIEW_ATTENDANCE')? [{ label: t.attendance,  href: '/attendance',   icon: ClipboardCheck}] : []),
      ...(canEducation('VIEW_ATTENDANCE') && activeRole !== 'GUARDIAN' ? [
        { label: 'QR Check-in', href: '/attendance/qr-checkin', icon: QrCode }
      ] : []),
      ...(canEducation('VIEW_GRADES')   ? [{ label: t.grades,       href: '/grades',       icon: BookMarked    }] : []),
      ...(canEducation('VIEW_BEHAVIOR') ? [{ label: t.behavior,     href: '/behavior',     icon: Star          }] : []),
      ...(canEducation('VIEW_AUDIO_LESSONS')? [{ label: t.audio,    href: '/audio',        icon: Headphones    }] : []),
      ...(canEducation('VIEW_LIBRARY')  ? [{ label: t.library,      href: '/library',      icon: BookOpen      }] : []),
      ...(canEducation('VIEW_FEES')     ? [{ label: t.fees,         href: '/fees',         icon: DollarSign    }] : []),
      ...(canEducation('VIEW_REPORTS')  ? [{ label: t.reports,      href: '/reports',      icon: BarChart3     }] : []),
      ...(canEducation('VIEW_ASSIGNMENTS')? [{ label: 'Assignments',href: '/assignments',  icon: ClipboardCheck}] : []),
      ...(canEducation('VIEW_EXAMS')    ? [{ label: 'Exams',        href: '/exams',        icon: BookMarked    }] : []),
      { label: t.announcements, href: '/announcements', icon: Megaphone },
      { label: t.calendar,      href: '/calendar',      icon: Calendar  },
      ...(canEducation('VIEW_LEADERBOARD') ? [{ label: 'Leaderboard', href: '/leaderboard', icon: Trophy }] : []),
      ...(canEducation('VIEW_SCHEDULE') ? [{ label: t.schedule,     href: '/activities',   icon: Clock         }] : []),
    ] : [
      // No school membership → show onboarding prompts
      { label: 'Join a School',   href: '/schools/join',             icon: School     },
      { label: 'Create a School', href: '/school-memberships/create',icon: PlusCircle },
    ]

    // ── Administration — school-scoped admin tools (SCHOOL_ADMIN only) ───────
    // SA-NAV-02: SUPER_ADMIN platform role does NOT grant these; only an explicit
    // SCHOOL_ADMIN membership (activeRole) does.
    const administrationItems = hasSchools && activeRole === 'SCHOOL_ADMIN' ? [
      { label: 'Members',  href: '/school-memberships/manage', icon: Users       },
      { label: t.users,    href: '/users',                     icon: Users       },
      { label: t.import,   href: '/import',                    icon: Upload      },
      { label: t.audit,    href: '/audit',                     icon: Shield      },
      { label: t.settings, href: '/settings',                  icon: Settings    },
    ] : (activeRole === 'TEACHER' || (hasSchools && !activeRole) ? [
      { label: t.settings, href: '/settings',                  icon: Settings    },
    ] : [
      { label: t.settings, href: '/settings',                  icon: Settings    },
    ])

    // ── SUPER_ADMIN platform admin items ─────────────────────────────────────
    const platformItems = user?.role === 'SUPER_ADMIN' ? [
      { label: 'Schools',   href: '/admin/schools',   icon: School    },
      { label: 'Users',     href: '/admin/users',     icon: Users     },
      { label: 'Payments',  href: '/admin/payments',  icon: DollarSign},
      { label: 'Security',  href: '/admin/security',  icon: Shield    },
      { label: t.settings,  href: '/settings',        icon: Settings  },
    ] : []

    return [
      {
        title: 'Home',
        icon: Home,
        items: [
          { label: t.dashboard,     href: '/dashboard',    icon: LayoutDashboard },
          { label: 'Notifications', href: '/notifications',icon: Bell            },
        ]
      },
      {
        title: 'Social',
        icon: Rss,
        items: [
          { label: 'Explore',     href: '/explore',     icon: Compass     },
          { label: 'Communities', href: '/communities', icon: UsersRound  },
          { label: t.voiceClub,   href: '/voice-club',  icon: Radio       },
          { label: 'Live Rooms',  href: '/live-class',  icon: Video       },
          { label: 'Live Streams',href: '/live-stream', icon: Globe       },
          { label: t.messages,    href: '/dm',          icon: MessageSquare},
          { label: 'Groups',      href: '/group-chat',  icon: Users       },
          { label: 'Creator',     href: '/creator',     icon: Sparkles    },
          { label: 'Wallet',      href: '/wallet',      icon: Wallet      },
        ]
      },
      {
        title: 'Education',
        icon: EduIcon,
        items: educationItems,
      },
      // Administration section only shown when there are items to display
      ...(administrationItems.length > 0 ? [{
        title: 'Administration',
        icon: Wrench,
        items: administrationItems,
      }] : []),
      // Platform Admin section only for SUPER_ADMIN
      ...(platformItems.length > 0 ? [{
        title: 'Platform Admin',
        icon: Shield,
        items: platformItems,
      }] : []),
    ]
  }, [t, hasSchools, activeRole, canEducation, user?.role])

  const isMoreActive = !primaryNav.some(
    item => pathname === item.href || pathname.startsWith(item.href + '/')
  )

  // Early return AFTER all hooks — React Rules of Hooks require this placement.
  // Hides the mobile nav bar while the user is inside a voice room so the
  // voice room's own bottom bar (Gift, Mic, React, Chat, Leave) is visible.
  if (activeVoiceRoom) return null

  // Hides the mobile nav bar while the user is inside a live class room so the
  // live class controls bar (Mic, Camera, Chat, Leave, etc.) is fully visible
  // and not covered by this 64px fixed bottom navigation bar.
  if (/^\/live-class\/[^/]+/.test(pathname ?? '')) return null

  return (
    <>
      {/* ── Mobile top header ─────────────────────────────────────────────── */}
      {/* Home | Globe(Explore) | Reels | Notifications | Chat | Profile       */}
      <header className="md:hidden fixed top-0 left-0 right-0 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 z-50 safe-top">
        <div className="flex items-center justify-between h-14 px-2">
          {/* Home → Feed (default landing after login) */}
          <Link
            href="/feed"
            className={cn(
              'flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-lg transition-colors',
              pathname === '/feed' || pathname === '/dashboard' ? 'text-halqa-600 dark:text-halqa-400' : 'text-gray-500 dark:text-gray-400'
            )}
          >
            <Home className="w-5 h-5" />
            <span className="text-[10px] font-medium">Home</span>
          </Link>

          {/* Globe → Explore */}
          <Link
            href="/explore"
            className={cn(
              'flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-lg transition-colors',
              pathname === '/explore' || pathname.startsWith('/explore/') ? 'text-halqa-600 dark:text-halqa-400' : 'text-gray-500 dark:text-gray-400'
            )}
          >
            <Globe className="w-5 h-5" />
            <span className="text-[10px] font-medium">Explore</span>
          </Link>

          {/* Reels — existing /reels route */}
          <Link
            href="/reels"
            className={cn(
              'flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-lg transition-colors',
              pathname === '/reels' || pathname.startsWith('/reels/') ? 'text-halqa-600 dark:text-halqa-400' : 'text-gray-500 dark:text-gray-400'
            )}
          >
            <Clapperboard className="w-5 h-5" />
            <span className="text-[10px] font-medium">Reels</span>
          </Link>

          {/* Notifications */}
          <Link
            href="/notifications"
            aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ''}`}
            className={cn(
              'flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-lg transition-colors relative',
              pathname === '/notifications' ? 'text-halqa-600 dark:text-halqa-400' : 'text-gray-500 dark:text-gray-400'
            )}
          >
            <div className="relative">
              <Bell className="w-5 h-5" />
              {unreadCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[14px] h-3.5 bg-red-500 text-white text-[9px] font-black rounded-full flex items-center justify-center px-0.5">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </div>
            <span className="text-[10px] font-medium">Alerts</span>
          </Link>

          {/* Chat → /dm */}
          <Link
            href="/dm"
            className={cn(
              'flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-lg transition-colors',
              pathname === '/dm' || pathname.startsWith('/dm/') ? 'text-halqa-600 dark:text-halqa-400' : 'text-gray-500 dark:text-gray-400'
            )}
          >
            <div className="relative">
              <MessagesSquare className="w-5 h-5" />
              {dmUnread > 0 && (
                <span className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 bg-indigo-500 rounded-full text-[9px] font-black text-white flex items-center justify-center">
                  {dmUnread > 9 ? '9+' : dmUnread}
                </span>
              )}
            </div>
            <span className="text-[10px] font-medium">Chat</span>
          </Link>

          {/* Profile */}
          <Link
            href="/profile"
            className={cn(
              'flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-lg transition-colors',
              pathname === '/profile' || pathname.startsWith('/profile/') ? 'text-halqa-600 dark:text-halqa-400' : 'text-gray-500 dark:text-gray-400'
            )}
          >
            <Avatar className="w-6 h-6">
              <AvatarImage src={getAvatarUrl(user?.avatarUrl)} />
              <AvatarFallback className="bg-halqa-700 text-white text-[9px] font-semibold">
                {user?.firstName?.[0]}{user?.lastName?.[0]}
              </AvatarFallback>
            </Avatar>
            <span className="text-[10px] font-medium">Profile</span>
          </Link>
        </div>
      </header>

      {/* ── Mobile bottom navigation bar ──────────────────────────────────── */}
      {/* Feed | Voice | Live | Friend | My School | More                      */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 z-50 safe-bottom">
        <div className="flex items-center justify-around h-16">
          {primaryNav.map(item => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
            const Icon = item.icon
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex flex-col items-center gap-0.5 px-1.5 py-2 rounded-lg transition-colors min-w-0 relative flex-1',
                  isActive ? 'text-halqa-600 dark:text-halqa-400' : 'text-gray-500 dark:text-gray-400'
                )}
              >
                <div className="relative">
                  <Icon className="w-5 h-5" />
                  {item.badge === 'social' && pendingCount > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 rounded-full text-[9px] font-black text-white flex items-center justify-center">
                      {pendingCount > 9 ? '9+' : pendingCount}
                    </span>
                  )}
                </div>
                <span className="text-[10px] font-medium truncate w-full text-center">{item.label}</span>
              </Link>
            )
          })}

          <button
            onClick={() => setShowMore(true)}
            className={cn(
              'flex flex-col items-center gap-0.5 px-1.5 py-2 rounded-lg transition-colors flex-1',
              isMoreActive ? 'text-halqa-600 dark:text-halqa-400' : 'text-gray-500 dark:text-gray-400'
            )}
          >
            <MoreHorizontal className="w-5 h-5" />
            <span className="text-[10px] font-medium">More</span>
          </button>
        </div>
      </nav>

      {/* More drawer */}
      {showMore && (
        <div className="md:hidden fixed inset-0 z-[60] flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowMore(false)} />
          <div className="relative bg-white dark:bg-gray-900 rounded-t-2xl max-h-[85vh] overflow-y-auto pb-safe">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-700 sticky top-0 bg-white dark:bg-gray-900 z-10">
              <h3 className="font-semibold text-gray-900 dark:text-gray-100">Menu</h3>
              <button onClick={() => setShowMore(false)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 space-y-5">
              {moreNavGroups.map(group => {
                if (group.items.length === 0) return null
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
                      {group.items.map(item => {
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
                                ? 'bg-halqa-100 text-halqa-700 dark:bg-halqa-900 dark:text-halqa-300'
                                : 'bg-gray-50 text-gray-600 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'
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

              {/* Appearance — Theme + Language accessible from mobile without going to Settings */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Settings className="w-3.5 h-3.5 text-gray-400" />
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Appearance</p>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2 bg-gray-50 dark:bg-gray-800 rounded-xl px-3 py-2.5">
                    <span className="text-sm text-gray-600 dark:text-gray-300 flex-1">Theme</span>
                    <ThemeSwitcher />
                  </div>
                  <div className="flex items-center gap-2 bg-gray-50 dark:bg-gray-800 rounded-xl px-3 py-2.5">
                    <span className="text-sm text-gray-600 dark:text-gray-300 flex-1">Language</span>
                    <LanguageSwitcher />
                  </div>
                  <Link
                    href="/settings"
                    onClick={() => setShowMore(false)}
                    className="flex items-center gap-2 bg-gray-50 dark:bg-gray-800 rounded-xl px-3 py-2.5 text-sm text-halqa-600 font-medium hover:bg-halqa-50 dark:hover:bg-halqa-900/20 transition-colors"
                  >
                    <Settings className="w-4 h-4" />
                    <span className="flex-1">All appearance settings</span>
                    <span className="text-gray-400 text-xs">→</span>
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
