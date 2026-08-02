'use client'

import { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'
import { useToast } from '@/components/ui/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import {
  ArrowLeft, School, Users, GraduationCap, BookOpen,
  UserCheck, Settings, Globe, Mail, Phone, MapPin,
  Loader2, Save, Trash2, ToggleLeft, ToggleRight,
  BarChart3, AlertTriangle,
} from 'lucide-react'
import Link from 'next/link'

const SCHOOL_TYPES = ['school', 'academy', 'college', 'daycare', 'camp', 'sports']

interface SchoolData {
  id:        string
  name:      string
  slug:      string
  type:      string
  email:     string | null
  phone:     string | null
  address:   string | null
  city:      string | null
  country:   string | null
  isActive:  boolean
  logoUrl:   string | null
  createdAt: string
  settings:  Record<string, any> | null
}

interface Stats {
  students:  number
  teachers:  number
  classes:   number
  guardians: number
}

// ─── Stat card ────────────────────────────────────────────────────────────────
function StatCard({ icon, label, value, href, color }: {
  icon: React.ReactNode; label: string; value: number
  href?: string; color: string
}) {
  const content = (
    <div className={cn('bg-white rounded-2xl border border-gray-100 p-4 shadow-sm hover:shadow-md transition-all', href && 'cursor-pointer')}>
      <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center mb-3', color)}>
        {icon}
      </div>
      <p className="text-2xl font-black text-gray-900">{value.toLocaleString()}</p>
      <p className="text-xs text-gray-500 font-medium mt-0.5">{label}</p>
    </div>
  )
  return href
    ? <Link href={href}>{content}</Link>
    : <div>{content}</div>
}

// ─── Section wrapper ──────────────────────────────────────────────────────────
function Section({ title, icon, children }: {
  title: string; icon: React.ReactNode; children: React.ReactNode
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
      <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-50">
        <span className="text-gray-400">{icon}</span>
        <h2 className="text-sm font-bold text-gray-700">{title}</h2>
      </div>
      <div className="p-5">{children}</div>
    </div>
  )
}

