'use client'

import { useAuthStore } from '@/store/auth.store'
import { getDefaultRoute, getRoleInfo } from '@/lib/role-routes'
import { ShieldX, Home, ArrowLeft } from 'lucide-react'
import Link from 'next/link'

export default function AccessDeniedPage() {
  const { user } = useAuthStore()
  const defaultRoute = user ? getDefaultRoute(user.role) : '/dashboard'
  const roleInfo = user ? getRoleInfo(user.role) : null

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-8">
      <div className="text-center max-w-md">
        <div className="w-20 h-20 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-6">
          <ShieldX className="w-10 h-10 text-red-500" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Access Denied</h1>
        <p className="text-gray-500 mb-2">
          You don&apos;t have permission to view this page.
        </p>
        {roleInfo && (
          <p className="text-sm text-gray-400 mb-6">
            Your role <span className={`font-medium px-2 py-0.5 rounded-full text-xs ${roleInfo.color}`}>{roleInfo.label}</span> does not have access to this section.
          </p>
        )}
        <div className="flex gap-3 justify-center">
          <Link href={defaultRoute}
            className="flex items-center gap-2 px-5 py-2.5 bg-halqa-700 text-white rounded-xl text-sm font-semibold hover:bg-halqa-800 transition-colors">
            <Home className="w-4 h-4" /> Go to Dashboard
          </Link>
          <button onClick={() => window.history.back()}
            className="flex items-center gap-2 px-5 py-2.5 border border-gray-200 text-gray-700 rounded-xl text-sm font-semibold hover:bg-gray-50 transition-colors">
            <ArrowLeft className="w-4 h-4" /> Go Back
          </button>
        </div>
      </div>
    </div>
  )
}
