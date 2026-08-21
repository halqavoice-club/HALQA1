'use client'

/**
 * Join School page
 *
 * Allows any authenticated HALQA user to find and request membership
 * in an existing school. The request starts as PENDING until a school
 * admin approves it.
 *
 * Social platform access is completely unaffected by joining a school.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/store/auth.store'
import api from '@/lib/api'
import {
  Search, School, GraduationCap, Users, UserCheck,
  AlertCircle, CheckCircle2, ArrowRight, Loader2
} from 'lucide-react'

type SchoolResult = {
  id: string
  name: string
  slug: string
  type: string
  city: string | null
  country: string
  logoUrl: string | null
}

const ROLE_OPTIONS = [
  { value: 'STUDENT',  label: 'Student',          icon: GraduationCap, description: 'Enroll as a student — requires admin approval' },
  { value: 'TEACHER',  label: 'Teacher',           icon: UserCheck,     description: 'Join as a teacher — requires admin approval' },
  { value: 'GUARDIAN', label: 'Guardian / Parent', icon: Users,         description: 'Monitor a student as their guardian — requires admin approval' },
]

export default function JoinSchoolPage() {
  const router = useRouter()
  const { fetchMe } = useAuthStore()

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SchoolResult[]>([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState<SchoolResult | null>(null)
  const [role, setRole] = useState('STUDENT')
  const [joining, setJoining] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    if (!query.trim()) return
    setSearching(true)
    setResults([])
    setError(null)
    try {
      const res = await api.get(`/schools/search?search=${encodeURIComponent(query)}&limit=10`)
      setResults(res.data.data || [])
    } catch {
      setError('Search failed. Please try again.')
    } finally {
      setSearching(false)
    }
  }

  async function handleJoin() {
    if (!selected) return
    setJoining(true)
    setError(null)
    try {
      await api.post('/school-memberships/join', { schoolId: selected.id, role })
      await fetchMe()
      const roleLabel = role === 'STUDENT' ? 'Student' : role === 'TEACHER' ? 'Teacher' : 'Guardian'
      setSuccess(
        `Join request sent to ${selected.name} as ${roleLabel}. Awaiting admin approval.`
      )
      setTimeout(() => router.push('/dashboard'), 2000)
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to join school')
    } finally {
      setJoining(false)
    }
  }

  if (success) {
    return (
      <div className="max-w-lg mx-auto mt-20 text-center px-4">
        <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto mb-4" />
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Request Sent!</h2>
        <p className="text-gray-500">{success}</p>
        <p className="text-sm text-gray-400 mt-2">Redirecting to dashboard…</p>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto py-8 px-4">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
            <School className="w-5 h-5 text-blue-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Join a School</h1>
        </div>
        <p className="text-gray-500 text-sm">
          Search for a school and send a membership request. Your Social platform access
          remains unchanged — school membership only adds Education features.
        </p>
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Step 1 — Search */}
      {!selected && (
        <div className="space-y-4">
          <form onSubmit={handleSearch} className="flex gap-2">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by school name or slug…"
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <button
              type="submit"
              disabled={searching || !query.trim()}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center gap-2"
            >
              {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              Search
            </button>
          </form>

          {results.length > 0 && (
            <div className="space-y-2">
              {results.map(school => (
                <button
                  key={school.id}
                  onClick={() => setSelected(school)}
                  className="w-full flex items-center gap-3 p-4 bg-white border border-gray-200 rounded-xl hover:border-blue-400 hover:bg-blue-50/30 transition-all text-left group"
                >
                  <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center flex-shrink-0">
                    {school.logoUrl
                      ? <img src={school.logoUrl} alt="" className="w-8 h-8 rounded object-contain" />
                      : <School className="w-5 h-5 text-gray-400" />
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 truncate">{school.name}</p>
                    <p className="text-xs text-gray-500 capitalize">
                      {school.type} · {school.city ? `${school.city}, ` : ''}{school.country}
                    </p>
                  </div>
                  <ArrowRight className="w-4 h-4 text-gray-400 group-hover:text-blue-500 flex-shrink-0 transition-colors" />
                </button>
              ))}
            </div>
          )}

          {results.length === 0 && query && !searching && (
            <p className="text-center text-gray-500 text-sm py-8">
              No schools found for &ldquo;{query}&rdquo;
            </p>
          )}
        </div>
      )}

      {/* Step 2 — Select Role */}
      {selected && (
        <div className="space-y-6">
          <div className="flex items-center gap-3 p-4 bg-blue-50 border border-blue-200 rounded-xl">
            <div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center flex-shrink-0 border border-blue-200">
              {selected.logoUrl
                ? <img src={selected.logoUrl} alt="" className="w-8 h-8 rounded object-contain" />
                : <School className="w-5 h-5 text-blue-500" />
              }
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-gray-900">{selected.name}</p>
              <p className="text-xs text-blue-600 capitalize">{selected.type}</p>
            </div>
            <button
              onClick={() => setSelected(null)}
              className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1 rounded"
            >
              Change
            </button>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-3">How are you joining?</h3>
            <div className="space-y-2">
              {ROLE_OPTIONS.map(option => {
                const Icon = option.icon
                return (
                  <label
                    key={option.value}
                    className={`flex items-center gap-3 p-4 rounded-xl border-2 cursor-pointer transition-all ${
                      role === option.value
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <input
                      type="radio"
                      name="role"
                      value={option.value}
                      checked={role === option.value}
                      onChange={() => setRole(option.value)}
                      className="sr-only"
                    />
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                      role === option.value ? 'bg-blue-100' : 'bg-gray-100'
                    }`}>
                      <Icon className={`w-4 h-4 ${role === option.value ? 'text-blue-600' : 'text-gray-500'}`} />
                    </div>
                    <div>
                      <p className="font-medium text-gray-900 text-sm">{option.label}</p>
                      <p className="text-xs text-gray-500">{option.description}</p>
                    </div>
                    <div className={`ml-auto w-4 h-4 rounded-full border-2 flex-shrink-0 ${
                      role === option.value ? 'border-blue-500 bg-blue-500' : 'border-gray-300'
                    }`}>
                      {role === option.value && (
                        <div className="w-full h-full rounded-full bg-white scale-[0.4]" />
                      )}
                    </div>
                  </label>
                )
              })}
            </div>
          </div>

          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={() => router.back()}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleJoin}
              disabled={joining}
              className="px-6 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
            >
              {joining ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Sending Request…
                </>
              ) : (
                <>
                  <ArrowRight className="w-4 h-4" />
                  Send Join Request
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Link to create instead */}
      <div className="mt-8 pt-6 border-t border-gray-100 text-center">
        <p className="text-sm text-gray-500">
          Don&apos;t see your school?{' '}
          <a href="/school-memberships/create" className="text-indigo-600 hover:underline font-medium">
            Create a new school
          </a>
        </p>
      </div>
    </div>
  )
}
