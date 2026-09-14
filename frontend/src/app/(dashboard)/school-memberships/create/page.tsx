'use client'

/**
 * Create School page
 *
 * Allows any authenticated HALQA user to create a new school.
 * On success, the user automatically becomes the School Admin
 * and gains Education access for that school.
 *
 * Profile fields: name, slug, type, logo, description,
 *                 address, city, state, country,
 *                 phone, email, website, timezone
 */

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/store/auth.store'
import api from '@/lib/api'
import {
  School, Globe, Phone, Mail, MapPin, AlertCircle,
  CheckCircle2, ImagePlus, X, Clock, Building2, Info,
} from 'lucide-react'

const SCHOOL_TYPES = [
  { value: 'school',   label: 'School' },
  { value: 'academy',  label: 'Academy' },
  { value: 'college',  label: 'College' },
  { value: 'daycare',  label: 'Daycare' },
  { value: 'camp',     label: 'Camp' },
  { value: 'sports',   label: 'Sports Club' },
]

const TIMEZONES = [
  { value: 'America/New_York',    label: 'Eastern (UTC-5/-4)' },
  { value: 'America/Chicago',     label: 'Central (UTC-6/-5)' },
  { value: 'America/Denver',      label: 'Mountain (UTC-7/-6)' },
  { value: 'America/Los_Angeles', label: 'Pacific (UTC-8/-7)' },
  { value: 'Europe/London',       label: 'London (UTC+0/+1)' },
  { value: 'Europe/Paris',        label: 'Paris (UTC+1/+2)' },
  { value: 'Asia/Riyadh',         label: 'Riyadh (UTC+3)' },
  { value: 'Asia/Dubai',          label: 'Dubai (UTC+4)' },
  { value: 'Asia/Karachi',        label: 'Karachi (UTC+5)' },
  { value: 'Asia/Dhaka',          label: 'Dhaka (UTC+6)' },
  { value: 'Asia/Kuala_Lumpur',   label: 'Kuala Lumpur (UTC+8)' },
  { value: 'Asia/Jakarta',        label: 'Jakarta (UTC+7)' },
  { value: 'Asia/Tokyo',          label: 'Tokyo (UTC+9)' },
  { value: 'Australia/Sydney',    label: 'Sydney (UTC+10/+11)' },
]

