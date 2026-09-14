'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Plus, X, ClipboardCheck, BookMarked, MessageSquare, Star, QrCode } from 'lucide-react'
import { useAuthStore } from '@/store/auth.store'
import { cn } from '@/lib/utils'

interface FABAction {
  label: string
  href: string
  icon: any
  color: string
}

export function FloatingActionButton() {
  const { user } = useAuthStore()
  const [open, setOpen] = useState(false)

  const role = user?.role || ''

  const actions: FABAction[] = []

  // SA-FAB-01: SUPER_ADMIN is a platform role — not a school-scoped teacher/admin.
  // Floating action buttons for school content (attendance, classes, etc.)
  // require a school membership role, not the platform admin role.
  if (['SCHOOL_ADMIN', 'TEACHER'].includes(role)) {
    actions.push(
      { label: 'Mark Attendance', href: '/attendance',   icon: ClipboardCheck, color: 'bg-green-500' },
      { label: 'Add Grade',       href: '/grades',       icon: BookMarked,     color: 'bg-blue-500' },
      { label: 'Log Behavior',    href: '/behavior',     icon: Star,           color: 'bg-yellow-500' },
      { label: 'New Message',     href: '/dm',           icon: MessageSquare,  color: 'bg-purple-500' },
    )
  }

  if (role === 'STUDENT') {
    actions.push(
      { label: 'QR Check-in',  href: '/attendance/qr-checkin', icon: QrCode,        color: 'bg-halqa-700' },
      { label: 'My Grades',    href: '/grades',                icon: BookMarked,    color: 'bg-blue-500' },
      { label: 'Messages',     href: '/dm',                    icon: MessageSquare, color: 'bg-purple-500' },
    )
  }

  if (role === 'GUARDIAN') {
    actions.push(
      { label: 'Messages',     href: '/dm',           icon: MessageSquare,  color: 'bg-purple-500' },
      { label: 'Attendance',   href: '/attendance',   icon: ClipboardCheck, color: 'bg-green-500' },
    )
  }

  if (actions.length === 0) return null

  return (
    <div className="md:hidden fixed bottom-20 right-4 z-40 flex flex-col items-end gap-3">
      {open && (
        <>
          {actions.map((action, i) => {
            const Icon = action.icon
            return (
              <Link key={i} href={action.href} onClick={() => setOpen(false)}>
                <div className="flex items-center gap-2 animate-fade-in" style={{ animationDelay: `${i * 50}ms` }}>
                  <span className="bg-white text-gray-800 text-xs font-semibold px-3 py-1.5 rounded-full shadow-lg whitespace-nowrap">
                    {action.label}
                  </span>
                  <div className={cn('w-11 h-11 rounded-full flex items-center justify-center shadow-lg', action.color)}>
                    <Icon className="w-5 h-5 text-white" />
                  </div>
                </div>
              </Link>
            )
          })}
        </>
      )}

      <button
        onClick={() => setOpen(!open)}
        className={cn(
          'w-14 h-14 rounded-full flex items-center justify-center shadow-xl transition-all duration-200',
          open ? 'bg-gray-700 rotate-45' : 'bg-halqa-700 hover:bg-halqa-800'
        )}
      >
        {open ? <X className="w-6 h-6 text-white" /> : <Plus className="w-6 h-6 text-white" />}
      </button>
    </div>
  )
}
