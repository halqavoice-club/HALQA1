'use client'

import { useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useAuthStore } from '@/store/auth.store'
import { Sidebar } from '@/components/layout/sidebar'
import { Header } from '@/components/layout/header'
import { MobileNav } from '@/components/layout/mobile-nav'
import { ClientOnly } from '@/components/client-only'
import { SessionTimeout } from '@/components/session-timeout'
import { ErrorBoundary } from '@/components/error-boundary'
import { useRoleAccess } from '@/hooks/useRoleAccess'
import { NotificationPermissionBanner } from '@/components/notification-permission-banner'
import { OfflineBanner } from '@/components/ui/offline-banner'
import { FloatingActionButton } from '@/components/ui/floating-action-button'
import { useSocialSocket } from '@/hooks/useSocial'
import { useDmSocket } from '@/hooks/useDmSocket'
import { useGroupChatSocket } from '@/hooks/useGroupChatSocket'
import { useRealtimeNotifications } from '@/hooks/useRealtimeNotifications'
import { NotificationCenter } from '@/components/notification-center'
import { useNotificationStore } from '@/store/notifications.store'
import { useKeyboardShortcuts, commonShortcuts } from '@/hooks/useKeyboardShortcuts'
import { useAnalytics } from '@/lib/analytics'
import { useVoiceStore } from '@/store/voice.store'
import { PKInvitationToast } from '@/components/pk/PKInvitationToast'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <ClientOnly><DashboardContent>{children}</DashboardContent></ClientOnly>
}

function DashboardContent({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, user, mustChangePassword, fetchMe } = useAuthStore()
  const router = useRouter()
  const pathname = usePathname()
  useRoleAccess()
  useSocialSocket()
  useDmSocket()
  useGroupChatSocket()
  useRealtimeNotifications()
  const { trackPageView } = useAnalytics()

  // FIX: When a voice room is active, suppress mobile nav bottom padding
  // so the voice room's bottom bar (gift, mic, hand-raise) is not pushed
  // off-screen by the 64px dashboard mobile navigation padding.
  const activeVoiceRoom = useVoiceStore(s => s.activeRoom)
  const isInVoiceRoom = !!activeVoiceRoom

  // FIX: Same treatment for live class rooms — /live-class/[id] has its own
  // full-height layout with a bottom controls bar that must not be clipped by
  // the bottom nav padding or the mobile-content-bottom padding.
  const isInLiveClass = /^\/live-class\/[^/]+/.test(pathname ?? '')

  const notifications = useNotificationStore((state) => state.notifications)
  const markAsRead = useNotificationStore((state) => state.markAsRead)
  const markAllAsRead = useNotificationStore((state) => state.markAllAsRead)
  const deleteNotification = useNotificationStore((state) => state.deleteNotification)
  const clearAll = useNotificationStore((state) => state.clearAll)

  // Keyboard shortcuts
  useKeyboardShortcuts([
    {
      ...commonShortcuts.notifications,
      handler: () => {
        // Open notification center (implement if needed)
      },
    },
  ])

  // Hydrate the full user profile (including schoolMemberships) on mount.
  // The login response includes schoolMemberships, but after a page refresh
  // only the persisted user metadata is restored from localStorage — the
  // schoolMemberships array is not persisted for security reasons.
  // This single call ensures the Education sidebar section appears correctly
  // after any page reload without the user having to log out and back in.
  useEffect(() => {
    if (isAuthenticated) {
      fetchMe()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated])

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login')
    } else if (mustChangePassword) {
      // Step 8: Admin-created accounts must change their temporary password
      // before accessing any dashboard content.
      router.replace('/change-password')
    } else {
      trackPageView(window.location.pathname, { userId: user?.id })
    }
  }, [isAuthenticated, mustChangePassword, router, user, trackPageView])

  if (!isAuthenticated || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-700" />
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden" dir="ltr" data-testid="dashboard-shell">
      {/* dir="ltr" on the shell keeps sidebar-left layout consistent.
          Individual text content uses the html dir attribute for RTL text. */}

      {/* FIX: On /admin/* routes, the admin layout renders its own sidebar.
          Suppress the standard Sidebar and Header here to avoid double navigation.
          This only applies to SUPER_ADMIN — school roles never see /admin routes. */}
      {!(user.role === 'SUPER_ADMIN' && pathname.startsWith('/admin')) && <Sidebar />}

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {!(user.role === 'SUPER_ADMIN' && pathname.startsWith('/admin')) && (
          // Hide the desktop header on mobile when inside a live class room.
          // The live class room has its own full-height layout with a built-in header.
          // On desktop (md+) the header is always shown.
          <div className={isInLiveClass ? 'hidden md:block' : undefined}>
            <Header>
              <NotificationCenter
                notifications={notifications}
                onMarkAsRead={markAsRead}
                onMarkAllAsRead={markAllAsRead}
                onDelete={deleteNotification}
                onClearAll={clearAll}
              />
            </Header>
          </div>
        )}
        <main className={`flex-1 overflow-y-auto ${!(user.role === 'SUPER_ADMIN' && pathname.startsWith('/admin')) ? isInLiveClass ? 'p-0 overflow-hidden' : `p-4 md:p-6 ${(isInVoiceRoom) ? 'pb-0' : 'mobile-content-bottom'} md:pb-6 mobile-content-top md:pt-4` : ''}`}>
          <ErrorBoundary>
            {children}
          </ErrorBoundary>
        </main>
      </div>

      {!(user.role === 'SUPER_ADMIN' && pathname.startsWith('/admin')) && <MobileNav />}
      <SessionTimeout />
      <NotificationPermissionBanner />
      <OfflineBanner />
      {!(user.role === 'SUPER_ADMIN' && pathname.startsWith('/admin')) && !isInLiveClass && <FloatingActionButton />}
      {/* Global PK challenge toast — shows accept/decline popup for incoming PK invitations */}
      <PKInvitationToast />
    </div>
  )
}
