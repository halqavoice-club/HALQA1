'use client'

import { useState } from 'react'
import { Calendar, X } from 'lucide-react'
import { format } from 'date-fns'
import { cn } from '@/lib/utils'

interface DatePickerProps {
  value?: string        // ISO date string YYYY-MM-DD
  onChange: (value: string) => void
  placeholder?: string
  min?: string
  max?: string
  disabled?: boolean
  className?: string
  label?: string
}

export function DatePicker({
  value, onChange, placeholder = 'Select date',
  min, max, disabled = false, className, label
}: DatePickerProps) {
  const displayValue = value ? format(new Date(value + 'T00:00:00'), 'MMM d, yyyy') : ''

  return (
    <div className={cn('relative', className)}>
      {label && <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>}
      <div className="relative">
        <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
        <input
          type="date"
          value={value || ''}
          min={min}
          max={max}
          disabled={disabled}
          onChange={e => onChange(e.target.value)}
          className={cn(
            'flex h-10 w-full rounded-md border border-input bg-background pl-9 pr-9 py-2 text-sm',
            'ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            'disabled:cursor-not-allowed disabled:opacity-50',
            !value && 'text-muted-foreground'
          )}
        />
        {value && !disabled && (
          <button
            onClick={() => onChange('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}

interface DateRangePickerProps {
  startDate?: string
  endDate?: string
  onStartChange: (v: string) => void
  onEndChange: (v: string) => void
  className?: string
}

export function DateRangePicker({ startDate, endDate, onStartChange, onEndChange, className }: DateRangePickerProps) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <DatePicker value={startDate} onChange={onStartChange} placeholder="Start date" max={endDate} />
      <span className="text-gray-400 text-sm flex-shrink-0">to</span>
      <DatePicker value={endDate} onChange={onEndChange} placeholder="End date" min={startDate} />
    </div>
  )
}
