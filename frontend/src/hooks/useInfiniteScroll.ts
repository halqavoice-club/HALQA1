'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

interface UseInfiniteScrollOptions {
  threshold?: number
  rootMargin?: string
  enabled?: boolean
}

export function useInfiniteScroll<T>(
  fetchMore: (page: number) => Promise<T[]>,
  options: UseInfiniteScrollOptions = {}
) {
  const {
    threshold = 100,
    rootMargin = '200px',
    enabled = true,
  } = options

  const [data, setData] = useState<T[]>([])
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const observerRef = useRef<IntersectionObserver | null>(null)
  const loadMoreRef = useRef<HTMLDivElement | null>(null)

  const loadMore = useCallback(async () => {
    if (loading || !hasMore || !enabled) return

    setLoading(true)
    setError(null)

    try {
      const newData = await fetchMore(page)
      
      if (newData.length === 0) {
        setHasMore(false)
      } else {
        setData(prev => [...prev, ...newData])
        setPage(prev => prev + 1)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load more data')
    } finally {
      setLoading(false)
    }
  }, [fetchMore, page, loading, hasMore, enabled])

  useEffect(() => {
    if (!enabled) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !loading && hasMore) {
          loadMore()
        }
      },
      {
        rootMargin,
        threshold,
      }
    )

    if (loadMoreRef.current) {
      observer.observe(loadMoreRef.current)
      observerRef.current = observer
    }

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect()
      }
    }
  }, [loadMore, loading, hasMore, enabled, rootMargin, threshold])

  const reset = useCallback(() => {
    setData([])
    setPage(1)
    setLoading(false)
    setHasMore(true)
    setError(null)
  }, [])

  return {
    data,
    loading,
    error,
    hasMore,
    loadMoreRef,
    loadMore,
    reset,
  }
}
