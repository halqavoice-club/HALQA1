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
import { Switch } from '@/components/ui/switch'
import { useToast } from '@/components/ui/use-toast'
import { Plus, StickyNote, Lock, Globe, Trash2, Edit, Search } from 'lucide-react'
import { ErrorState } from '@/components/ui/error-state'
import { format } from 'date-fns'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'

export default function NotesPage() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [search, setSearch] = useState('')
  const [form, setForm] = useState({ title: '', content: '', isPrivate: false })
  const [editId, setEditId] = useState<string | null>(null)
  const [deleteNoteId, setDeleteNoteId] = useState<string | null>(null)

  const { data, isLoading, isError: notesError, refetch: refetchNotes } = useQuery({
    queryKey: ['notes', search],
    queryFn: () => api.get('/notes', { params: { limit: 50 } }).then(r => r.data.data)
  })

  const createMutation = useMutation({
    mutationFn: (d: any) => editId
      ? api.put(`/notes/${editId}`, d)
      : api.post('/notes', d),
    onSuccess: () => {
      toast({ title: editId ? 'Note updated' : 'Note created' })
      queryClient.invalidateQueries({ queryKey: ['notes'] })
      setShowForm(false)
      setEditId(null)
      setForm({ title: '', content: '', isPrivate: false })
    },
    onError: () => toast({ title: 'Failed to save note', variant: 'destructive' })
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/notes/${id}`),
    onSuccess: () => {
      toast({ title: 'Note deleted' })
      queryClient.invalidateQueries({ queryKey: ['notes'] })
    }
  })

  const notes = (data || []).filter((n: any) =>
    !search || n.title.toLowerCase().includes(search.toLowerCase()) ||
    n.content.toLowerCase().includes(search.toLowerCase())
  )

  const handleEdit = (note: any) => {
    setForm({ title: note.title, content: note.content, isPrivate: note.isPrivate })
    setEditId(note.id)
    setShowForm(true)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Notes</h1>
          <p className="text-gray-500 text-sm">Class notes, private notes, and student notes</p>
        </div>
        <Button onClick={() => { setShowForm(true); setEditId(null); setForm({ title: '', content: '', isPrivate: false }) }}
          className="bg-halqa-700 hover:bg-halqa-800 gap-2">
          <Plus className="w-4 h-4" /> New Note
        </Button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <Input placeholder="Search notes..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
      </div>

      {/* Create/Edit form */}
      {showForm && (
        <Card className="border-0 shadow-sm border-l-4 border-l-yellow-400">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{editId ? 'Edit Note' : 'New Note'}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Title</Label>
              <Input className="mt-1" placeholder="Note title..." value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
            </div>
            <div>
              <Label>Content</Label>
              <Textarea className="mt-1 min-h-[120px]" placeholder="Write your note here..."
                value={form.content} onChange={e => setForm(f => ({ ...f, content: e.target.value }))} />
            </div>
            <div className="flex items-center gap-3">
              <Switch
                checked={form.isPrivate}
                onCheckedChange={v => setForm(f => ({ ...f, isPrivate: v }))}
              />
              <Label className="cursor-pointer">
                {form.isPrivate ? (
                  <span className="flex items-center gap-1"><Lock className="w-3 h-3" /> Private (only you)</span>
                ) : (
                  <span className="flex items-center gap-1"><Globe className="w-3 h-3" /> Shared</span>
                )}
              </Label>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={() => createMutation.mutate(form)}
                disabled={!form.title || !form.content || createMutation.isPending}
                className="bg-halqa-700 hover:bg-halqa-800"
              >
                {createMutation.isPending ? 'Saving...' : editId ? 'Update' : 'Save Note'}
              </Button>
              <Button variant="outline" onClick={() => { setShowForm(false); setEditId(null) }}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Notes grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => <div key={i} className="h-40 bg-gray-200 rounded-xl animate-pulse" />)}
        </div>
      ) : notesError ? (
        <ErrorState onRetry={refetchNotes} />
      ) : notes.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <StickyNote className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p>No notes yet</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {notes.map((note: any) => (
            <Card key={note.id} className="border-0 shadow-sm hover:shadow-md transition-all group">
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-2">
                  <h3 className="font-semibold text-gray-900 line-clamp-1">{note.title}</h3>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => handleEdit(note)} className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600">
                      <Edit className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setDeleteNoteId(note.id)}
                      className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-500"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <p className="text-sm text-gray-600 line-clamp-3 mb-3">{note.content}</p>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400">{format(new Date(note.createdAt), 'MMM d, yyyy')}</span>
                  <Badge variant="outline" className="text-xs gap-1">
                    {note.isPrivate ? <><Lock className="w-2.5 h-2.5" /> Private</> : <><Globe className="w-2.5 h-2.5" /> Shared</>}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!deleteNoteId}
        title="Delete Note"
        message="Are you sure you want to delete this note? This action cannot be undone."
        confirmLabel="Delete"
        variant="danger"
        loading={deleteMutation.isPending}
        onConfirm={() => { if (deleteNoteId) deleteMutation.mutate(deleteNoteId); setDeleteNoteId(null) }}
        onCancel={() => setDeleteNoteId(null)}
      />
    </div>
  )
}
