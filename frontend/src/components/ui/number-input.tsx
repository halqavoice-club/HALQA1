'use client'

import { Minus, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'

interface NumberInputProps {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  disabled?: boolean
  className?: string
}

export function NumberInput({ value, onChange, min = 0, max = 999, step = 1, disabled, className }: NumberInputProps) {
  const dec = () => onChange(Math.max(min, value - step))
  const inc = () => onChange(Math.min(max, value + step))

  return (
    <div className={cn('flex items-center border border-input rounded-lg overflow-hidden h-9', className)}>
      <button
        type="button"
        onClick={dec}
        disabled={disabled || value <= min}
        className="px-2.5 h-full hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors border-r border-input"
      >
        <Minus className="w-3.5 h-3.5 text-gray-600" />
      </button>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        onChange={e => {
          const v = parseInt(e.target.value)
          if (!isNaN(v)) onChange(Math.min(max, Math.max(min, v)))
        }}
        className="w-14 text-center text-sm font-medium bg-transparent outline-none disabled:opacity-50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
      />
      <button
        type="button"
        onClick={inc}
        disabled={disabled || value >= max}
        className="px-2.5 h-full hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors border-l border-input"
      >
        <Plus className="w-3.5 h-3.5 text-gray-600" />
      </button>
    </div>
  )
}
