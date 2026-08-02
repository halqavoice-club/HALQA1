'use client'

import { useEffect, useRef } from 'react'

interface LiveRegionProps {
  message?: string
  politeness?: 'polite' | 'assertive' | 'off'
  children?: React.ReactNode
}

export function LiveRegion({
  message,
  politeness = 'polite',
  children,
}: LiveRegionProps) {
  const regionRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (message && regionRef.current) {
      regionRef.current.textContent = message
    }
  }, [message])

  return (
    <div
      ref={regionRef}
      role="status"
      aria-live={politeness}
      aria-atomic="true"
      className="sr-only"
    >
      {children}
    </div>
  )
}
