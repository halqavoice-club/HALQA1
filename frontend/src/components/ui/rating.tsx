'use client'

import { useState } from 'react'
import { Star } from 'lucide-react'
import { cn } from '@/lib/utils'

interface RatingProps {
  value: number
  max?: number
  onChange?: (value: number) => void
  readonly?: boolean
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const SIZES = { sm: 'w-4 h-4', md: 'w-5 h-5', lg: 'w-6 h-6' }

export function Rating({ value, max = 5, onChange, readonly = false, size = 'md', className }: RatingProps) {
  const [hovered, setHovered] = useState(0)

  return (
    <div className={cn('flex items-center gap-0.5', className)}>
      {Array.from({ length: max }).map((_, i) => {
        const filled = (hovered || value) > i
        return (
          <button
            key={i}
            type="button"
            disabled={readonly}
            onClick={() => onChange?.(i + 1)}
            onMouseEnter={() => !readonly && setHovered(i + 1)}
            onMouseLeave={() => !readonly && setHovered(0)}
            className={cn(
              'transition-colors',
              readonly ? 'cursor-default' : 'cursor-pointer hover:scale-110 transition-transform'
            )}
          >
            <Star className={cn(
              SIZES[size],
              filled ? 'fill-yellow-400 text-yellow-400' : 'fill-gray-200 text-gray-200'
            )} />
          </button>
        )
      })}
    </div>
  )
}
