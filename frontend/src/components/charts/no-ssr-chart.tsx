'use client'

import dynamic from 'next/dynamic'
import type { ComponentType } from 'react'

// Wrapper that prevents recharts from rendering on the server
// Usage: <NoSSRChart><YourRechartsComponent /></NoSSRChart>

const NoSSRWrapper = ({ children }: { children: React.ReactNode }) => <>{children}</>

export const NoSSRChart = dynamic(
  () => Promise.resolve(NoSSRWrapper),
  {
    ssr: false,
    loading: () => (
      <div className="w-full bg-gray-100 rounded-lg animate-pulse" style={{ minHeight: 200 }} />
    )
  }
)
