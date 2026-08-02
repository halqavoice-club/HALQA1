'use client'

import { cn } from '@/lib/utils'
import { Label } from './label'

interface FormFieldProps {
  label?: string
  error?: string
  hint?: string
  required?: boolean
  className?: string
  children: React.ReactNode
}

export function FormField({ label, error, hint, required, className, children }: FormFieldProps) {
  return (
    <div className={cn('space-y-1.5', className)}>
      {label && (
        <Label className="text-sm font-medium text-gray-700">
          {label}
          {required && <span className="text-red-500 ml-0.5">*</span>}
        </Label>
      )}
      {children}
      {hint && !error && <p className="text-xs text-gray-400">{hint}</p>}
      {error && <p className="text-xs text-red-500 flex items-center gap-1">⚠ {error}</p>}
    </div>
  )
}
