'use client'

import { useState, useRef } from 'react'
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
  Loader2, Save, Trash2, Camera, AlertTriangle,
} from 'lucide-react'
import Link from 'next/link'
import { useAuthStore } from '@/store/auth.store'
import { useSchoolAccess } from '@/hooks/useSchoolAccess'
import { getFileUrl } from '@/lib/avatar'

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
  description: string | null
  createdAt: string
  settings:  Record<string, any> | null
}

interface Stats {
  students:  number
  teachers:  number
  classes:   number
  guardians: number
}

function StatCard({ icon, label, value, href, color }: {
  icon: React.ReactNode; label: string; value: number
  href?: string; color: string
}) {
  const content = (
    <div className={cn('bg-white rounded-2xl border border-gray-100 p-4 shadow-sm hover:shadow-md transition-all', href && 'cursor-pointer')}>
      <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center mb-3', color)}>{icon}</div>
      <p className="text-2xl font-black text-gray-900">{value.toLocaleString()}</p>
      <p className="text-xs text-gray-500 font-medium mt-0.5">{label}</p>
    </div>
  )
  return href ? <Link href={href}>{content}</Link> : <div>{content}</div>
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
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
        className={cn('relative w-10 h-6 rounded-full transition-colors', value ? 'bg-indigo-600' : 'bg-gray-200')}
      >
        <span className={cn('absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform', value ? 'left-5' : 'left-1')} />
      </button>
    </div>
  )
}

