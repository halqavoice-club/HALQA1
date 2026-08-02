'use client'

import { cn } from '@/lib/utils'

interface RadioOption {
  value: string
  label: string
  description?: string
  disabled?: boolean
}

interface RadioGroupProps {
  options: RadioOption[]
  value: string
  onChange: (value: string) => void
  orientation?: 'vertical' | 'horizontal'
  className?: string
}

export function RadioGroup({ options, value, onChange, orientation = 'vertical', className }: RadioGroupProps) {
  return (
    <div className={cn(
      'flex gap-3',
      orientation === 'vertical' ? 'flex-col' : 'flex-row flex-wrap',
      className
    )}>
      {options.map(opt => (
        <label
          key={opt.value}
          className={cn(
            'flex items-start gap-3 cursor-pointer group',
            opt.disabled && 'opacity-50 cursor-not-allowed'
          )}
        >
          <div
            role="radio"
            aria-checked={value === opt.value}
            onClick={() => !opt.disabled && onChange(opt.value)}
            className={cn(
              'w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5 transition-all',
              value === opt.value
                ? 'border-halqa-700'
                : 'border-gray-300 group-hover:border-halqa-400'
            )}
          >
            {value === opt.value && (
              <div className="w-2.5 h-2.5 rounded-full bg-halqa-700" />
            )}
          </div>
          <div>
            <p className="text-sm font-medium text-gray-900 leading-none">{opt.label}</p>
            {opt.description && <p className="text-xs text-gray-500 mt-0.5">{opt.description}</p>}
          </div>
        </label>
      ))}
    </div>
  )
}

// Card-style radio group
interface RadioCardGroupProps {
  options: { value: string; label: string; description?: string; icon?: React.ElementType }[]
  value: string
  onChange: (value: string) => void
  cols?: 2 | 3 | 4
  className?: string
}

export function RadioCardGroup({ options, value, onChange, cols = 2, className }: RadioCardGroupProps) {
  return (
    <div className={cn(
      'grid gap-3',
      cols === 2 && 'grid-cols-2',
      cols === 3 && 'grid-cols-3',
      cols === 4 && 'grid-cols-4',
      className
    )}>
      {options.map(opt => {
        const Icon = opt.icon
        const selected = value === opt.value
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cn(
              'flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all text-center',
              selected
                ? 'border-halqa-600 bg-halqa-50'
                : 'border-gray-200 hover:border-halqa-300 hover:bg-gray-50'
            )}
          >
            {Icon && <Icon className={cn('w-5 h-5', selected ? 'text-halqa-700' : 'text-gray-500')} />}
            <p className={cn('text-sm font-medium', selected ? 'text-halqa-700' : 'text-gray-700')}>{opt.label}</p>
            {opt.description && <p className="text-xs text-gray-400">{opt.description}</p>}
          </button>
        )
      })}
    </div>
  )
}
