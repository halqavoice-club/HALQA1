'use client'

/**
 * Offline fallback page — served by the PWA service worker when a document
 * request fails (e.g. no network connection).
 * Required by next-pwa when fallbacks.document is set in next.config.js.
 */
export default function OfflinePage() {
  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="text-center max-w-md">
        <div className="text-6xl mb-6">📡</div>
        <h1 className="text-2xl font-bold text-white mb-2">You&apos;re offline</h1>
        <p className="text-gray-400 mb-6">
          No internet connection detected. Please check your network and try again.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium transition-colors"
        >
          Try again
        </button>
      </div>
    </div>
  )
}
