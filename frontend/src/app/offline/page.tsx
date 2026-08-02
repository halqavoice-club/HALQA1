'use client'

/**
 * Offline fallback page — REQ-14.6
 *
 * Served by the next-pwa service worker when a navigation request fails due to
 * the user being offline. Configured in next.config.js via:
 *   fallbacks: { document: '/offline' }
 */
export default function OfflinePage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="text-center max-w-sm">
        {/* Brand mark */}
        <div className="w-20 h-20 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-lg">
          <span className="text-white text-3xl font-black">H</span>
        </div>

        <h1 className="text-2xl font-black text-gray-900 mb-2">HALQA</h1>

        {/* Offline icon */}
        <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto my-6">
          <svg
            className="w-8 h-8 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M3 3l18 18M8.111 8.111A5.01 5.01 0 006 12c0 1.654.8 3.12 2.033 4.032M12 12v.01M15.889 8.111A5.01 5.01 0 0118 12c0 1.654-.8 3.12-2.033 4.032M12 17.5a2.5 2.5 0 110-5 2.5 2.5 0 010 5z"
            />
          </svg>
        </div>

        <h2 className="text-lg font-bold text-gray-800 mb-2">You're offline</h2>
        <p className="text-sm text-gray-500 mb-8 leading-relaxed">
          It looks like you've lost your internet connection. Check your network settings and try again.
        </p>

        <button
          onClick={() => window.location.reload()}
          className="inline-flex items-center gap-2 px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-semibold text-sm transition-colors shadow-md"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
          Try again
        </button>
      </div>
    </div>
  )
}
