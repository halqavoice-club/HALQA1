'use client'

import Link from 'next/link'
import { BookOpen, Home, ArrowLeft } from 'lucide-react'

export default function NotFound() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-halqa-900 via-halqa-800 to-halqa-700 flex items-center justify-center p-4">
      <div className="text-center max-w-md">
        <div className="inline-flex items-center justify-center w-20 h-20 bg-white/10 rounded-2xl mb-6 backdrop-blur-sm">
          <BookOpen className="w-10 h-10 text-white" />
        </div>
        <h1 className="text-8xl font-bold text-white/20 mb-2">404</h1>
        <h2 className="text-2xl font-bold text-white mb-3">Page Not Found</h2>
        <p className="text-halqa-200 mb-8">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <div className="flex gap-3 justify-center">
          <Link
            href="/dashboard"
            className="flex items-center gap-2 px-6 py-3 bg-white text-halqa-700 rounded-xl font-semibold hover:bg-halqa-50 transition-colors"
          >
            <Home className="w-4 h-4" /> Go to Dashboard
          </Link>
          <button
            onClick={() => window.history.back()}
            className="flex items-center gap-2 px-6 py-3 bg-white/10 text-white rounded-xl font-semibold hover:bg-white/20 transition-colors backdrop-blur-sm"
          >
            <ArrowLeft className="w-4 h-4" /> Go Back
          </button>
        </div>
      </div>
    </div>
  )
}
