'use client'

import { useEffect, useRef, useState } from 'react'

export function usePerformance() {
  const [metrics, setMetrics] = useState({
    fcp: 0, // First Contentful Paint
    lcp: 0, // Largest Contentful Paint
    fid: 0, // First Input Delay
    cls: 0, // Cumulative Layout Shift
    ttfb: 0, // Time to First Byte
  })

  useEffect(() => {
    if (typeof window === 'undefined' || !('PerformanceObserver' in window)) return

    // First Contentful Paint
    const fcpObserver = new PerformanceObserver((list) => {
      const entries = list.getEntries()
      const fcp = entries[entries.length - 1] as any
      setMetrics((prev) => ({ ...prev, fcp: fcp.startTime }))
    })
    fcpObserver.observe({ entryTypes: ['paint'] })

    // Largest Contentful Paint
    const lcpObserver = new PerformanceObserver((list) => {
      const entries = list.getEntries()
      const lcp = entries[entries.length - 1] as any
      setMetrics((prev) => ({ ...prev, lcp: lcp.startTime }))
    })
    lcpObserver.observe({ entryTypes: ['largest-contentful-paint'] })

    // First Input Delay
    const fidObserver = new PerformanceObserver((list) => {
      const entries = list.getEntries()
      const fid = entries[0] as any
      setMetrics((prev) => ({ ...prev, fid: fid.processingStart - fid.startTime }))
    })
    fidObserver.observe({ entryTypes: ['first-input'] })

    // Cumulative Layout Shift
    const clsObserver = new PerformanceObserver((list) => {
      let clsValue = 0
      for (const entry of list.getEntries()) {
        clsValue += (entry as any).value
      }
      setMetrics((prev) => ({ ...prev, cls: clsValue }))
    })
    clsObserver.observe({ entryTypes: ['layout-shift'] })

    // Time to First Byte
    const navigationEntries = performance.getEntriesByType('navigation')
    if (navigationEntries.length > 0) {
      const navEntry = navigationEntries[0] as any
      setMetrics((prev) => ({ ...prev, ttfb: navEntry.responseStart }))
    }

    return () => {
      fcpObserver.disconnect()
      lcpObserver.disconnect()
      fidObserver.disconnect()
      clsObserver.disconnect()
    }
  }, [])

  return metrics
}

export function useDebounce<T>(value: T, delay: number = 300): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value)

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value)
    }, delay)

    return () => {
      clearTimeout(handler)
    }
  }, [value, delay])

  return debouncedValue
}

export function useThrottle<T extends (...args: any[]) => any>(
  func: T,
  limit: number = 300
): T {
  const inThrottle = useRef(false)

  return ((...args: any[]) => {
    if (!inThrottle.current) {
      func(...args)
      inThrottle.current = true
      setTimeout(() => (inThrottle.current = false), limit)
    }
  }) as T
}

export function useIdleCallback(callback: () => void, timeout: number = 5000) {
  useEffect(() => {
    if (typeof window === 'undefined' || !('requestIdleCallback' in window)) {
      const timeoutId = setTimeout(callback, timeout)
      return () => clearTimeout(timeoutId)
    }

    const idleId = (window as any).requestIdleCallback(callback, { timeout })
    return () => (window as any).cancelIdleCallback(idleId)
  }, [callback, timeout])
}
