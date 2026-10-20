'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import api from '@/lib/api'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { useToast } from '@/components/ui/use-toast'
import {
  Plus, School, Settings, Globe, Loader2, GraduationCap,
  UserCheck, CheckCircle2, Clock, Users, Search, ArrowRight,
  ChevronRight
} from 'lucide-react'
import { ErrorState } from '@/components/ui/error-state'
import { format } from 'date-fns'
import Link from 'next/link'
import { useAuthStore } from '@/store/auth.store'
import { useEducationRole } from '@/hooks/useEducationRole'
import { useSchoolAccess } from '@/hooks/useSchoolAccess'
import { useSchoolStore } from '@/store/school.store'
import { getFileUrl } from '@/lib/avatar'

const SCHOOL_TYPES = ['school', 'academy', 'college', 'daycare', 'camp', 'sports']

const ROLE_COLORS: Record<string, string> = {
  SUPER_ADMIN:  'bg-red-100 text-red-700',
  SCHOOL_ADMIN: 'bg-purple-100 text-purple-700',
  TEACHER:      'bg-green-100 text-green-700',
  STUDENT:      'bg-blue-100 text-blue-700',
  GUARDIAN:     'bg-orange-100 text-orange-700',
}

type BrowseSchool = {
  id: string
  name: string
  slug: string
  type: string
  city: string | null
  country: string
  logoUrl: string | null
  memberCount: number
  myMembership: { role: string; status: string } | null
}

