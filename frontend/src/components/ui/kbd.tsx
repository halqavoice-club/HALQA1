'use client'

import { cn } from '@/lib/utils'

interface KbdProps {
  children: React.ReactNode
  className?: string
}

export function Kbd({ children, className }: KbdProps) {
  return (
    <kbd className={cn(
      'inline-flex items-center justify-center px-1.5 py-0.5 text-xs font-mono font-medium',
      'bg-gray-100 text-gray-700 border border-gray-300 rounded shadow-sm',
      className
    )}>
      {children}
    </kbd>
  )
}