export default function CreateSchoolPage() {
  const router   = useRouter()
  const { fetchMe } = useAuthStore()
  const logoInputRef = useRef<HTMLInputElement>(null)

  const [form, setForm] = useState({
    name:        '',
    slug:        '',
    type:        'school',
    description: '',
    address:     '',
    city:        '',
    state:       '',
    country:     'US',
    phone:       '',
    email:       '',
    website:     '',
    timezone:    'America/New_York',
  })

  const [logoFile,    setLogoFile]    = useState<File | null>(null)
  const [logoPreview, setLogoPreview] = useState<string | null>(null)
  const [loading,     setLoading]     = useState(false)
  const [error,       setError]       = useState<string | null>(null)
  const [success,     setSuccess]     = useState(false)
  const [createdName, setCreatedName] = useState('')

  // Auto-generate slug from name
  function handleNameChange(name: string) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    setForm(prev => ({ ...prev, name, slug }))
  }

  function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setError('Logo must be an image file (JPG, PNG, etc.)')
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      setError('Logo must be smaller than 2 MB')
      return
    }
    setLogoFile(file)
    const reader = new FileReader()
    reader.onload = ev => setLogoPreview(ev.target?.result as string)
    reader.readAsDataURL(file)
    setError(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      // Step 1: Create the school
      const res = await api.post('/school-memberships/create-school', {
        name:        form.name,
        slug:        form.slug,
        type:        form.type,
        address:     form.address  || undefined,
        city:        form.city     || undefined,
        state:       form.state    || undefined,
        country:     form.country  || 'US',
        phone:       form.phone    || undefined,
        email:       form.email    || undefined,
        website:     form.website  || undefined,
        timezone:    form.timezone,
      })

      const schoolId: string = res.data.data?.school?.id

      // Step 2: Upload logo if selected
      if (logoFile && schoolId) {
        const fd = new FormData()
        fd.append('logo', logoFile)
        await api.post(`/schools/${schoolId}/logo`, fd).catch(() => {
          // Non-fatal — school is created, logo upload failed silently
          console.warn('Logo upload failed — school was still created')
        })
      }

      // Step 3: Optionally save description via PATCH (backend createSchool doesn't accept it yet)
      if (form.description.trim() && schoolId) {
        await api.patch(`/schools/${schoolId}`, {
          description: form.description.trim(),
        }).catch(() => {})
      }

      // Refresh the user profile so the new school membership appears in the sidebar
      await fetchMe()

      setCreatedName(form.name)
      setSuccess(true)
      setTimeout(() => router.push('/dashboard'), 2000)
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to create school')
    } finally {
      setLoading(false)
    }
  }

  // ── Success screen ──────────────────────────────────────────────────────────
  if (success) {
    return (
      <div className="max-w-lg mx-auto mt-20 text-center px-4">
        <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <CheckCircle2 className="w-10 h-10 text-green-500" />
        </div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">School Created!</h2>
        <p className="text-gray-500">
          <strong>{createdName}</strong> is ready. You are now the School Admin.
          <br />Redirecting to your dashboard…
        </p>
      </div>
    )
  }

  // ── Form ────────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-2xl mx-auto py-8 px-4">

      {/* Page header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center">
            <School className="w-5 h-5 text-indigo-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Create a School</h1>
        </div>
        <p className="text-gray-500 text-sm pl-13">
          Set up your school profile on HALQA. You&apos;ll become the School Admin and can
          invite teachers, students, and guardians.
        </p>
      </div>

      {error && (
        <div className="mb-6 flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">

        {/* ── 1. School Profile ──────────────────────────────────────────── */}
        <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-5">
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide flex items-center gap-2">
            <Building2 className="w-4 h-4 text-gray-400" /> School Profile
          </h3>

          {/* Logo upload */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              School Logo
              <span className="text-gray-400 font-normal ml-1">(optional · max 2 MB)</span>
            </label>
            <div className="flex items-center gap-4">
              {/* Preview */}
              <div className="w-20 h-20 rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 flex items-center justify-center overflow-hidden flex-shrink-0">
                {logoPreview
                  ? <img src={logoPreview} alt="Logo preview" className="w-full h-full object-contain p-1" />
                  : <School className="w-8 h-8 text-gray-300" />
                }
              </div>

              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => logoInputRef.current?.click()}
                  className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:border-indigo-400 hover:bg-indigo-50 transition-colors"
                >
                  <ImagePlus className="w-4 h-4" />
                  {logoPreview ? 'Change Logo' : 'Upload Logo'}
                </button>
                {logoPreview && (
                  <button
                    type="button"
                    onClick={() => { setLogoFile(null); setLogoPreview(null); if (logoInputRef.current) logoInputRef.current.value = '' }}
                    className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700"
                  >
                    <X className="w-3 h-3" /> Remove
                  </button>
                )}
                <p className="text-xs text-gray-400">JPG, PNG, SVG · square recommended</p>
              </div>
            </div>
            <input
              ref={logoInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleLogoChange}
            />
          </div>

          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              School Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => handleNameChange(e.target.value)}
              required
              placeholder="Halqa Academy"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {/* Slug */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              URL Slug <span className="text-red-500">*</span>
            </label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-400 whitespace-nowrap">halqa.app/</span>
              <input
                type="text"
                value={form.slug}
                onChange={(e) => setForm(prev => ({ ...prev, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }))}
                required
                placeholder="halqa-academy"
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <p className="text-xs text-gray-400 mt-1">Lowercase letters, numbers, hyphens only. Cannot be changed later.</p>
          </div>

          {/* Type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">School Type</label>
            <select
              value={form.type}
              onChange={(e) => setForm(prev => ({ ...prev, type: e.target.value }))}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {SCHOOL_TYPES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          {/* Description / Bio */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              <Info className="inline w-3.5 h-3.5 mr-1 text-gray-400" />
              About / Description
              <span className="text-gray-400 font-normal ml-1">(optional)</span>
            </label>
            <textarea
              value={form.description}
              onChange={(e) => setForm(prev => ({ ...prev, description: e.target.value }))}
              rows={3}
              maxLength={500}
              placeholder="Tell students and parents about your school, its mission, and what makes it special…"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <p className="text-xs text-gray-400 mt-0.5 text-right">{form.description.length}/500</p>
          </div>
        </div>

        {/* ── 2. Location ───────────────────────────────────────────────── */}
        <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide flex items-center gap-2">
            <MapPin className="w-4 h-4 text-gray-400" /> Location
            <span className="text-gray-400 font-normal normal-case text-xs">(optional)</span>
          </h3>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Street Address</label>
            <input
              type="text"
              value={form.address}
              onChange={(e) => setForm(prev => ({ ...prev, address: e.target.value }))}
              placeholder="123 School Street"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">City</label>
              <input
                type="text"
                value={form.city}
                onChange={(e) => setForm(prev => ({ ...prev, city: e.target.value }))}
                placeholder="New York"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">State / Province</label>
              <input
                type="text"
                value={form.state}
                onChange={(e) => setForm(prev => ({ ...prev, state: e.target.value }))}
                placeholder="NY"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Country</label>
              <input
                type="text"
                value={form.country}
                onChange={(e) => setForm(prev => ({ ...prev, country: e.target.value }))}
                placeholder="US"
                maxLength={2}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 uppercase"
              />
            </div>
          </div>
        </div>

        {/* ── 3. Contact & Settings ─────────────────────────────────────── */}
        <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide flex items-center gap-2">
            <Phone className="w-4 h-4 text-gray-400" /> Contact &amp; Settings
            <span className="text-gray-400 font-normal normal-case text-xs">(optional)</span>
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                <Phone className="inline w-3.5 h-3.5 mr-1 text-gray-400" />Phone
              </label>
              <input
                type="tel"
                value={form.phone}
                onChange={(e) => setForm(prev => ({ ...prev, phone: e.target.value }))}
                placeholder="+1 555 000 0000"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                <Mail className="inline w-3.5 h-3.5 mr-1 text-gray-400" />School Email
              </label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm(prev => ({ ...prev, email: e.target.value }))}
                placeholder="info@school.edu"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                <Globe className="inline w-3.5 h-3.5 mr-1 text-gray-400" />Website
              </label>
              <input
                type="url"
                value={form.website}
                onChange={(e) => setForm(prev => ({ ...prev, website: e.target.value }))}
                placeholder="https://school.edu"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          {/* Timezone */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              <Clock className="inline w-3.5 h-3.5 mr-1 text-gray-400" />Timezone
            </label>
            <select
              value={form.timezone}
              onChange={(e) => setForm(prev => ({ ...prev, timezone: e.target.value }))}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {TIMEZONES.map(tz => (
                <option key={tz.value} value={tz.value}>{tz.label}</option>
              ))}
            </select>
            <p className="text-xs text-gray-400 mt-1">Used for scheduling classes, attendance, and notifications.</p>
          </div>
        </div>

        {/* ── Actions ─────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between pt-2">
          <button
            type="button"
            onClick={() => router.back()}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading || !form.name || !form.slug}
            className="px-6 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
          >
            {loading ? (
              <>
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Creating…
              </>
            ) : (
              <>
                <School className="w-4 h-4" />
                Create School
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  )
}
