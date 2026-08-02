'use client'

import { cn } from '@/lib/utils'

interface ProgressProps {
  value: number          // 0–100
  max?: number
  label?: string
  showValue?: boolean
  size?: 'sm' | 'md' | 'lg'
  color?: 'default' | 'green' | 'yellow' | 'red' | 'blue'
  className?: string
}

const COLORS = {
  default: 'bg-halqa-600',
  green:   'bg-green-500',
  yellow:  'bg-yellow-400',
  red:     'bg-red-500',
  blue:    'bg-blue-500',
}

const SIZES = { sm: 'h-1.5', md: 'h-2.5', lg: 'h-4' }

export function Progress({
  value, max = 100, label, showValue = false,
  size = 'md', color = 'default', className
}: ProgressProps) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100))

  return (
    <div className={cn('w-full', className)}>
      {(label || showValue) && (
        <div className="flex justify-between items-center mb-1.5">
          {label && <span className="text-xs font-medium text-gray-600">{label}</span>}
          {showValue && <span className="text-xs font-semibold text-gray-700">{Math.round(pct)}%</span>}
        </div>
      )}
      <div className={cn('w-full bg-gray-200 rounded-full overflow-hidden', SIZES[size])}>
        <div
          className={cn('h-full rounded-full transition-all duration-500', COLORS[color])}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

// Circular progress ring
interface CircularProgressProps {
  value: number
  size?: number
  strokeWidth?: number
  color?: string
  label?: string
  className?: string
}

export function CircularProgress({
  value, size = 80, strokeWidth = 8, color = '#1e40af', label, className
}: CircularProgressProps) {
  const r = (size - strokeWidth) / 2
  const circ = 2 * Math.PI * r
  const pct = Math.min(100, Math.max(0, value))
  const offset = circ - (pct / 100) * circ

  return (
    <div className={cn('relative inline-flex items-center justify-center', className)}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e5e7eb" strokeWidth={strokeWidth} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={strokeWidth}
          strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.5s ease' }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-sm font-bold text-gray-900">{Math.round(pct)}%</span>
        {label && <span className="text-[9px] text-gray-500 mt-0.5">{label}</span>}
      </div>
    </div>
  )
}
