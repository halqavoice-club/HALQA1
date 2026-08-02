'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Modal } from '@/components/ui/modal'
import { useToast } from '@/components/ui/use-toast'
import { useAuthStore } from '@/store/auth.store'
import { Megaphone, Plus, Pin, Trash2, Loader2, Calendar } from 'lucide-react'
import { ErrorState } from '@/components/ui/error-state'
import { format } from 'date-fns'
import Link from 'next/link'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'

const TARGET_ROLES = [
  { value: 'TEACHER', label: 'Teachers' },
  { value: 'STUDENT', label: 'Students' },
  { value: 'GUARDIAN', label: 'Parents/Guardians' },
]

export default function AnnouncementsPage() {
  const { user } = useAuthStore()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({
    title: '',
    content: '',
    targetRoles: [] as string[],
    isPinned: false,
    expiresAt: ''
  })
  const [deleteAnnouncementId, setDeleteAnnouncementId] = useState<string | null>(null)

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['announcements'],
    queryFn: () => api.get('/announcements').then(r => r.data.data)
  })

  const createMutation = useMutation({
    mutationFn: (d: any) => api.post('/announcements', d),
    onSuccess: () => {
      toast({ title: 'Announcement published' })
      queryClient.invalidateQueries({ queryKey: ['announcements'] })
      setShowCreate(false)
      setForm({ title: '', content: '', targetRoles: [], isPinned: false, expiresAt: '' })
    },
    onError: () => toast({ title: 'Failed to publish', variant: 'destructive' })
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/announcements/${id}`),
    onSuccess: () => {
      toast({ title: 'Announcement deleted' })
      queryClient.invalidateQueries({ queryKey: ['announcements'] })
    }
  })

  const canCreate = ['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER'].includes(user?.role || '')

  const toggleRole = (role: string) => {
    setForm(f => ({
      ...f,
      targetRoles: f.targetRoles.includes(role)
        ? f.targetRoles.filter(r => r !== role)
        : [...f.targetRoles, role]
    }))
  }

  const announcements = data || []
  const pinned = announcements.filter((a: any) => a.isPinned)
  const regular = announcements.filter((a: any) => !a.isPinned)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Announcements</h1>
          <p className="text-gray-500 text-sm">School-wide announcements and notices</p>
        </div>
        {canCreate && (
          <Button onClick={() => setShowCreate(true)} className="bg-halqa-700 hover:bg-halqa-800 gap-2">
            <Plus className="w-4 h-4" /> New Announcement
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => <div key={i} className="h-28 bg-gray-200 rounded-xl animate-pulse" />)}
        </div>
      ) : isError ? (
        <ErrorState onRetry={refetch} />
      ) : announcements.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <Megaphone className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p>No announcements yet</p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Pinned */}
          {pinned.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1">
                <Pin className="w-3 h-3" /> Pinned
              </p>
              <div className="space-y-3">
                {pinned.map((a: any) => (
                  <AnnouncementCard key={a.id} announcement={a} canDelete={canCreate}
                    onDelete={() => setDeleteAnnouncementId(a.id)} />
                ))}
              </div>
            </div>
          )}

          {/* Regular */}
          {regular.length > 0 && (
            <div>
              {pinned.length > 0 && (
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Recent</p>
              )}
              <div className="space-y-3">
                {regular.map((a: any) => (
                  <AnnouncementCard key={a.id} announcement={a} canDelete={canCreate}
                    onDelete={() => setDeleteAnnouncementId(a.id)} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Create modal */}
      <Modal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        title="New Announcement"
        size="md"
        footer={
          <>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button
              onClick={() => createMutation.mutate(form)}
              disabled={!form.title || !form.content || createMutation.isPending}
              className="bg-halqa-700 hover:bg-halqa-800 gap-2"
            >
              {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Megaphone className="w-4 h-4" />}
              Publish
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <Label>Title *</Label>
            <Input className="mt-1" placeholder="Announcement title"
              value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
          </div>
          <div>
            <Label>Content *</Label>
            <Textarea className="mt-1 min-h-[100px]" placeholder="Write your announcement..."
              value={form.content} onChange={e => setForm(f => ({ ...f, content: e.target.value }))} />
          </div>
          <div>
            <Label>Target Audience</Label>
            <div className="flex gap-2 mt-1 flex-wrap">
              {TARGET_ROLES.map(r => (
                <button
                  key={r.value}
                  onClick={() => toggleRole(r.value)}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                    form.targetRoles.includes(r.value)
                      ? 'bg-halqa-700 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-1">Leave empty to target everyone</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <Label>Expires At (optional)</Label>
              <Input type="datetime-local" className="mt-1" value={form.expiresAt}
                onChange={e => setForm(f => ({ ...f, expiresAt: e.target.value }))} />
            </div>
            <div className="flex items-center gap-2 mt-5">
              <input
                type="checkbox"
                id="pinned"
                checked={form.isPinned}
                onChange={e => setForm(f => ({ ...f, isPinned: e.target.checked }))}
                className="w-4 h-4 accent-halqa-700"
              />
              <Label htmlFor="pinned" className="cursor-pointer">Pin it</Label>
            </div>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteAnnouncementId}
        title="Delete Announcement"
        message="Are you sure you want to delete this announcement?"
        confirmLabel="Delete"
        variant="danger"
        loading={deleteMutation.isPending}
        onConfirm={() => { if (deleteAnnouncementId) deleteMutation.mutate(deleteAnnouncementId); setDeleteAnnouncementId(null) }}
        onCancel={() => setDeleteAnnouncementId(null)}
      />
    </div>
  )
}

function AnnouncementCard({ announcement: a, canDelete, onDelete }: {
  announcement: any
  canDelete: boolean
  onDelete: () => void
}) {
  return (
    <Card className={`border-0 shadow-sm hover:shadow-md transition-all ${a.isPinned ? 'border-l-4 border-l-halqa-500' : ''}`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <Link href={`/announcements/${a.id}`} className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              {a.isPinned && <Pin className="w-3.5 h-3.5 text-halqa-600 flex-shrink-0" />}
              <h3 className="font-semibold text-gray-900 hover:text-halqa-700 transition-colors">{a.title}</h3>
            </div>
            <p className="text-sm text-gray-600 leading-relaxed line-clamp-2">{a.content}</p>
            <div className="flex items-center gap-3 mt-3">
              <span className="text-xs text-gray-400 flex items-center gap-1">
                <Calendar className="w-3 h-3" />
                {format(new Date(a.publishAt || a.createdAt), 'MMM d, yyyy h:mm a')}
              </span>
              {a.targetRoles && a.targetRoles.length > 0 && (
                <div className="flex gap-1">
                  {a.targetRoles.map((r: string) => (
                    <Badge key={r} variant="secondary" className="text-xs">{r}</Badge>
                  ))}
                </div>
              )}
              {a.expiresAt && (
                <span className="text-xs text-orange-500">
                  Expires {format(new Date(a.expiresAt), 'MMM d')}
                </span>
              )}
            </div>
          </Link>
          {canDelete && (
            <button
              onClick={onDelete}
              className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors flex-shrink-0"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