// ─── Toggle setting row ───────────────────────────────────────────────────────
function SettingToggle({ label, description, value, onChange }: {
  label: string; description: string; value: boolean; onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-gray-50 last:border-0">
      <div>
        <p className="text-sm font-medium text-gray-800">{label}</p>
        <p className="text-xs text-gray-400">{description}</p>
      </div>
      <button
        onClick={() => onChange(!value)}
        className={cn(
          'relative w-10 h-6 rounded-full transition-colors',
          value ? 'bg-indigo-600' : 'bg-gray-200'
        )}
      >
        <span className={cn(
          'absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform',
          value ? 'left-5' : 'left-1'
        )} />
      </button>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function SchoolManagePage() {
  const { id }      = useParams<{ id: string }>()
  const router      = useRouter()
  const { toast }   = useToast()
  const queryClient = useQueryClient()

  const [tab, setTab] = useState<'overview' | 'settings' | 'danger'>('overview')
  const [editForm, setEditForm] = useState<Partial<SchoolData>>({})
  const [isDirty, setIsDirty]   = useState(false)

  // Fetch school
  const { data: school, isLoading } = useQuery<SchoolData>({
    queryKey: ['school', id],
    queryFn:  () => api.get(`/schools/${id}`).then(r => r.data.data),
    enabled:  !!id,
    onSuccess: (d: SchoolData) => setEditForm(d),
  } as any)

  // Fetch stats
  const { data: stats } = useQuery<Stats>({
    queryKey: ['school-stats', id],
    queryFn:  () => api.get(`/schools/${id}/stats`).then(r => r.data.data),
    enabled:  !!id,
  })

  // Update school
  const updateMutation = useMutation({
    mutationFn: (data: Partial<SchoolData>) => api.patch(`/schools/${id}`, data),
    onSuccess: () => {
      toast({ title: 'School updated' })
      setIsDirty(false)
      queryClient.invalidateQueries({ queryKey: ['school', id] })
      queryClient.invalidateQueries({ queryKey: ['schools'] })
    },
    onError: (e: any) => toast({ title: e?.response?.data?.message || 'Update failed', variant: 'destructive' }),
  })

  // Toggle active
  const toggleActive = useMutation({
    mutationFn: () => api.patch(`/schools/${id}`, { isActive: !school?.isActive }),
    onSuccess: () => {
      toast({ title: school?.isActive ? 'School deactivated' : 'School activated' })
      queryClient.invalidateQueries({ queryKey: ['school', id] })
      queryClient.invalidateQueries({ queryKey: ['schools'] })
    },
  })

  // Delete school
  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/schools/${id}`),
    onSuccess: () => {
      toast({ title: 'School deleted' })
      router.push('/schools')
    },
    onError: (e: any) => toast({ title: e?.response?.data?.message || 'Delete failed', variant: 'destructive' }),
  })

  const setField = <K extends keyof SchoolData>(key: K, value: SchoolData[K]) => {
    setEditForm(f => ({ ...f, [key]: value }))
    setIsDirty(true)
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-7 h-7 animate-spin text-indigo-400" />
      </div>
    )
  }

  if (!school) {
    return (
      <div className="text-center py-20 text-gray-400">
        <School className="w-12 h-12 mx-auto mb-3 opacity-30" />
        <p>School not found</p>
        <Link href="/schools" className="mt-2 inline-block text-sm text-indigo-600 hover:underline">
          ← Back to Schools
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-5 max-w-3xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link href="/schools" className="p-2 rounded-xl hover:bg-gray-100 transition-colors">
            <ArrowLeft className="w-5 h-5 text-gray-500" />
          </Link>
          <div className="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center">
            <School className="w-5 h-5 text-indigo-600" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-gray-900">{school.name}</h1>
              <Badge variant={school.isActive ? 'default' : 'secondary'} className="text-xs">
                {school.isActive ? 'Active' : 'Inactive'}
              </Badge>
            </div>
            <p className="text-sm text-gray-400 capitalize">
              {school.type} · {school.slug}
              {school.city ? ` · ${school.city}` : ''}
            </p>
          </div>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard
            icon={<GraduationCap className="w-5 h-5 text-indigo-600" />}
            label="Students" value={stats.students}
            href="/students" color="bg-indigo-50"
          />
          <StatCard
            icon={<UserCheck className="w-5 h-5 text-emerald-600" />}
            label="Teachers" value={stats.teachers}
            href="/teachers" color="bg-emerald-50"
          />
          <StatCard
            icon={<BookOpen className="w-5 h-5 text-amber-600" />}
            label="Classes" value={stats.classes}
            href="/classes" color="bg-amber-50"
          />
          <StatCard
            icon={<Users className="w-5 h-5 text-purple-600" />}
            label="Guardians" value={stats.guardians}
            href="/guardians" color="bg-purple-50"
          />
        </div>
      )}

      {/* Tabs */}
      <div className="flex bg-gray-100 rounded-xl p-1 gap-1">
        {[
          { id: 'overview', label: '🏫 Overview' },
          { id: 'settings', label: '⚙️ Settings'  },
          { id: 'danger',   label: '⚠️ Danger'    },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id as any)}
            className={cn(
              'flex-1 py-2 rounded-lg text-sm font-semibold transition-colors',
              tab === t.id
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Overview tab */}
      {tab === 'overview' && (
        <Section title="School Information" icon={<School className="w-4 h-4" />}>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Label>School Name</Label>
              <Input
                className="mt-1"
                value={editForm.name ?? ''}
                onChange={e => setField('name', e.target.value)}
              />
            </div>
            <div>
              <Label>Slug</Label>
              <Input
                className="mt-1"
                value={editForm.slug ?? ''}
                onChange={e => setField('slug', e.target.value)}
              />
            </div>
            <div>
              <Label>Type</Label>
              <Select
                value={editForm.type ?? 'school'}
                onValueChange={v => setField('type', v)}
              >
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SCHOOL_TYPES.map(t => (
                    <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="flex items-center gap-1"><Mail className="w-3.5 h-3.5" /> Email</Label>
              <Input
                type="email" className="mt-1"
                value={editForm.email ?? ''}
                onChange={e => setField('email', e.target.value)}
              />
            </div>
            <div>
              <Label className="flex items-center gap-1"><Phone className="w-3.5 h-3.5" /> Phone</Label>
              <Input
                className="mt-1"
                value={editForm.phone ?? ''}
                onChange={e => setField('phone', e.target.value)}
              />
            </div>
            <div className="col-span-2">
              <Label className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> Address</Label>
              <Input
                className="mt-1"
                value={editForm.address ?? ''}
                onChange={e => setField('address', e.target.value)}
              />
            </div>
            <div>
              <Label>City</Label>
              <Input
                className="mt-1"
                value={editForm.city ?? ''}
                onChange={e => setField('city', e.target.value)}
              />
            </div>
            <div>
              <Label className="flex items-center gap-1"><Globe className="w-3.5 h-3.5" /> Country</Label>
              <Input
                className="mt-1"
                value={editForm.country ?? ''}
                onChange={e => setField('country', e.target.value)}
              />
            </div>
          </div>

          {isDirty && (
            <div className="mt-5 flex justify-end">
              <Button
                onClick={() => updateMutation.mutate(editForm)}
                disabled={updateMutation.isPending}
                className="bg-indigo-600 hover:bg-indigo-700 gap-2"
              >
                {updateMutation.isPending
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <Save className="w-4 h-4" />
                }
                Save Changes
              </Button>
            </div>
          )}
        </Section>
      )}

      {/* Settings tab */}
      {tab === 'settings' && (
        <Section title="School Status" icon={<Settings className="w-4 h-4" />}>
          <SettingToggle
            label="School Active"
            description="When inactive, users in this school cannot log in"
            value={school.isActive}
            onChange={() => toggleActive.mutate()}
          />
          <div className="pt-3 text-xs text-gray-400">
            More feature-level settings (grading, attendance policies, notifications) are managed
            in <Link href="/settings" className="text-indigo-600 hover:underline">School Settings</Link>.
          </div>
        </Section>
      )}

      {/* Danger tab */}
      {tab === 'danger' && (
        <Section title="Danger Zone" icon={<AlertTriangle className="w-4 h-4 text-red-500" />}>
          <div className="space-y-4">
            <div className="p-4 bg-red-50 border border-red-200 rounded-xl">
              <h3 className="text-sm font-bold text-red-700 mb-1">Delete School</h3>
              <p className="text-xs text-red-500 mb-3">
                This will soft-delete the school. All data is preserved but the school becomes inaccessible.
                This action cannot be easily undone.
              </p>
              <Button
                variant="destructive"
                size="sm"
                className="gap-2"
                onClick={() => {
                  if (confirm(`Delete "${school.name}"? This will deactivate the school for all users.`)) {
                    deleteMutation.mutate()
                  }
                }}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <Trash2 className="w-3.5 h-3.5" />
                }
                Delete School
              </Button>
            </div>
          </div>
        </Section>
      )}
    </div>
  )
}
