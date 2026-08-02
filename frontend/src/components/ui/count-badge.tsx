import { cn } from '@/lib/utils'

interface CountBadgeProps {
  count: number
  max?: number
  color?: 'red' | 'blue' | 'green' | 'yellow' | 'gray'
  size?: 'sm' | 'md'
  className?: string
}

const colorMap = {
  red:    'bg-red-500 text-white',
  blue:   'bg-blue-500 text-white',
  green:  'bg-green-500 text-white',
  yellow: 'bg-yellow-400 text-yellow-900',
  gray:   'bg-gray-200 text-gray-700',
}

export function CountBadge({ count, max = 99, color = 'red', size = 'sm', className }: CountBadgeProps) {
  if (count <= 0) return null
  const display = count > max ? `${max}+` : String(count)
  return (
    <span className={cn(
      'inline-flex items-center justify-center rounded-full font-bold leading-none',
      size === 'sm' ? 'min-w-[18px] h-[18px] text-[10px] px-1' : 'min-w-[22px] h-[22px] text-xs px-1.5',
      colorMap[color],
      className
    )}>
      {display}
    </span>
  )
}
