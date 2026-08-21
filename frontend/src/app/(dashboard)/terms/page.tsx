'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { useToast } from '@/components/ui/use-toast'
import { useAuthStore } from '@/store/auth.store'
import { useEducationRole } from '@/hooks/useEducationRole'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { ErrorState } from '@/components/ui/error-state'
import { Plus, Calendar, CheckCircle, Loader2, Star, Trash2 } from 'lucide-react'
import { format } from 'date-fns'

export default function TermsPage() {
  const { user } = useAuthStore()
  const { isAdmin, isTeacher, isStudent, isGuardian, effectiveRole } = useEducationRole()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ name: '', startDate: '', endDate: '' })
  const [deleteTermId, setDeleteTermId] = useState<string | null>(null)

  const { data: terms, isLoading, isError, refetch } = useQuery({
    queryKey: ['terms'],
    queryFn: () => api.get('/terms').then(r => r.data.data)
  })

  const createMutation = useMutation({
    mutationFn: (d: any) => api.post('/terms', d),
    onSuccess: () => {
      toast({ title: 'Term created' })
      queryClient.invalidateQueries({ queryKey: ['terms'] })
      setShowCreate(false)
      setForm({ name: '', startDate: '', endDate: '' })
    },
    onError: () => toast({ title: 'Failed to create term', variant: 'destructive' })
  })

  const setCurrentMutation = useMutation({
    mutationFn: (id: string) => api.post(`/terms/${id}/set-current`),
    onSuccess: () => {
      toast({ title: 'Current term updated' })
      queryClient.invalidateQueries({ queryKey: ['terms'] })
    }
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/terms/${id}`),
    onSuccess: () => {
      toast({ title: 'Term deleted' })
      queryClient.invalidateQueries({ queryKey: ['terms'] })
    }
  })

  const canManage = isAdmin

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Terms & Semesters</h1>
          <p className="text-gray-500 text-sm">Manage academic terms and semesters</p>
        </div>
        {canManage && (
          <Button onClick={() => setShowCreate(true)} className="bg-halqa-700 hover:bg-halqa-800 gap-2">
            <Plus className="w-4 h-4" /> New Term
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-20 bg-gray-200 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : isError ? (
        <ErrorState onRetry={refetch} />
      ) : (terms || []).length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <Calendar className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p>No terms created yet</p>
        </div>
      ) : (
        <div className="space-y-3">
          {(terms || []).map((term: any) => (
            <Card key={term.id} className={`border-0 shadow-sm ${term.isCurrent ? 'ring-2 ring-halqa-400' : ''}`}>
              <CardContent className="p-4">
                <div className="flex items-center gap-4">
                  <div className={`p-2.5 rounded-xl ${term.isCurrent ? 'bg-halqa-100' : 'bg-gray-100'}`}>
                    <Calendar className={`w-5 h-5 ${term.isCurrent ? 'text-halqa-700' : 'text-gray-500'}`} />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-gray-900">{term.name}</h3>
                      {term.isCurrent && (
                        <Badge className="text-xs bg-halqa-100 text-halqa-700 gap-1">
                          <Star className="w-2.5 h-2.5" /> Current
                        </Badge>
                      )}
                      {term.isActive && !term.isCurrent && (
                        <Badge variant="secondary" className="text-xs">Active</Badge>
                      )}
                    </div>
                    <p className="text-sm text-gray-500 mt-0.5">
                      {format(new Date(term.startDate), 'MMM d, yyyy')} — {format(new Date(term.endDate), 'MMM d, yyyy')}
                    </p>
                  </div>
                  {canManage && (
                    <div className="flex gap-2">
                      {!term.isCurrent && (
                        <Button
                          size="sm" variant="outline"
                          onClick={() => setCurrentMutation.mutate(term.id)}
                          disabled={setCurrentMutation.isPending}
                          className="gap-1 text-xs"
                        >
                          <CheckCircle className="w-3 h-3" /> Set Current
                        </Button>
                      )}
                      <Button
                        size="sm" variant="outline"
                        onClick={() => setDeleteTermId(term.id)}
                        className="text-red-600 border-red-200 hover:bg-red-50"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Term</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Term Name *</Label>
              <Input className="mt-1" placeholder="e.g., Fall 2024, Spring 2025"
                value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Start Date *</Label>
                <Input type="date" className="mt-1" value={form.startDate}
                  onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} />
              </div>
              <div>
                <Label>End Date *</Label>
                <Input type="date" className="mt-1" value={form.endDate}
                  onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button
              onClick={() => createMutation.mutate(form)}
              disabled={!form.name || !form.startDate || !form.endDate || createMutation.isPending}
              className="bg-halqa-700 hover:bg-halqa-800 gap-2"
            >
              {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Create Term
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTermId}
        title="Delete Term"
        message="Are you sure you want to delete this term? This action cannot be undone."
        confirmLabel="Delete"
        variant="danger"
        loading={deleteMutation.isPending}
        onConfirm={() => { if (deleteTermId) deleteMutation.mutate(deleteTermId); setDeleteTermId(null) }}
        onCancel={() => setDeleteTermId(null)}
      />
    </div>
  )
}
