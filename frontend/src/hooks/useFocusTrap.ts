'use client'

import { useEffect, useRef, useCallback } from 'react'

export function useFocusTrap(containerRef: React.RefObject<HTMLElement | null>) {
  const previousActiveElement = useRef<HTMLElement | null>(null)

  const activate = useCallback(() => {
    if (typeof document === 'undefined') return

    previousActiveElement.current = document.activeElement as HTMLElement

    const container = containerRef.current
    if (!container) return

    const focusableElements = container.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )
    const firstElement = focusableElements[0] as HTMLElement
    const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement

    if (firstElement) {
      firstElement.focus()
    }

    const handleTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return

      if (e.shiftKey) {
        if (document.activeElement === firstElement) {
          e.preventDefault()
          lastElement.focus()
        }
      } else {
        if (document.activeElement === lastElement) {
          e.preventDefault()
          firstElement.focus()
        }
      }
    }

    container.addEventListener('keydown', handleTab)

    return () => {
      container.removeEventListener('keydown', handleTab)
    }
  }, [containerRef])

  const deactivate = useCallback(() => {
    if (previousActiveElement.current) {
      previousActiveElement.current.focus()
    }
  }, [])

  return { activate, deactivate }
}

