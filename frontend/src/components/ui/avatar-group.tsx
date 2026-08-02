'use client'

import { cn } from '@/lib/utils'
import { Avatar, AvatarFallback, AvatarImage } from './avatar'

interface AvatarItem {
  id: string
  name: string
  avatarUrl?: string
}

interface AvatarGroupProps {
  items: AvatarItem[]
  max?: number
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const SIZES = { sm: 'w-7 h-7 text-xs', md: 'w-9 h-9 text-sm', lg: 'w-11 h-11 text-base' }
const OVERLAPS = { sm: '-ml-2', md: '-ml-2.5', lg: '-ml-3' }

function getInitials(name: string) {
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
}

const BG_COLORS = [
  'bg-blue-100 text-blue-700', 'bg-green-100 text-green-700',
  'bg-purple-100 text-purple-700', 'bg-orange-100 text-orange-700',
  'bg-pink-100 text-pink-700', 'bg-teal-100 text-teal-700',
]

export function AvatarGroup({ items, max = 4, size = 'md', className }: AvatarGroupProps) {
  const visible = items.slice(0, max)
  const remaining = items.length - max

  return (
    <div className={cn('flex items-center', className)}>
      {visible.map((item, i) => (
        <div key={item.id} className={cn('relative rounded-full ring-2 ring-white', i > 0 && OVERLAPS[size])}>
          <Avatar className={SIZES[size]}>
            <AvatarImage src={item.avatarUrl} />
            <AvatarFallback className={cn('font-semibold', BG_COLORS[i % BG_COLORS.length])}>
              {getInitials(item.name)}
            </AvatarFallback>
          </Avatar>
        </div>
      ))}
      {remaining > 0 && (
        <div className={cn(
          'relative rounded-full ring-2 ring-white flex items-center justify-center bg-gray-100 text-gray-600 font-semibold',
          SIZES[size], OVERLAPS[size]
        )}>
          +{remaining}
        </div>
      )}
    </div>
  )
}
