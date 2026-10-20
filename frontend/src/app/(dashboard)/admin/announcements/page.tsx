'use client'

/**
 * Admin — Platform Announcements
 * Route: /admin/announcements
 * Access: SUPER_ADMIN only
 *
 * UIGAP-012 FIX: Platform admin can now create, edit, delete announcements
 * targeting any school or all active schools (platform-wide broadcast).
 */

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'
import { useAuthStore } from '@/store/auth.store'
import { useToast } from '@/components/ui/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select'
import {
  Megaphone, Plus, Pencil, Trash2, Pin, PinOff, Globe, School, RefreshCw, AlertTriangle
} from 'lucide-react'

type Announcement = {
  id: string
  title: string
  content: string
  schoolId: string
  isPinned: boolean
  targetRoles: string[]
  publishAt: string
  expiresAt: string | null
  createdAt: string
  school?: { name: string }
}

const TARGET_ROLE_OPTIONS = ['TEACHER', 'STUDENT', 'GUARDIAN', 'MEMBER']

function RoleBadge({ role }: { role: string }) {
  const colors: Record<string, string> = {
    TEACHER:  'bg-blue-100 text-blue-700',
    STUDENT:  'bg-green-100 text-green-700',
    GUARDIAN: 'bg-yellow-100 text-yellow-700',
    MEMBER:   'bg-gray-100 text-gray-600',
  }
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${colors[role] ?? 'bg-gray-100 text-gray-600'}`}>
      {role}
    </span>
  )
}

const EMPTY_FORM = {
  title: '', content: '', schoolId: '', targetRoles: [] as string[],
  isPinned: false, expiresAt: '',
}

export default function AdminAnnouncementsPage() {
  const authUser = useAuthStore(s => s.user)
  const { toast } = useToast()
  const qc = useQueryClient()
  const isAdmin = authUser?.role === 'SUPER_ADMIN'

  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Announcement | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Announcement | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)

  // ── Announcements query ──────────────────────────────────────────────────
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['admin-announcements'],
    queryFn:  () => api.get('/admin/stats/announcements', { params: { limit: 50 } })
      .then(r => r.data.data as { announcements: Announcement[]; pagination: any }),
    enabled:  isAdmin,
    refetchInterval: 60_000,
  })

  // ── Schools query (for picker) ───────────────────────────────────────────
  const { data: schoolsData } = useQuery({
    queryKey: ['admin-schools-list'],
    queryFn:  () => api.get('/admin/stats/schools', { params: { limit: 100 } })
      .then(r => r.data.data?.schools ?? []),
    enabled:  isAdmin,
  })
  const schools: any[] = schoolsData ?? []

  // ── Create mutation ──────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: () => api.post('/admin/stats/announcements', {
      title:       form.title.trim(),
      content:     form.content.trim(),
      schoolId:    form.schoolId || undefined,    // omit = platform-wide
      targetRoles: form.targetRoles.length > 0 ? form.targetRoles : undefined,
      isPinned:    form.isPinned,
      expiresAt:   form.expiresAt || undefined,
    }),
    onSuccess: (r) => {
      const count = r.data.data?.count ?? 1
      toast({ title: '✅ Announcement created', description: r.data.message ?? `Sent to ${count} school(s)` })
      qc.invalidateQueries({ queryKey: ['admin-announcements'] })
      setCreateOpen(false)
      setForm(EMPTY_FORM)
    },
    onError: (e: any) => toast({ title: 'Failed', description: e.response?.data?.message, variant: 'destructive' }),
  })

  // ── Edit mutation ────────────────────────────────────────────────────────
  const editMutation = useMutation({
    mutationFn: () => api.patch(`/admin/stats/announcements/${editTarget?.id}`, {
      title:       form.title.trim(),
      content:     form.content.trim(),
      isPinned:    form.isPinned,
      targetRoles: form.targetRoles.length > 0 ? form.targetRoles : undefined,
      expiresAt:   form.expiresAt || null,
    }),
    onSuccess: () => {
      toast({ title: 'Announcement updated' })
      qc.invalidateQueries({ queryKey: ['admin-announcements'] })
      setEditTarget(null)
      setForm(EMPTY_FORM)
    },
    onError: (e: any) => toast({ title: 'Update failed', description: e.response?.data?.message, variant: 'destructive' }),
  })

  // ── Delete mutation ──────────────────────────────────────────────────────
  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/admin/stats/announcements/${deleteTarget?.id}`),
    onSuccess: () => {
      toast({ title: 'Announcement deleted' })
      qc.invalidateQueries({ queryKey: ['admin-announcements'] })
      setDeleteTarget(null)
    },
    onError: (e: any) => toast({ title: 'Delete failed', description: e.response?.data?.message, variant: 'destructive' }),
  })

  // ── Toggle pin mutation ──────────────────────────────────────────────────
  const pinMutation = useMutation({
    mutationFn: (ann: Announcement) =>
      api.patch(`/admin/stats/announcements/${ann.id}`, { isPinned: !ann.isPinned }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-announcements'] }),
    onError: (e: any) => toast({ title: 'Failed', description: e.response?.data?.message, variant: 'destructive' }),
  })

  function openEdit(ann: Announcement) {
    setForm({
      title:       ann.title,
      content:     ann.content,
      schoolId:    ann.schoolId,
      targetRoles: ann.targetRoles ?? [],
      isPinned:    ann.isPinned,
      expiresAt:   ann.expiresAt ? ann.expiresAt.slice(0, 16) : '',
    })
    setEditTarget(ann)
  }

  function toggleRole(role: string) {
    setForm(f => ({
      ...f,
      targetRoles: f.targetRoles.includes(role)
        ? f.targetRoles.filter(r => r !== role)
        : [...f.targetRoles, role],
    }))
  }

  if (!isAdmin) {
    return <div className="flex items-center justify-center h-64"><p className="text-gray-500">Access restricted.</p></div>
  }

  const announcements = data?.announcements ?? []

  return (
    <div className="max-w-4xl mx-auto py-8 px-4 space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Megaphone className="w-6 h-6 text-indigo-500" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Announcements</h1>
            <p className="text-sm text-gray-500">Create and manage platform-wide announcements</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isLoading}>
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isLoading ? 'animate-spin' : ''}`} />Refresh
          </Button>
          <Button size="sm" onClick={() => { setForm(EMPTY_FORM); setCreateOpen(true) }}>
            <Plus className="w-4 h-4 mr-1.5" />New Announcement
          </Button>
        </div>
      </div>

      {/* Announcement list */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-28 bg-gray-100 dark:bg-gray-800 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : announcements.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <Megaphone className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No announcements yet</p>
          <p className="text-sm mt-1">Create one to notify school members</p>
        </div>
      ) : (
        <div className="space-y-3">
          {announcements.map((ann) => (
            <Card key={ann.id} className={ann.isPinned ? 'border-indigo-300 dark:border-indigo-700' : ''}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {ann.isPinned && <Pin className="w-3.5 h-3.5 text-indigo-500 flex-shrink-0" />}
                      <h3 className="font-semibold text-gray-900 dark:text-white">{ann.title}</h3>
                    </div>
                    <p className="text-sm text-gray-600 dark:text-gray-300 mt-1 line-clamp-2">{ann.content}</p>
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      <div className="flex items-center gap-1 text-xs text-gray-400">
                        <School className="w-3 h-3" />
                        <span>{ann.school?.name ?? ann.schoolId}</span>
                      </div>
                      {(ann.targetRoles ?? []).map(r => <RoleBadge key={r} role={r} />)}
                      <span className="text-xs text-gray-400">
                        {new Date(ann.publishAt).toLocaleDateString()}
                      </span>
                      {ann.expiresAt && (
                        <span className="text-xs text-orange-500">
                          Expires {new Date(ann.expiresAt).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <Button
                      size="sm" variant="ghost"
                      className={ann.isPinned ? 'text-indigo-600' : 'text-gray-400'}
                      title={ann.isPinned ? 'Unpin' : 'Pin'}
                      onClick={() => pinMutation.mutate(ann)}
                    >
                      {ann.isPinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
                    </Button>
                    <Button size="sm" variant="ghost" className="text-gray-400 hover:text-indigo-600"
                      onClick={() => openEdit(ann)}>
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" className="text-gray-400 hover:text-red-600"
                      onClick={() => setDeleteTarget(ann)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* ── Create / Edit Form ─────────────────────────────────────────── */}
      {(() => {
        const isEdit   = !!editTarget
        const open     = createOpen || isEdit
        const mutation = isEdit ? editMutation : createMutation
        const title    = isEdit ? 'Edit Announcement' : 'New Announcement'

        return (
          <Dialog open={open} onOpenChange={open => {
            if (!open) { setCreateOpen(false); setEditTarget(null); setForm(EMPTY_FORM) }
          }}>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
              <div className="space-y-4">
                {/* Target school */}
                {!isEdit && (
                  <div>
                    <label className="text-sm font-medium block mb-1">Target School</label>
                    <Select value={form.schoolId} onValueChange={v => setForm(f => ({ ...f, schoolId: v === '__all__' ? '' : v }))}>
                      <SelectTrigger>
                        <SelectValue placeholder="All active schools (platform-wide)" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__all__">
                          <span className="flex items-center gap-2"><Globe className="w-3.5 h-3.5 text-indigo-500" />All Active Schools</span>
                        </SelectItem>
                        {schools.filter((s: any) => s.isActive).map((s: any) => (
                          <SelectItem key={s.id} value={s.id}>
                            <span className="flex items-center gap-2"><School className="w-3.5 h-3.5 text-gray-400" />{s.name}</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {!form.schoolId && (
                      <p className="text-xs text-indigo-600 mt-1 flex items-center gap-1">
                        <Globe className="w-3 h-3" />Will broadcast to {schools.filter((s: any) => s.isActive).length} active schools
                      </p>
                    )}
                  </div>
                )}

                <div>
                  <label className="text-sm font-medium block mb-1">Title <span className="text-red-500">*</span></label>
                  <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                    placeholder="Announcement title" maxLength={255} />
                </div>

                <div>
                  <label className="text-sm font-medium block mb-1">Content <span className="text-red-500">*</span></label>
                  <Textarea value={form.content} onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
                    placeholder="Write your announcement…" rows={4} maxLength={5000} />
                  <p className="text-xs text-gray-400 mt-1">{form.content.length}/5000</p>
                </div>

                <div>
                  <label className="text-sm font-medium block mb-1">Target Roles</label>
                  <div className="flex gap-2 flex-wrap">
                    {TARGET_ROLE_OPTIONS.map(role => (
                      <button
                        key={role}
                        type="button"
                        onClick={() => toggleRole(role)}
                        className={`text-xs px-2.5 py-1 rounded-full border font-medium transition-colors ${
                          form.targetRoles.includes(role)
                            ? 'bg-indigo-500 text-white border-indigo-500'
                            : 'border-gray-300 text-gray-600 hover:border-indigo-300'
                        }`}
                      >
                        {role}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-gray-400 mt-1">
                    {form.targetRoles.length === 0 ? 'Defaults to all roles' : `${form.targetRoles.length} role(s) selected`}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm font-medium block mb-1">Expires At (optional)</label>
                    <Input type="datetime-local" value={form.expiresAt}
                      onChange={e => setForm(f => ({ ...f, expiresAt: e.target.value }))} />
                  </div>
                  <div className="flex items-end pb-1">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.isPinned}
                        onChange={e => setForm(f => ({ ...f, isPinned: e.target.checked }))}
                        className="w-4 h-4 accent-indigo-500"
                      />
                      <span className="text-sm font-medium">Pin announcement</span>
                    </label>
                  </div>
                </div>

                {!form.schoolId && !isEdit && (
                  <div className="p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg text-xs text-amber-800 dark:text-amber-200 flex items-start gap-2">
                    <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                    Platform-wide broadcast will create one announcement per active school and notify all selected roles.
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => { setCreateOpen(false); setEditTarget(null); setForm(EMPTY_FORM) }}>
                  Cancel
                </Button>
                <Button
                  onClick={() => mutation.mutate()}
                  disabled={!form.title.trim() || !form.content.trim() || mutation.isPending}
                >
                  {mutation.isPending
                    ? (isEdit ? 'Saving…' : 'Creating…')
                    : (isEdit ? 'Save Changes' : (form.schoolId ? 'Create' : 'Broadcast to All Schools'))}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )
      })()}

      {/* ── Delete Confirmation ─────────────────────────────────────────── */}
      <Dialog open={!!deleteTarget} onOpenChange={open => !open && setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Delete Announcement</DialogTitle></DialogHeader>
          <p className="text-sm text-gray-600 dark:text-gray-300">
            Are you sure you want to delete <strong>"{deleteTarget?.title}"</strong>? This action cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleteMutation.mutate()} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  )
}
