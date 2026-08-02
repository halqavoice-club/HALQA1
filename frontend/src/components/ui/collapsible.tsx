'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

interface CollapsibleProps {
  title: string
  children: React.ReactNode
  defaultOpen?: boolean
  badge?: string | number
  className?: string
}

export function Collapsible({ title, children, defaultOpen = false, badge, className }: CollapsibleProps) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className={cn('border border-gray-200 rounded-xl overflow-hidden', className)}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-900">{title}</span>
          {badge !== undefined && (
            <span className="text-xs bg-halqa-100 text-halqa-700 px-2 py-0.5 rounded-full font-medium">
              {badge}
            </span>
          )}
        </div>
        <ChevronDown className={cn('w-4 h-4 text-gray-500 transition-transform duration-200', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="p-4 border-t border-gray-100 bg-white">
          {children}
        </div>
      )}
    </div>
  )
}
