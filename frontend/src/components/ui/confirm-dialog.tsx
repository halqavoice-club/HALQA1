'use client'

import { AlertTriangle, Loader2 } from 'lucide-react'
import { Button } from './button'

interface ConfirmDialogProps {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'danger' | 'warning' | 'default'
  loading?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  open, title, message,
  confirmLabel = 'Confirm', cancelLabel = 'Cancel',
  variant = 'danger', loading = false,
  onConfirm, onCancel
}: ConfirmDialogProps) {
  if (!open) return null

  const btnClass = {
    danger:  'bg-red-600 hover:bg-red-700 text-white',
    warning: 'bg-yellow-500 hover:bg-yellow-600 text-white',
    default: 'bg-halqa-700 hover:bg-halqa-800 text-white',
  }[variant]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onCancel} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 animate-in fade-in zoom-in-95">
        <div className="flex items-start gap-4">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${variant === 'danger' ? 'bg-red-100' : variant === 'warning' ? 'bg-yellow-100' : 'bg-halqa-100'}`}>
            <AlertTriangle className={`w-5 h-5 ${variant === 'danger' ? 'text-red-600' : variant === 'warning' ? 'text-yellow-600' : 'text-halqa-700'}`} />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-semibold text-gray-900">{title}</h3>
            <p className="text-sm text-gray-500 mt-1">{message}</p>
          </div>
        </div>
        <div className="flex gap-3 mt-6 justify-end">
          <Button variant="outline" onClick={onCancel} disabled={loading}>{cancelLabel}</Button>
          <Button onClick={onConfirm} disabled={loading} className={`gap-2 ${btnClass}`}>
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
