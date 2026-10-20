'use client'

/**
 * LiveClassRoomWithBoundary
 * ─────────────────────────────────────────────────────────────────────────────
 * FE-002: Wraps LiveClassRoomPage in an ErrorBoundary so that a runtime error
 * (LiveKit SDK crash, undefined participant, network state exception) does NOT
 * crash the entire page — it renders a recovery UI instead.
 *
 * The fallback offers:
 *   • "Reconnect" — resets the boundary and re-mounts the live class
 *   • "Leave" — navigates back to the live classes list
 *
 * Usage: import LiveClassRoomWithBoundary wherever LiveClassRoomPage was used.
 * The props are identical — this is a transparent wrapper.
 */

import React from 'react'
import { LiveClassRoomPage } from './LiveClassRoomImpl'
import { Radio, RefreshCw, LogOut } from 'lucide-react'

interface State { hasError: boolean; error?: Error }

class LiveClassErrorBoundary extends React.Component<
  { id: string },
  State
> {
  constructor(props: { id: string }) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Log to console in dev; in production this should go to your error
    // tracking service (Sentry, Datadog, etc.)
    console.error('[LiveClass] Runtime error caught by boundary:', error.message, info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-gray-950 flex items-center justify-center p-6">
          <div className="text-center max-w-sm">
            <div className="w-16 h-16 bg-red-900/30 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Radio className="w-8 h-8 text-red-400" />
            </div>
            <h2 className="text-xl font-bold text-white mb-2">
              Live class error
            </h2>
            <p className="text-gray-400 text-sm mb-1">
              An unexpected error occurred during the live session.
            </p>
            {process.env.NODE_ENV === 'development' && this.state.error && (
              <pre className="text-xs text-left bg-gray-900 rounded-lg p-3 mb-4 overflow-auto max-h-28 text-red-400">
                {this.state.error.message}
              </pre>
            )}
            <div className="flex gap-3 justify-center mt-6">
              <button
                onClick={() => this.setState({ hasError: false, error: undefined })}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                Reconnect
              </button>
              <a
                href="/live-class"
                className="flex items-center gap-2 px-4 py-2 bg-gray-800 text-gray-200 rounded-lg text-sm font-medium hover:bg-gray-700 transition-colors"
              >
                <LogOut className="w-4 h-4" />
                Leave
              </a>
            </div>
          </div>
        </div>
      )
    }

    return <LiveClassRoomPage id={this.props.id} />
  }
}

export { LiveClassErrorBoundary as LiveClassRoomWithBoundary }
