'use client'

import { cn } from '@/lib/utils'

interface SliderProps {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  disabled?: boolean
  showValue?: boolean
  label?: string
  formatValue?: (v: number) => string
  color?: 'blue' | 'green' | 'red' | 'yellow' | 'halqa'
  className?: string
}

const colorMap = {
  blue:   'accent-blue-600',
  green:  'accent-green-600',
  red:    'accent-red-600',
  yellow: 'accent-yellow-500',
  halqa:  'accent-halqa-700',
}

export function Slider({
  value, onChange, min = 0, max = 100, step = 1,
  disabled, showValue = true, label, formatValue, color = 'halqa', className
}: SliderProps) {
  const pct = ((value - min) / (max - min)) * 100
  const display = formatValue ? formatValue(value) : String(value)

  return (
    <div className={cn('space-y-2', className)}>
      {(label || showValue) && (
        <div className="flex items-center justify-between">
          {label && <span className="text-sm font-medium text-gray-700">{label}</span>}
          {showValue && <span className="text-sm font-bold text-gray-900">{display}</span>}
        </div>
      )}
      <div className="relative">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={e => onChange(Number(e.target.value))}
          className={cn(
            'w-full h-2 rounded-full appearance-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed',
            colorMap[color]
          )}
          style={{
            background: `linear-gradient(to right, currentColor ${pct}%, #e5e7eb ${pct}%)`
          }}
        />
      </div>
      <div className="flex justify-between text-xs text-gray-400">
        <span>{formatValue ? formatValue(min) : min}</span>
        <span>{formatValue ? formatValue(max) : max}</span>
      </div>
    </div>
  )
}
