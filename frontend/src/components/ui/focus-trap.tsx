'use client'

import { useEffect, useRef, useCallback } from 'react'
import { useFocusTrap } from '@/hooks/useFocusTrap'

interface FocusTrapProps {
  children: React.ReactNode
  enabled?: boolean
  onEscape?: () => void
}

export function FocusTrap({ children, enabled = true, onEscape }: FocusTrapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const { activate, deactivate } = useFocusTrap(containerRef)

  useEffect(() => {
    if (enabled) {
      activate()
      return () => deactivate()
    }
  }, [enabled, activate, deactivate])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape' && onEscape) {
        onEscape()
      }
    },
    [onEscape]
  )

  return (
    <div ref={containerRef} onKeyDown={handleKeyDown}>
      {children}
    </div>
  )
}
