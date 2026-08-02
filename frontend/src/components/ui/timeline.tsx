'use client'

import { cn } from '@/lib/utils'
import { LucideIcon } from 'lucide-react'

interface TimelineItem {
  id: string
  title: string
  description?: string
  time?: string
  icon?: LucideIcon
  iconBg?: string
  iconColor?: string
}

interface TimelineProps {
  items: TimelineItem[]
  className?: string
}

export function Timeline({ items, className }: TimelineProps) {
  return (
    <div className={cn('space-y-0', className)}>
      {items.map((item, i) => {
        const Icon = item.icon
        const isLast = i === items.length - 1
        return (
          <div key={item.id} className="flex gap-3">
            {/* Icon + line */}
            <div className="flex flex-col items-center">
              <div className={cn(
                'w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 z-10',
                item.iconBg || 'bg-halqa-100'
              )}>
                {Icon
                  ? <Icon className={cn('w-4 h-4', item.iconColor || 'text-halqa-700')} />
                  : <div className={cn('w-2.5 h-2.5 rounded-full', item.iconColor || 'bg-halqa-500')} />
                }
              </div>
              {!isLast && <div className="w-0.5 flex-1 bg-gray-200 my-1" />}
            </div>
            {/* Content */}
            <div className={cn('flex-1 pb-4', isLast && 'pb-0')}>
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold text-gray-900">{item.title}</p>
                {item.time && <span className="text-xs text-gray-400 flex-shrink-0">{item.time}</span>}
              </div>
              {item.description && (
                <p className="text-xs text-gray-500 mt-0.5">{item.description}</p>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
