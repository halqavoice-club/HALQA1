'use client'

import { cn } from '@/lib/utils'
import { LucideIcon } from 'lucide-react'
import { Card, CardContent } from './card'

interface StatsCardProps {
  label: string
  value: string | number
  icon: LucideIcon
  iconColor?: string
  iconBg?: string
  trend?: string
  trendUp?: boolean
  className?: string
}

export function StatsCard({
  label, value, icon: Icon, iconColor = 'text-white',
  iconBg = 'bg-halqa-600', trend, trendUp, className
}: StatsCardProps) {
  return (
    <Card className={cn('border-0 shadow-sm hover:shadow-md transition-shadow', className)}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-gray-500 font-medium">{label}</p>
            <p className="text-3xl font-bold text-gray-900 mt-1">{value}</p>
            {trend && (
              <p className={cn('text-xs mt-1 flex items-center gap-1', trendUp ? 'text-green-600' : 'text-red-500')}>
                {trendUp ? '↑' : '↓'} {trend}
              </p>
            )}
          </div>
          <div className={cn('p-3 rounded-xl', iconBg)}>
            <Icon className={cn('w-5 h-5', iconColor)} />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
