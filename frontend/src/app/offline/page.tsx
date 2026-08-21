'use client'

/**
 * /offline — PWA offline fallback page (REQ-14.6)
 *
 * Shown by the service worker when the user is offline and requests
 * a document that is not in the cache. The `fallbacks.document` key
 * in next.config.js points to this route.
 */

import { WifiOff, RefreshCw } from 'lucide-react'

export default function OfflinePage() {
  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-6">
      <div className="text-center max-w-sm">
        {/* Icon */}
        <div className="w-20 h-20 bg-gray-800 rounded-3xl flex items-center justify-center mx-auto mb-6">
          <WifiOff className="w-10 h-10 text-gray-400" />
        </div>

        {/* Heading */}
        <h1 className="text-2xl font-bold text-white mb-2">You&apos;re offline</h1>

        {/* Subtitle */}
        <p className="text-gray-400 text-sm mb-8 leading-relaxed">
          No internet connection detected. Check your network and try again.
        </p>

        {/* Try again button */}
        <button
          onClick={() => window.location.reload()}
          className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-semibold px-6 py-3 rounded-xl transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          Try again
        </button>

        {/* Cached pages hint */}
        <p className="text-gray-600 text-xs mt-6">
          Some pages may still be available if you visited them while online.
        </p>
      </div>
    </div>
  )
}
