'use client'

/**
 * VoiceRoomWithBoundary
 * ─────────────────────────────────────────────────────────────────────────────
 * FE-002: Wraps VoiceRoomView in an ErrorBoundary so that a runtime error
 * (LiveKit crash, undefined participant, gift engine exception) does NOT
 * crash the entire page.
 *
 * The fallback offers:
 *   • "Reconnect" — resets the boundary and re-mounts the voice room
 *   • "Leave Room" — calls onLeave() to trigger the normal leave flow
 *     (marks participant inactive in the DB, emits socket events)
 *
 * Usage: replace VoiceRoomView with VoiceRoomWithBoundary.
 * Props are identical — transparent wrapper.
 */

import React from 'react'
import { VoiceRoomView } from './VoiceRoomView'
import { Mic, RefreshCw, LogOut } from 'lucide-react'

interface Props { onLeave?: () => void }
interface State { hasError: boolean; error?: Error }

class VoiceRoomErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[VoiceRoom] Runtime error caught by boundary:', error.message, info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-gray-950 flex items-center justify-center p-6">
          <div className="text-center max-w-sm">
            <div className="w-16 h-16 bg-red-900/30 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Mic className="w-8 h-8 text-red-400" />
            </div>
            <h2 className="text-xl font-bold text-white mb-2">
              Voice room error
            </h2>
            <p className="text-gray-400 text-sm mb-1">
              Something went wrong in the voice room. Your connection may have been interrupted.
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
              <button
                onClick={() => {
                  // Attempt a clean leave even from the error state
                  this.props.onLeave?.()
                }}
                className="flex items-center gap-2 px-4 py-2 bg-gray-800 text-gray-200 rounded-lg text-sm font-medium hover:bg-gray-700 transition-colors"
              >
                <LogOut className="w-4 h-4" />
                Leave Room
              </button>
            </div>
          </div>
        </div>
      )
    }

    return <VoiceRoomView onLeave={this.props.onLeave} />
  }
}

export { VoiceRoomErrorBoundary as VoiceRoomWithBoundary }
