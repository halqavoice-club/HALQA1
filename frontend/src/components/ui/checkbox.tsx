'use client'

import * as React from 'react'
import { Check, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'

interface CheckboxProps {
  checked?: boolean | 'indeterminate'
  onCheckedChange?: (checked: boolean) => void
  disabled?: boolean
  label?: string
  description?: string
  id?: string
  className?: string
}

export function Checkbox({ checked, onCheckedChange, disabled, label, description, id, className }: CheckboxProps) {
  const isIndeterminate = checked === 'indeterminate'
  const isChecked = checked === true

  return (
    <label
      htmlFor={id}
      className={cn(
        'flex items-start gap-3 cursor-pointer group',
        disabled && 'opacity-50 cursor-not-allowed',
        className
      )}
    >
      <div
        role="checkbox"
        aria-checked={isIndeterminate ? 'mixed' : isChecked}
        id={id}
        onClick={() => !disabled && onCheckedChange?.(!isChecked)}
        className={cn(
          'w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 mt-0.5 transition-all',
          isChecked || isIndeterminate
            ? 'bg-halqa-700 border-halqa-700'
            : 'border-gray-300 bg-white group-hover:border-halqa-400'
        )}
      >
        {isIndeterminate && <Minus className="w-3 h-3 text-white" strokeWidth={3} />}
        {isChecked && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
      </div>
      {(label || description) && (
        <div>
          {label && <p className="text-sm font-medium text-gray-900 leading-none">{label}</p>}
          {description && <p className="text-xs text-gray-500 mt-0.5">{description}</p>}
        </div>
      )}
    </label>
  )
}

// Checkbox group
interface CheckboxGroupProps {
  options: { value: string; label: string; description?: string }[]
  value: string[]
  onChange: (value: string[]) => void
  className?: string
}

export function CheckboxGroup({ options, value, onChange, className }: CheckboxGroupProps) {
  const toggle = (v: string) => {
    onChange(value.includes(v) ? value.filter(x => x !== v) : [...value, v])
  }
  return (
    <div className={cn('space-y-2', className)}>
      {options.map(opt => (
        <Checkbox
          key={opt.value}
          id={opt.value}
          checked={value.includes(opt.value)}
          onCheckedChange={() => toggle(opt.value)}
          label={opt.label}
          description={opt.description}
        />
      ))}
    </div>
  )
}
