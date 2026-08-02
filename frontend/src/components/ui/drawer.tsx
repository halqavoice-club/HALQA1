'use client'

import { useEffect } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface DrawerProps {
  open: boolean
  onClose: () => void
  title?: string
  description?: string
  side?: 'left' | 'right' | 'bottom'
  size?: 'sm' | 'md' | 'lg'
  children: React.ReactNode
  footer?: React.ReactNode
}

const sideMap = {
  right:  { panel: 'right-0 top-0 h-full', enter: 'translate-x-full', active: 'translate-x-0' },
  left:   { panel: 'left-0 top-0 h-full',  enter: '-translate-x-full', active: 'translate-x-0' },
  bottom: { panel: 'bottom-0 left-0 right-0', enter: 'translate-y-full', active: 'translate-y-0' },
}

const widthMap = { sm: 'w-72', md: 'w-96', lg: 'w-[480px]' }

export function Drawer({ open, onClose, title, description, side = 'right', size = 'md', children, footer }: DrawerProps) {
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handler)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  if (!open) return null

  const { panel } = sideMap[side]
  const isBottom = side === 'bottom'

  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className={cn(
        'absolute bg-white shadow-2xl flex flex-col',
        panel,
        isBottom ? 'rounded-t-2xl max-h-[85vh]' : cn('rounded-none', widthMap[size])
      )}>
        {/* Handle for bottom drawer */}
        {isBottom && (
          <div className="flex justify-center pt-3 pb-1">
            <div className="w-10 h-1 bg-gray-300 rounded-full" />
          </div>
        )}

        {/* Header */}
        {(title || description) && (
          <div className="flex items-start justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
            <div>
              {title && <h2 className="text-base font-semibold text-gray-900">{title}</h2>}
              {description && <p className="text-sm text-gray-500 mt-0.5">{description}</p>}
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 ml-4 flex-shrink-0">
              <X className="w-5 h-5" />
            </button>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {/* Footer */}
        {footer && (
          <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100 flex-shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