export default function SchoolsPage() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const user = useAuthStore(s => s.user)
  const { fetchMe } = useAuthStore()
  const isSuperAdmin = user?.role === 'SUPER_ADMIN'
  const { memberships } = useSchoolAccess()
  const { setActiveSchoolId } = useSchoolStore()
  const router = useRouter()

  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [page, setPage] = useState(1)
  const [showCreate, setShowCreate] = useState(false)
  const [joiningId, setJoiningId] = useState<string | null>(null)
  const [joinRole, setJoinRole] = useState('STUDENT')
  const [joinLoading, setJoinLoading] = useState(false)

  const [form, setForm] = useState({
    name: '', slug: '', type: 'school', email: '', phone: '', address: '', city: '', country: 'US'
  })

  // Public browse endpoint — available to all authenticated users
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['schools-browse', search, typeFilter, page],
    queryFn: () => api.get('/schools/browse', {
      params: { search: search || undefined, type: typeFilter || undefined, page, limit: 20 }
    }).then(r => r.data),
    placeholderData: keepPreviousData,
  })

  const createMutation = useMutation({
    mutationFn: (d: any) => api.post('/schools', d),
    onSuccess: () => {
      toast({ title: 'School created successfully' })
      queryClient.invalidateQueries({ queryKey: ['schools-browse'] })
      setShowCreate(false)
      setForm({ name: '', slug: '', type: 'school', email: '', phone: '', address: '', city: '', country: 'US' })
    },
    onError: (err: any) => toast({ title: err.response?.data?.message || 'Failed', variant: 'destructive' })
  })

  const schools: BrowseSchool[] = data?.data || []
  const pagination = data?.pagination || { total: 0, pages: 1 }

  // Check if user already has a STUDENT membership (active or pending)
  const hasStudentMembership = memberships.some(m => m.role === 'STUDENT')
  const studentSchool = memberships.find(m => m.role === 'STUDENT')

  async function handleJoin(school: BrowseSchool) {
    setJoiningId(school.id)
    setJoinRole('STUDENT') // default
  }

  async function submitJoin() {
    if (!joiningId) return
    setJoinLoading(true)
    try {
      await api.post('/school-memberships/join', { schoolId: joiningId, role: joinRole })
      await fetchMe()
      queryClient.invalidateQueries({ queryKey: ['schools-browse'] })
      setJoiningId(null)
      toast({ title: `Join request sent as ${joinRole}. Awaiting admin approval.` })
    } catch (err: any) {
      toast({ title: err.response?.data?.message || 'Failed to join', variant: 'destructive' })
    } finally {
      setJoinLoading(false)
    }
  }

  const autoSlug = (name: string) =>
    name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

  const joiningSchool = joiningId ? schools.find(s => s.id === joiningId) : null

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Schools</h1>
          <p className="text-gray-500 text-sm">
            {pagination.total} institution{pagination.total !== 1 ? 's' : ''} on HALQA
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Regular users create a school and become its SCHOOL_ADMIN.
              SUPER_ADMIN uses the admin panel (/admin/schools) instead — not this flow. */}
          {!isSuperAdmin && (
            <Button variant="outline" size="sm" asChild>
              <Link href="/school-memberships/create">
                <Plus className="w-3.5 h-3.5 mr-1" /> Create School
              </Link>
            </Button>
          )}
          {isSuperAdmin && (
            <Button onClick={() => setShowCreate(true)} className="bg-halqa-700 hover:bg-halqa-800 gap-2" size="sm">
              <Plus className="w-4 h-4" /> Add School (Admin)
            </Button>
          )}
        </div>
      </div>

      {/* Student enrollment notice */}
      {hasStudentMembership && (
        <div className="flex items-start gap-3 p-4 bg-blue-50 border border-blue-200 rounded-xl text-blue-800 text-sm">
          <GraduationCap className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Currently enrolled as Student at {studentSchool?.school.name}</p>
            <p className="text-blue-600 text-xs mt-0.5">
              You can only be a student at one school. You can still join other schools as Teacher or Guardian.
            </p>
          </div>
        </div>
      )}

      {/* My schools quick panel — clickable to switch context */}
      {memberships.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-3">My Schools</h2>
          <div className="flex flex-wrap gap-2">
            {memberships.map(m => (
              <button
                key={m.schoolId}
                onClick={() => { setActiveSchoolId(m.schoolId); router.push('/education') }}
                className="flex items-center gap-2 bg-white border border-gray-200 hover:border-halqa-400 hover:bg-halqa-50 rounded-xl px-3 py-2 shadow-sm transition-all group"
              >
                {m.school.logoUrl
                  ? <img src={getFileUrl(m.school.logoUrl)} alt="" className="w-6 h-6 rounded object-contain" />
                  : <School className="w-4 h-4 text-gray-400" />
                }
                <span className="text-sm font-medium text-gray-900 group-hover:text-halqa-700">{m.school.name}</span>
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${ROLE_COLORS[m.role] || 'bg-gray-100 text-gray-600'}`}>
                  {m.role.replace(/_/g, ' ')}
                </span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${m.status === 'ACTIVE' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                  {m.status}
                </span>
                <ChevronRight className="w-3.5 h-3.5 text-gray-300 group-hover:text-halqa-500" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Search + Filter */}
      <div className="flex gap-2">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1) }}
            placeholder="Search schools by name or city…"
            className="pl-9"
          />
        </div>
        <select
          value={typeFilter}
          onChange={e => { setTypeFilter(e.target.value); setPage(1) }}
          className="text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
        >
          <option value="">All Types</option>
          {SCHOOL_TYPES.map(t => <option key={t} value={t} className="capitalize">{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
        </select>
      </div>

      {/* School grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => <div key={i} className="h-44 bg-gray-200 rounded-xl animate-pulse" />)}
        </div>
      ) : isError ? (
        <ErrorState onRetry={refetch} />
      ) : schools.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <School className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="font-medium text-gray-700">No schools found</p>
          {search && <p className="text-sm mt-1">Try a different search term</p>}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {schools.map(school => {
            const myM = school.myMembership
            const isMember = !!myM
            const isPending = myM?.status === 'PENDING'
            const isActive = myM?.status === 'ACTIVE'
            // Block joining as STUDENT if already a student elsewhere
            const canJoinAsStudent = !hasStudentMembership || myM?.role === 'STUDENT'

            return (
              <Card key={school.id} className={`border-0 shadow-sm hover:shadow-md transition-all ${isActive ? 'ring-2 ring-indigo-200' : ''}`}>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div className="w-12 h-12 rounded-xl overflow-hidden bg-halqa-100 flex items-center justify-center flex-shrink-0">
                      {school.logoUrl
                        ? <img src={getFileUrl(school.logoUrl)} alt={school.name} className="w-full h-full object-contain p-1" />
                        : <School className="w-6 h-6 text-halqa-700" />
                      }
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      {isMember && (
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${ROLE_COLORS[myM!.role] || 'bg-gray-100 text-gray-600'}`}>
                          {myM!.role.replace(/_/g, ' ')}
                        </span>
                      )}
                      {isPending && (
                        <span className="text-[10px] bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full flex items-center gap-1">
                          <Clock className="w-2.5 h-2.5" /> Pending
                        </span>
                      )}
                      {isActive && (
                        <span className="text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full flex items-center gap-1">
                          <CheckCircle2 className="w-2.5 h-2.5" /> Joined
                        </span>
                      )}
                    </div>
                  </div>

                  <h3 className="font-semibold text-gray-900 truncate">{school.name}</h3>
                  <p className="text-xs text-gray-500 mt-0.5 capitalize">{school.type}</p>
                  {(school.city || school.country) && (
                    <p className="text-xs text-gray-400 mt-1 flex items-center gap-1">
                      <Globe className="w-3 h-3" />
                      {school.city ? `${school.city}, ` : ''}{school.country}
                    </p>
                  )}
                  <p className="text-xs text-gray-400 mt-1 flex items-center gap-1">
                    <Users className="w-3 h-3" /> {school.memberCount} member{school.memberCount !== 1 ? 's' : ''}
                  </p>

                  <div className="mt-4 flex gap-2">
                    {isActive ? (
                      <Button
                        variant="outline" size="sm"
                        className="flex-1 text-xs gap-1"
                        onClick={() => { setActiveSchoolId(school.id); router.push('/education') }}
                      >
                        <GraduationCap className="w-3 h-3" /> Open Dashboard
                      </Button>
                    ) : isPending ? (
                      <div className="flex-1 text-center text-xs text-yellow-600 py-1.5 bg-yellow-50 rounded-lg">
                        ⏳ Awaiting approval
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        className="flex-1 text-xs gap-1 bg-indigo-600 hover:bg-indigo-700"
                        onClick={() => handleJoin(school)}
                      >
                        <ArrowRight className="w-3 h-3" /> Join School
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Pagination */}
      {pagination.pages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>← Prev</Button>
          <span className="text-sm text-gray-500">Page {page} of {pagination.pages}</span>
          <Button variant="outline" size="sm" disabled={page >= pagination.pages} onClick={() => setPage(p => p + 1)}>Next →</Button>
        </div>
      )}

      {/* Join dialog */}
      <Dialog open={!!joiningId} onOpenChange={v => { if (!v) setJoiningId(null) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Join {joiningSchool?.name}</DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-4">
            <p className="text-sm text-gray-500">
              How would you like to join this school? Your request will be reviewed by the school admin.
            </p>
            <div className="space-y-2">
              {[
                { value: 'STUDENT', label: 'Student', icon: GraduationCap, disabled: hasStudentMembership, disabledReason: `You are already a student at ${studentSchool?.school.name}` },
                { value: 'TEACHER', label: 'Teacher', icon: UserCheck, disabled: false, disabledReason: '' },
                { value: 'GUARDIAN', label: 'Guardian / Parent', icon: Users, disabled: false, disabledReason: '' },
              ].map(opt => {
                const Icon = opt.icon
                return (
                  <label
                    key={opt.value}
                    className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${
                      opt.disabled ? 'opacity-40 cursor-not-allowed border-gray-100' :
                      joinRole === opt.value ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <input
                      type="radio"
                      name="joinRole"
                      value={opt.value}
                      checked={joinRole === opt.value}
                      onChange={() => !opt.disabled && setJoinRole(opt.value)}
                      disabled={opt.disabled}
                      className="sr-only"
                    />
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${joinRole === opt.value && !opt.disabled ? 'bg-indigo-100' : 'bg-gray-100'}`}>
                      <Icon className={`w-4 h-4 ${joinRole === opt.value && !opt.disabled ? 'text-indigo-600' : 'text-gray-500'}`} />
                    </div>
                    <div className="flex-1">
                      <p className="font-medium text-sm text-gray-900">{opt.label}</p>
                      {opt.disabled && <p className="text-xs text-red-500">{opt.disabledReason}</p>}
                    </div>
                    <div className={`w-4 h-4 rounded-full border-2 flex-shrink-0 ${joinRole === opt.value && !opt.disabled ? 'border-indigo-500 bg-indigo-500' : 'border-gray-300'}`} />
                  </label>
                )
              })}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setJoiningId(null)} disabled={joinLoading}>Cancel</Button>
            <Button
              onClick={submitJoin}
              disabled={joinLoading}
              className="bg-indigo-600 hover:bg-indigo-700 gap-2"
            >
              {joinLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
              Send Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* SUPER_ADMIN create dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add New School</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="col-span-2">
              <Label>School Name *</Label>
              <Input className="mt-1" placeholder="Halqa Academy" value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value, slug: autoSlug(e.target.value) }))} />
            </div>
            <div>
              <Label>Slug *</Label>
              <Input className="mt-1" placeholder="halqa-academy" value={form.slug}
                onChange={e => setForm(f => ({ ...f, slug: e.target.value }))} />
            </div>
            <div>
              <Label>Type</Label>
              <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SCHOOL_TYPES.map(t => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Email</Label><Input type="email" className="mt-1" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} /></div>
            <div><Label>Phone</Label><Input className="mt-1" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} /></div>
            <div><Label>City</Label><Input className="mt-1" value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} /></div>
            <div><Label>Country</Label><Input className="mt-1" value={form.country} onChange={e => setForm(f => ({ ...f, country: e.target.value }))} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button
              onClick={() => createMutation.mutate(form)}
              disabled={!form.name || !form.slug || createMutation.isPending}
              className="bg-halqa-700 hover:bg-halqa-800 gap-2"
            >
              {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Create School
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
