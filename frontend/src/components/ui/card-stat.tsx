import { cn } from '@/lib/utils'
import { LucideIcon } from 'lucide-react'

interface CardStatProps {
  label: string
  value: string | number
  icon?: LucideIcon
  color?: string   // tailwind bg color e.g. 'bg-blue-50 text-blue-700'
  className?: string
  onClick?: () => void
}

export function CardStat({ label, value, icon: Icon, color = 'bg-gray-50 text-gray-700', className, onClick }: CardStatProps) {
  return (
    <div
      onClick={onClick}
      className={cn(
        'rounded-xl p-4 text-center',
        color,
        onClick && 'cursor-pointer hover:opacity-90 transition-opacity',
        className
      )}
    >
      {Icon && <Icon className="w-5 h-5 mx-auto mb-1 opacity-70" />}
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs font-medium mt-0.5 opacity-70">{label}</p>
    </div>
  )
}
