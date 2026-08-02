'use client'

import { cn } from '@/lib/utils'
import { CheckCircle, AlertTriangle, XCircle, Info, X } from 'lucide-react'
import { useState } from 'react'

type AlertVariant = 'info' | 'success' | 'warning' | 'error'

interface AlertProps {
  variant?: AlertVariant
  title?: string
  children: React.ReactNode
  dismissible?: boolean
  className?: string
}

const STYLES: Record<AlertVariant, { bg: string; border: string; icon: React.ElementType; iconColor: string; titleColor: string; textColor: string }> = {
  info:    { bg: 'bg-blue-50',   border: 'border-blue-200',  icon: Info,          iconColor: 'text-blue-500',  titleColor: 'text-blue-800',  textColor: 'text-blue-700' },
  success: { bg: 'bg-green-50',  border: 'border-green-200', icon: CheckCircle,   iconColor: 'text-green-500', titleColor: 'text-green-800', textColor: 'text-green-700' },
  warning: { bg: 'bg-yellow-50', border: 'border-yellow-200',icon: AlertTriangle, iconColor: 'text-yellow-500',titleColor: 'text-yellow-800',textColor: 'text-yellow-700' },
  error:   { bg: 'bg-red-50',    border: 'border-red-200',   icon: XCircle,       iconColor: 'text-red-500',   titleColor: 'text-red-800',   textColor: 'text-red-700' },
}

export function Alert({ variant = 'info', title, children, dismissible = false, className }: AlertProps) {
  const [dismissed, setDismissed] = useState(false)
  if (dismissed) return null

  const s = STYLES[variant]
  const Icon = s.icon

  return (
    <div className={cn('flex gap-3 p-4 rounded-xl border', s.bg, s.border, className)}>
      <Icon className={cn('w-5 h-5 flex-shrink-0 mt-0.5', s.iconColor)} />
      <div className="flex-1 min-w-0">
        {title && <p className={cn('text-sm font-semibold', s.titleColor)}>{title}</p>}
        <div className={cn('text-sm', title ? 'mt-0.5' : '', s.textColor)}>{children}</div>
      </div>
      {dismissible && (
        <button onClick={() => setDismissed(true)} className={cn('flex-shrink-0 hover:opacity-70 transition-opacity', s.iconColor)}>
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  )
}
