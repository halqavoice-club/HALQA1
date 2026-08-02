'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

interface UseVirtualizationOptions {
  itemHeight: number
  containerHeight: number
  overscan?: number
}

export function useVirtualization<T>(
  items: T[],
  options: UseVirtualizationOptions
) {
  const { itemHeight, containerHeight, overscan = 3 } = options

  const [scrollTop, setScrollTop] = useState(0)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  const totalHeight = items.length * itemHeight
  const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan)
  const endIndex = Math.min(
    items.length - 1,
    Math.floor((scrollTop + containerHeight) / itemHeight) + overscan
  )

  const visibleItems = items.slice(startIndex, endIndex + 1)
  const offsetY = startIndex * itemHeight

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop)
  }, [])

  const scrollToIndex = useCallback(
    (index: number) => {
      if (scrollContainerRef.current) {
        const targetScrollTop = index * itemHeight
        scrollContainerRef.current.scrollTop = targetScrollTop
      }
    },
    [itemHeight]
  )

  return {
    visibleItems,
    totalHeight,
    offsetY,
    startIndex,
    endIndex,
    scrollContainerRef,
    handleScroll,
    scrollToIndex,
  }
}
