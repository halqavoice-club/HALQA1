'use client'

import { cn } from '@/lib/utils'

interface TextareaCountProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  maxLength?: number
  showCount?: boolean
  label?: string
  error?: string
}

export function TextareaCount({
  maxLength, showCount = true, label, error, value, onChange, className, ...props
}: TextareaCountProps) {
  const count = typeof value === 'string' ? value.length : 0
  const isNearLimit = maxLength && count >= maxLength * 0.9
  const isAtLimit   = maxLength && count >= maxLength

  return (
    <div className="space-y-1.5">
      {label && <label className="text-sm font-medium text-gray-700">{label}</label>}
      <div className="relative">
        <textarea
          value={value}
          onChange={onChange}
          maxLength={maxLength}
          className={cn(
            'w-full px-3 py-2 rounded-lg border border-input bg-background text-sm resize-none transition-colors',
            'focus:outline-none focus:ring-2 focus:ring-halqa-500 focus:border-transparent',
            'placeholder:text-muted-foreground',
            error && 'border-red-500 focus:ring-red-500',
            showCount && maxLength && 'pb-7',
            className
          )}
          {...props}
        />
        {showCount && maxLength && (
          <div className={cn(
            'absolute bottom-2 right-3 text-xs',
            isAtLimit ? 'text-red-500 font-semibold' :
            isNearLimit ? 'text-orange-500' : 'text-gray-400'
          )}>
            {count}/{maxLength}
          </div>
        )}
      </div>
      {error && <p className="text-xs text-red-500">⚠ {error}</p>}
    </div>
  )
}
