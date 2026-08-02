'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
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

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <ClientOnly><DashboardContent>{children}</DashboardContent></ClientOnly>
}

function DashboardContent({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, user } = useAuthStore()
  const router = useRouter()
  useRoleAccess()
  useSocialSocket()
  useDmSocket()
  useGroupChatSocket()
  useRealtimeNotifications()
  const { trackPageView } = useAnalytics()

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

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login')
    } else {
      trackPageView(window.location.pathname, { userId: user?.id })
    }
  }, [isAuthenticated, router, user, trackPageView])

  if (!isAuthenticated || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-700" />
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden" dir="ltr">
      {/* dir="ltr" on the shell keeps sidebar-left layout consistent.
          Individual text content uses the html dir attribute for RTL text. */}
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Header>
          <NotificationCenter
            notifications={notifications}
            onMarkAsRead={markAsRead}
            onMarkAllAsRead={markAllAsRead}
            onDelete={deleteNotification}
            onClearAll={clearAll}
          />
        </Header>
        <main className="flex-1 overflow-y-auto p-4 md:p-6 pb-20 md:pb-6">
          <ErrorBoundary>
            {children}
          </ErrorBoundary>
        </main>
      </div>
      <MobileNav />
      <SessionTimeout />
      <NotificationPermissionBanner />
      <OfflineBanner />
      <FloatingActionButton />
    </div>
  )
}