export default function SchoolManagePage() {
  const { id }      = useParams<{ id: string }>()
  const router      = useRouter()
  const { toast }   = useToast()
  const queryClient = useQueryClient()
  const user        = useAuthStore(s => s.user)
  const { activeRole, activeSchoolId, memberships } = useSchoolAccess()

  // canEdit: SUPER_ADMIN platform role OR the user has SCHOOL_ADMIN membership for THIS school
  // Works for both legacy (user.role = SCHOOL_ADMIN) and new-arch (SchoolMembership.role = SCHOOL_ADMIN)
  const isSuperAdmin    = user?.role === 'SUPER_ADMIN'
  const myMembership    = memberships.find(m => m.schoolId === id)
  const isMySchoolAdmin = myMembership?.role === 'SCHOOL_ADMIN'
  const isLegacyAdmin   = user?.role === 'SCHOOL_ADMIN' && (user?.schoolId === id || !user?.schoolId)
  const canEdit         = isSuperAdmin || isMySchoolAdmin || isLegacyAdmin
  // canDelete: only SUPER_ADMIN (platform admin) can hard-delete schools
  const canDelete       = isSuperAdmin

  const [tab, setTab]       = useState<'overview' | 'settings' | 'danger'>('overview')
  const [editForm, setEditForm] = useState<Partial<SchoolData>>({})
  const [isDirty, setIsDirty]   = useState(false)
  const logoInputRef = useRef<HTMLInputElement>(null)
  const [logoUploading, setLogoUploading] = useState(false)

  const { data: school, isLoading } = useQuery<SchoolData>({
    queryKey: ['school', id],
    queryFn:  () => api.get(`/schools/${id}`).then(r => r.data.data),
    enabled:  !!id,
    onSuccess: (d: SchoolData) => setEditForm(d),
  } as any)

  const { data: stats } = useQuery<Stats>({
    queryKey: ['school-stats', id],
    queryFn:  () => api.get(`/schools/${id}/stats`).then(r => r.data.data),
    enabled:  !!id,
  })

  const updateMutation = useMutation({
    mutationFn: (data: Partial<SchoolData>) => api.patch(`/schools/${id}`, data),
    onSuccess: () => {
      toast({ title: '✅ School updated' })
      setIsDirty(false)
      queryClient.invalidateQueries({ queryKey: ['school', id] })
      queryClient.invalidateQueries({ queryKey: ['schools'] })
    },
    onError: (e: any) => toast({ title: e?.response?.data?.message || 'Update failed', variant: 'destructive' }),
  })

  const toggleActive = useMutation({
    mutationFn: () => api.patch(`/schools/${id}`, { isActive: !school?.isActive }),
    onSuccess: () => {
      toast({ title: school?.isActive ? 'School deactivated' : 'School activated' })
      queryClient.invalidateQueries({ queryKey: ['school', id] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/schools/${id}`),
    onSuccess: () => {
      toast({ title: 'School deleted' })
      router.push('/school-memberships')
    },
    onError: (e: any) => toast({ title: e?.response?.data?.message || 'Delete failed', variant: 'destructive' }),
  })

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setLogoUploading(true)
    try {
      const form = new FormData()
      form.append('logo', file)
      await api.post(`/schools/${id}/logo`, form)
      toast({ title: '✅ Logo updated' })
      queryClient.invalidateQueries({ queryKey: ['school', id] })
      queryClient.invalidateQueries({ queryKey: ['schools-browse'] })
    } catch (err: any) {
      toast({ title: err?.response?.data?.message || 'Logo upload failed', variant: 'destructive' })
    } finally {
      setLogoUploading(false)
      if (logoInputRef.current) logoInputRef.current.value = ''
    }
  }

  const setField = <K extends keyof SchoolData>(key: K, value: SchoolData[K]) => {
    setEditForm(f => ({ ...f, [key]: value }))
    setIsDirty(true)
  }

  if (isLoading) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="w-7 h-7 animate-spin text-indigo-400" /></div>
  }

  if (!school) {
    return (
      <div className="text-center py-20 text-gray-400">
        <School className="w-12 h-12 mx-auto mb-3 opacity-30" />
        <p>School not found</p>
        <Link href="/school-memberships" className="mt-2 inline-block text-sm text-indigo-600 hover:underline">← My Schools</Link>
      </div>
    )
  }

  return (
    <div className="space-y-5 max-w-3xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link href="/school-memberships" className="p-2 rounded-xl hover:bg-gray-100 transition-colors">
            <ArrowLeft className="w-5 h-5 text-gray-500" />
          </Link>

          {/* Logo with upload button for admins */}
          <div className="relative group">
            <div className="w-14 h-14 bg-indigo-100 rounded-xl flex items-center justify-center overflow-hidden border-2 border-white shadow">
              {school.logoUrl
                ? <img src={getFileUrl(school.logoUrl)} alt={school.name} className="w-full h-full object-contain p-0.5" />
                : <School className="w-7 h-7 text-indigo-600" />
              }
            </div>
            {canEdit && (
              <>
                <button
                  onClick={() => logoInputRef.current?.click()}
                  disabled={logoUploading}
                  className="absolute -bottom-1 -right-1 w-6 h-6 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full flex items-center justify-center shadow transition-colors"
                  title="Change logo"
                >
                  {logoUploading
                    ? <Loader2 className="w-3 h-3 animate-spin" />
                    : <Camera className="w-3 h-3" />
                  }
                </button>
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={handleLogoUpload}
                />
              </>
            )}
          </div>

          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-gray-900">{school.name}</h1>
              <Badge variant={school.isActive ? 'default' : 'secondary'} className="text-xs">
                {school.isActive ? 'Active' : 'Inactive'}
              </Badge>
              {isMySchoolAdmin && (
                <Badge className="text-xs bg-purple-100 text-purple-700 border-0">My School</Badge>
              )}
            </div>
            <p className="text-sm text-gray-400 capitalize">
              {school.type} · {school.slug}{school.city ? ` · ${school.city}` : ''}
            </p>
          </div>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard icon={<GraduationCap className="w-5 h-5 text-indigo-600" />} label="Students" value={stats.students} href="/students" color="bg-indigo-50" />
          <StatCard icon={<UserCheck className="w-5 h-5 text-emerald-600" />}   label="Teachers" value={stats.teachers} href="/teachers" color="bg-emerald-50" />
          <StatCard icon={<BookOpen className="w-5 h-5 text-amber-600" />}      label="Classes"  value={stats.classes}  href="/classes"  color="bg-amber-50" />
          <StatCard icon={<Users className="w-5 h-5 text-purple-600" />}        label="Guardians" value={stats.guardians} href="/guardians" color="bg-purple-50" />
        </div>
      )}

      {/* Tabs */}
      <div className="flex bg-gray-100 rounded-xl p-1 gap-1">
        {[
          { id: 'overview', label: '🏫 Overview' },
          ...(canEdit ? [{ id: 'settings', label: '⚙️ Settings' }] : []),
          ...(canDelete ? [{ id: 'danger', label: '⚠️ Danger' }] : []),
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id as any)}
            className={cn(
              'flex-1 py-2 rounded-lg text-sm font-semibold transition-colors',
              tab === t.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
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
              <Input className="mt-1" value={editForm.name ?? ''} onChange={e => setField('name', e.target.value)} disabled={!canEdit} />
            </div>
            <div>
              <Label>Slug</Label>
              <Input className="mt-1" value={editForm.slug ?? ''} onChange={e => setField('slug', e.target.value)} disabled={!canEdit} />
            </div>
            <div>
              <Label>Type</Label>
              <Select value={editForm.type ?? 'school'} onValueChange={v => setField('type', v)} disabled={!canEdit}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SCHOOL_TYPES.map(t => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2">
              <Label>Description</Label>
              <textarea
                className="mt-1 w-full border border-input rounded-md px-3 py-2 text-sm resize-none h-20 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
                value={editForm.description ?? ''}
                onChange={e => setField('description', e.target.value)}
                placeholder="About your school…"
                disabled={!canEdit}
              />
            </div>
            <div>
              <Label className="flex items-center gap-1"><Mail className="w-3.5 h-3.5" /> Email</Label>
              <Input type="email" className="mt-1" value={editForm.email ?? ''} onChange={e => setField('email', e.target.value)} disabled={!canEdit} />
            </div>
            <div>
              <Label className="flex items-center gap-1"><Phone className="w-3.5 h-3.5" /> Phone</Label>
              <Input className="mt-1" value={editForm.phone ?? ''} onChange={e => setField('phone', e.target.value)} disabled={!canEdit} />
            </div>
            <div className="col-span-2">
              <Label className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> Address</Label>
              <Input className="mt-1" value={editForm.address ?? ''} onChange={e => setField('address', e.target.value)} disabled={!canEdit} />
            </div>
            <div>
              <Label>City</Label>
              <Input className="mt-1" value={editForm.city ?? ''} onChange={e => setField('city', e.target.value)} disabled={!canEdit} />
            </div>
            <div>
              <Label className="flex items-center gap-1"><Globe className="w-3.5 h-3.5" /> Country</Label>
              <Input className="mt-1" value={editForm.country ?? ''} onChange={e => setField('country', e.target.value)} disabled={!canEdit} />
            </div>
          </div>
          {isDirty && canEdit && (
            <div className="mt-5 flex justify-end">
              <Button onClick={() => updateMutation.mutate(editForm)} disabled={updateMutation.isPending} className="bg-indigo-600 hover:bg-indigo-700 gap-2">
                {updateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save Changes
              </Button>
            </div>
          )}
          {!canEdit && (
            <p className="mt-4 text-xs text-gray-400">Only the school admin can edit these details.</p>
          )}
        </Section>
      )}

      {/* Settings tab */}
      {tab === 'settings' && canEdit && (
        <Section title="School Status" icon={<Settings className="w-4 h-4" />}>
          <SettingToggle
            label="School Active"
            description="When inactive, users in this school cannot log in"
            value={school.isActive}
            onChange={() => toggleActive.mutate()}
          />
          <div className="pt-3 text-xs text-gray-400">
            More settings are managed in{' '}
            <Link href="/settings" className="text-indigo-600 hover:underline">School Settings</Link>.
          </div>
        </Section>
      )}

      {/* Danger tab — SUPER_ADMIN only */}
      {tab === 'danger' && canDelete && (
        <Section title="Danger Zone" icon={<AlertTriangle className="w-4 h-4 text-red-500" />}>
          <div className="p-4 bg-red-50 border border-red-200 rounded-xl">
            <h3 className="text-sm font-bold text-red-700 mb-1">Delete School</h3>
            <p className="text-xs text-red-500 mb-3">
              This soft-deletes the school. All data is preserved but the school becomes inaccessible.
            </p>
            <Button
              variant="destructive" size="sm" className="gap-2"
              onClick={() => {
                if (confirm(`Delete "${school.name}"? This will deactivate the school for all users.`)) {
                  deleteMutation.mutate()
                }
              }}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
              Delete School
            </Button>
          </div>
        </Section>
      )}
    </div>
  )
}
