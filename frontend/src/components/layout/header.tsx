'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Bell, User, Settings, LogOut, ChevronDown, GraduationCap, UserCheck, BookOpen } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/store/auth.store'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { SearchInput } from '@/components/ui/search-input'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { useQuery } from '@tanstack/react-query'
import { useDebounce } from '@/hooks/useDebounce'
import api from '@/lib/api'
import { format } from 'date-fns'
import { getAvatarUrl } from '@/lib/avatar'
import { LanguageSwitcher } from '@/components/ui/language-switcher'
import { ThemeSwitcher } from '@/components/ui/theme-switcher'
import { useTranslation } from '@/hooks/useTranslation'
import { HijriDate } from '@/components/islamic/hijri-date'
import { useThemeStore } from '@/store/theme.store'

export function Header({ children }: { children?: React.ReactNode }) {
  const { user, logout } = useAuthStore()
  const { t } = useTranslation()
  const { language } = useThemeStore()
  const isRTL = language === 'ar'
  const [search, setSearch] = useState('')
  const [showResults, setShowResults] = useState(false)
  const pathname = usePathname()
  const searchRef = useRef<HTMLDivElement>(null)
  const debouncedSearch = useDebounce(search, 300)
  const pageTitle = getPageTitle(pathname, t)

  const { data: notifData } = useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: () => api.get('/notifications/unread-count').then(r => r.data.data),
    staleTime: 0,                     // always fresh
    refetchInterval: 60000,
    refetchIntervalInBackground: false
  })

  const { data: searchResults, isFetching: searchLoading } = useQuery({
    queryKey: ['search', debouncedSearch],
    queryFn: () => api.get('/search', { params: { q: debouncedSearch } }).then(r => r.data.data),
    enabled: debouncedSearch.length >= 2
  })

  const unreadCount = notifData?.count || 0
  const hasResults = searchResults && (
    searchResults.students?.length > 0 ||
    searchResults.teachers?.length > 0 ||
    searchResults.classes?.length > 0
  )

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowResults(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <header className={cn(
      "h-16 bg-white border-b border-gray-200 flex items-center px-4 md:px-6 gap-4 flex-shrink-0 z-10",
      isRTL && "flex-row-reverse"
    )}>
      <div className="hidden md:block min-w-0">
        <h2 className="text-base font-semibold text-gray-900 truncate">{pageTitle}</h2>
        <div className="flex items-center gap-3">
          <p className="text-xs text-gray-400">{format(new Date(), 'EEEE, MMMM d, yyyy')}</p>
          <HijriDate compact className="hidden lg:flex" />
        </div>
      </div>

      <div className="flex-1" />

      {/* Search */}
      <div ref={searchRef} className="hidden md:block relative w-72">
        <SearchInput
          value={search}
          onChange={v => { setSearch(v); setShowResults(true) }}
          placeholder="Search students, teachers..."
          isLoading={searchLoading}
          onFocus={() => setShowResults(true)}
        />

        {showResults && debouncedSearch.length >= 2 && (
          <div className="absolute top-full mt-1 left-0 right-0 bg-white rounded-xl shadow-xl border border-gray-100 z-50 overflow-hidden max-h-80 overflow-y-auto">
            {!hasResults ? (
              <p className="text-sm text-gray-500 text-center py-6">No results for &quot;{debouncedSearch}&quot;</p>
            ) : (
              <div className="py-1">
                {searchResults.students?.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-3 py-2">Students</p>
                    {searchResults.students.map((s: any) => (
                      <Link key={s.id} href={`/students/${s.id}`}
                        onClick={() => { setSearch(''); setShowResults(false) }}
                        className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 transition-colors">
                        <div className="w-7 h-7 bg-halqa-100 rounded-full flex items-center justify-center flex-shrink-0">
                          <GraduationCap className="w-3.5 h-3.5 text-halqa-700" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-900">{s.user?.firstName} {s.user?.lastName}</p>
                          <p className="text-xs text-gray-400">{s.studentId}</p>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
                {searchResults.teachers?.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-3 py-2">Teachers</p>
                    {searchResults.teachers.map((t: any) => (
                      <Link key={t.id} href={`/teachers/${t.id}`}
                        onClick={() => { setSearch(''); setShowResults(false) }}
                        className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 transition-colors">
                        <div className="w-7 h-7 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
                          <UserCheck className="w-3.5 h-3.5 text-green-700" />
                        </div>
                        <p className="text-sm font-medium text-gray-900">{t.user?.firstName} {t.user?.lastName}</p>
                      </Link>
                    ))}
                  </div>
                )}
                {searchResults.classes?.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-3 py-2">Classes</p>
                    {searchResults.classes.map((c: any) => (
                      <Link key={c.id} href={`/classes/${c.id}`}
                        onClick={() => { setSearch(''); setShowResults(false) }}
                        className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 transition-colors">
                        <div className="w-7 h-7 bg-purple-100 rounded-full flex items-center justify-center flex-shrink-0">
                          <BookOpen className="w-3.5 h-3.5 text-purple-700" />
                        </div>
                        <p className="text-sm font-medium text-gray-900">{c.name}</p>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Language + Theme switchers */}
      <LanguageSwitcher />
      <ThemeSwitcher />

      {/* Notification Center */}
      {children}

      {/* Notifications link (fallback) */}
      <Link
        href="/notifications"
        aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ''}`}
        className="relative p-2 rounded-lg hover:bg-gray-100 transition-colors"
      >
        <Bell className="w-5 h-5 text-gray-600" aria-hidden="true" />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 min-w-[16px] h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-0.5">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </Link>

      {/* User dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="flex items-center gap-2 rounded-lg hover:bg-gray-100 p-1.5 pr-2 transition-colors"
            aria-label={`User menu for ${user?.firstName} ${user?.lastName}`}
          >
            <Avatar className="w-8 h-8">
              <AvatarImage src={getAvatarUrl(user?.avatarUrl)} />
              <AvatarFallback className="bg-halqa-700 text-white text-xs font-semibold">
                {user?.firstName?.[0]}{user?.lastName?.[0]}
              </AvatarFallback>
            </Avatar>
            <div className="hidden md:block text-left">
              <p className="text-sm font-medium text-gray-900 leading-none">{user?.firstName} {user?.lastName}</p>
              <p className="text-xs text-gray-500 mt-0.5 capitalize">{user?.role?.replace(/_/g, ' ').toLowerCase()}</p>
            </div>
            <ChevronDown className="w-3.5 h-3.5 text-gray-400 hidden md:block" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuLabel className="font-normal">
            <div className="flex flex-col space-y-1">
              <p className="text-sm font-medium">{user?.firstName} {user?.lastName}</p>
              <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
              <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full w-fit mt-0.5 ${
                user?.role === 'SUPER_ADMIN' ? 'bg-red-100 text-red-700' :
                user?.role === 'SCHOOL_ADMIN' ? 'bg-purple-100 text-purple-700' :
                user?.role === 'TEACHER' ? 'bg-green-100 text-green-700' :
                user?.role === 'STUDENT' ? 'bg-blue-100 text-blue-700' :
                user?.role === 'GUARDIAN' ? 'bg-orange-100 text-orange-700' :
                'bg-gray-100 text-gray-700'
              }`}>
                {user?.role?.replace(/_/g, ' ')}
              </span>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href="/profile" className="cursor-pointer"><User className="mr-2 h-4 w-4" aria-hidden="true" /> {t.profile}</Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/settings" className="cursor-pointer"><Settings className="mr-2 h-4 w-4" aria-hidden="true" /> {t.settings}</Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={logout} className="text-red-600 focus:text-red-600 focus:bg-red-50 cursor-pointer">
            <LogOut className="mr-2 h-4 w-4" aria-hidden="true" /> {t.logout}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  )
}

function getPageTitle(pathname: string, t: any): string {
  const map: Record<string, string> = {
    '/dashboard': t.dashboard,
    '/students': t.students,
    '/teachers': t.teachers,
    '/guardians': t.guardians,
    '/classes': t.classes,
    '/attendance': t.attendance,
    '/attendance/report': t.attendanceReport,
    '/behavior': t.behavior,
    '/grades': t.grades,
    '/activities': t.schedule,
    '/messages': t.messages,
    '/announcements': t.announcements,
    '/calendar': t.calendar,
    '/schedule': t.schedule,
    '/notes': t.notes,
    '/reports': t.reports,
    '/import': t.import,
    '/terms': t.terms,
    '/schools': t.schools,
    '/audit': t.audit,
    '/settings': t.settings,
    '/profile': t.profile,
    '/notifications': t.notifications,
    '/users': t.users,
    '/audio': t.audio,
    '/fees': t.fees,
    '/library': t.library,
  }
  if (map[pathname]) return map[pathname]
  for (const [key, value] of Object.entries(map)) {
    if (pathname.startsWith(key + '/')) return value
  }
  return 'Halqa Management'
}
