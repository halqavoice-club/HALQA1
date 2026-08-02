'use client'

import { AlertTriangle, Info, CheckCircle, XCircle } from 'lucide-react'
import { Button } from './button'
import { cn } from '@/lib/utils'

type AlertDialogVariant = 'danger' | 'warning' | 'info' | 'success'

interface AlertDialogProps {
  open: boolean
  title: string
  message: string
  variant?: AlertDialogVariant
  confirmLabel?: string
  cancelLabel?: string
  loading?: boolean
  onConfirm: () => void
  onCancel: () => void
}

const variantConfig = {
  danger:  { icon: XCircle,        iconColor: 'text-red-500',    iconBg: 'bg-red-50',    confirmClass: 'bg-red-600 hover:bg-red-700 text-white' },
  warning: { icon: AlertTriangle,  iconColor: 'text-yellow-500', iconBg: 'bg-yellow-50', confirmClass: 'bg-yellow-500 hover:bg-yellow-600 text-white' },
  info:    { icon: Info,           iconColor: 'text-blue-500',   iconBg: 'bg-blue-50',   confirmClass: 'bg-blue-600 hover:bg-blue-700 text-white' },
  success: { icon: CheckCircle,    iconColor: 'text-green-500',  iconBg: 'bg-green-50',  confirmClass: 'bg-green-600 hover:bg-green-700 text-white' },
}

export function AlertDialog({
  open, title, message, variant = 'danger',
  confirmLabel = 'Confirm', cancelLabel = 'Cancel',
  loading, onConfirm, onCancel
}: AlertDialogProps) {
  if (!open) return null

  const { icon: Icon, iconColor, iconBg, confirmClass } = variantConfig[variant]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onCancel} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 animate-fade-in">
        {/* Icon */}
        <div className={cn('w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4', iconBg)}>
          <Icon className={cn('w-6 h-6', iconColor)} />
        </div>

        {/* Content */}
        <h3 className="text-lg font-semibold text-gray-900 text-center">{title}</h3>
        <p className="text-sm text-gray-500 text-center mt-2 leading-relaxed">{message}</p>

        {/* Actions */}
        <div className="flex gap-3 mt-6">
          <Button
            variant="outline"
            className="flex-1"
            onClick={onCancel}
            disabled={loading}
          >
            {cancelLabel}
          </Button>
          <Button
            className={cn('flex-1', confirmClass)}
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Loading...
              </span>
            ) : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
