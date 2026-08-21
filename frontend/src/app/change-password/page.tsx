'use client'

/**
 * Force Change Password page
 *
 * Shown when mustChangePassword = true (admin-created accounts).
 * The user cannot navigate elsewhere until they set a new password.
 * After successful change, mustChangePassword is cleared and the
 * user is redirected to /dashboard.
 *
 * This page is NOT inside (dashboard) so the sidebar is NOT shown —
 * preventing navigation to protected content before the password is set.
 */

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/store/auth.store'
import api from '@/lib/api'
import { Lock, Eye, EyeOff, CheckCircle2, AlertCircle, Shield } from 'lucide-react'

const REQUIREMENTS = [
  { label: 'At least 8 characters',    test: (p: string) => p.length >= 8 },
  { label: 'At least one uppercase',   test: (p: string) => /[A-Z]/.test(p) },
  { label: 'At least one number',      test: (p: string) => /[0-9]/.test(p) },
]

export default function ChangePasswordPage() {
  const router = useRouter()
  const { isAuthenticated, mustChangePassword, logout, user } = useAuthStore()

  const [current,   setCurrent]   = useState('')
  const [newPwd,    setNewPwd]    = useState('')
  const [confirm,   setConfirm]   = useState('')
  const [showCur,   setShowCur]   = useState(false)
  const [showNew,   setShowNew]   = useState(false)
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState<string | null>(null)
  const [success,   setSuccess]   = useState(false)

  // Redirect unauthenticated users to login
  useEffect(() => {
    if (!isAuthenticated) router.replace('/login')
  }, [isAuthenticated, router])

  // If mustChangePassword was already cleared, redirect to dashboard
  useEffect(() => {
    if (isAuthenticated && !mustChangePassword) router.replace('/dashboard')
  }, [isAuthenticated, mustChangePassword, router])

  const allRequirementsMet = REQUIREMENTS.every(r => r.test(newPwd))
  const passwordsMatch = newPwd === confirm && confirm.length > 0

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!allRequirementsMet) return setError('Password does not meet requirements')
    if (!passwordsMatch) return setError('Passwords do not match')

    setLoading(true)
    setError(null)

    try {
      await api.put('/auth/change-password', {
        currentPassword: current,
        newPassword: newPwd,
      })
      // Clear the flag in the store and redirect
      useAuthStore.setState({ mustChangePassword: false })
      setSuccess(true)
      setTimeout(() => router.replace('/dashboard'), 1500)
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to change password. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="text-center">
          <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Password Updated</h2>
          <p className="text-gray-500">Redirecting to dashboard…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-orange-100 rounded-2xl mb-4">
            <Shield className="w-8 h-8 text-orange-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Set Your Password</h1>
          <p className="text-gray-500 mt-2 text-sm">
            Welcome{user?.firstName ? `, ${user.firstName}` : ''}! Your account was created by an admin.
            Please set a personal password before continuing.
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
          {error && (
            <div className="mb-4 flex items-start gap-3 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Current (temporary) password */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Temporary Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type={showCur ? 'text' : 'password'}
                  value={current}
                  onChange={e => setCurrent(e.target.value)}
                  required
                  placeholder="Enter the temporary password given to you"
                  className="w-full pl-9 pr-10 py-2.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <button
                  type="button"
                  onClick={() => setShowCur(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showCur ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* New password */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                New Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type={showNew ? 'text' : 'password'}
                  value={newPwd}
                  onChange={e => setNewPwd(e.target.value)}
                  required
                  placeholder="Choose a strong password"
                  className="w-full pl-9 pr-10 py-2.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <button
                  type="button"
                  onClick={() => setShowNew(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {/* Requirements */}
              {newPwd.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {REQUIREMENTS.map(req => (
                    <li key={req.label} className={`flex items-center gap-2 text-xs ${req.test(newPwd) ? 'text-green-600' : 'text-gray-400'}`}>
                      <CheckCircle2 className={`w-3 h-3 flex-shrink-0 ${req.test(newPwd) ? 'text-green-500' : 'text-gray-300'}`} />
                      {req.label}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Confirm password */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Confirm New Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="password"
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  required
                  placeholder="Re-enter new password"
                  className={`w-full pl-9 pr-3 py-2.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                    confirm.length > 0
                      ? passwordsMatch ? 'border-green-400 bg-green-50/30' : 'border-red-400'
                      : 'border-gray-300'
                  }`}
                />
              </div>
              {confirm.length > 0 && !passwordsMatch && (
                <p className="text-xs text-red-500 mt-1">Passwords do not match</p>
              )}
            </div>

            <button
              type="submit"
              disabled={loading || !allRequirementsMet || !passwordsMatch || !current}
              className="w-full py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            >
              {loading ? (
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <Shield className="w-4 h-4" />
              )}
              {loading ? 'Updating…' : 'Set Password & Continue'}
            </button>
          </form>

          <div className="mt-4 pt-4 border-t border-gray-100 text-center">
            <button
              onClick={logout}
              className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
            >
              Sign out instead
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
