'use client'

import { cn } from '@/lib/utils'
import { LucideIcon } from 'lucide-react'

interface SectionHeaderProps {
  title: string
  description?: string
  icon?: LucideIcon
  iconColor?: string
  action?: React.ReactNode
  className?: string
}

export function SectionHeader({ title, description, icon: Icon, iconColor = 'text-halqa-700', action, className }: SectionHeaderProps) {
  return (
    <div className={cn('flex items-start justify-between gap-4', className)}>
      <div className="flex items-center gap-3 min-w-0">
        {Icon && (
          <div className="w-10 h-10 bg-halqa-50 rounded-xl flex items-center justify-center flex-shrink-0">
            <Icon className={cn('w-5 h-5', iconColor)} />
          </div>
        )}
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-gray-900 truncate">{title}</h1>
          {description && <p className="text-sm text-gray-500 mt-0.5">{description}</p>}
        </div>
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  )
}
