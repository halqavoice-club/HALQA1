import { cn } from '@/lib/utils'
import { LucideIcon } from 'lucide-react'

interface InfoRowProps {
  icon?: LucideIcon
  label: string
  value?: string | number | null
  className?: string
  valueClassName?: string
}

export function InfoRow({ icon: Icon, label, value, className, valueClassName }: InfoRowProps) {
  if (!value && value !== 0) return null
  return (
    <div className={cn('flex items-center gap-2 text-sm', className)}>
      {Icon && <Icon className="w-4 h-4 text-gray-400 flex-shrink-0" />}
      <span className="text-gray-500 flex-shrink-0">{label}:</span>
      <span className={cn('font-medium text-gray-900 truncate', valueClassName)}>{value}</span>
    </div>
  )
}

interface InfoGridProps {
  children: React.ReactNode
  cols?: 1 | 2 | 3 | 4
  className?: string
}

export function InfoGrid({ children, cols = 2, className }: InfoGridProps) {
  return (
    <div className={cn(
      'grid gap-3',
      cols === 1 && 'grid-cols-1',
      cols === 2 && 'grid-cols-1 sm:grid-cols-2',
      cols === 3 && 'grid-cols-1 sm:grid-cols-3',
      cols === 4 && 'grid-cols-2 sm:grid-cols-4',
      className
    )}>
      {children}
    </div>
  )
}
