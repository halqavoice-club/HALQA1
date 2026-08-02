'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { useToast } from '@/components/ui/use-toast'
import { Plus, School, Users, BookOpen, Settings, Globe, Loader2 } from 'lucide-react'
import { ErrorState } from '@/components/ui/error-state'
import { format } from 'date-fns'
import Link from 'next/link'

const SCHOOL_TYPES = ['school', 'academy', 'college', 'daycare', 'camp', 'sports']

export default function SchoolsPage() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [search, setSearch] = useState('')
  const [form, setForm] = useState({
    name: '', slug: '', type: 'school', email: '', phone: '', address: '', city: '', country: 'US'
  })

  const { data, isLoading, isError: schoolsError, refetch: refetchSchools } = useQuery({
    queryKey: ['schools', search],
    queryFn: () => api.get('/schools', { params: { search, limit: 50 } }).then(r => r.data)
  })

  const createMutation = useMutation({
    mutationFn: (d: any) => api.post('/schools', d),
    onSuccess: () => {
      toast({ title: 'School created successfully' })
      queryClient.invalidateQueries({ queryKey: ['schools'] })
      setShowCreate(false)
      setForm({ name: '', slug: '', type: 'school', email: '', phone: '', address: '', city: '', country: 'US' })
    },
    onError: (err: any) => toast({ title: err.response?.data?.message || 'Failed', variant: 'destructive' })
  })

  const schools = data?.data || []

  const autoSlug = (name: string) =>
    name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Schools</h1>
          <p className="text-gray-500 text-sm">{data?.pagination?.total || 0} institutions</p>
        </div>
        <Button onClick={() => setShowCreate(true)} className="bg-halqa-700 hover:bg-halqa-800 gap-2">
          <Plus className="w-4 h-4" /> Add School
        </Button>
      </div>

      <div className="relative">
        <Input placeholder="Search schools..." value={search} onChange={e => setSearch(e.target.value)} className="pl-4" />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => <div key={i} className="h-40 bg-gray-200 rounded-xl animate-pulse" />)}
        </div>
      ) : schoolsError ? (
        <ErrorState onRetry={refetchSchools} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {schools.map((school: any) => (
            <Card key={school.id} className="border-0 shadow-sm hover:shadow-md transition-all">
              <CardContent className="p-5">
                <div className="flex items-start justify-between mb-3">
                  <div className="w-10 h-10 bg-halqa-100 rounded-xl flex items-center justify-center">
                    <School className="w-5 h-5 text-halqa-700" />
                  </div>
                  <Badge variant={school.isActive ? 'default' : 'secondary'} className="text-xs">
                    {school.isActive ? 'Active' : 'Inactive'}
                  </Badge>
                </div>
                <h3 className="font-semibold text-gray-900">{school.name}</h3>
                <p className="text-xs text-gray-500 mt-0.5 capitalize">{school.type}</p>
                <div className="mt-3 space-y-1 text-xs text-gray-500">
                  {school.city && (
                    <p className="flex items-center gap-1">
                      <Globe className="w-3 h-3" /> {school.city}, {school.country}
                    </p>
                  )}
                  {school.email && <p>{school.email}</p>}
                </div>
                <div className="flex gap-2 mt-4">
                  <Button variant="outline" size="sm" className="flex-1 text-xs gap-1" asChild>
                    <Link href={`/schools/${school.id}`}>
                      <Settings className="w-3 h-3" /> Manage
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {schools.length === 0 && !isLoading && (
        <div className="text-center py-16 text-gray-500">
          <School className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p>No schools found</p>
        </div>
      )}

      {/* Create dialog */}
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
            <div>
              <Label>Email</Label>
              <Input type="email" className="mt-1" value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
            </div>
            <div>
              <Label>Phone</Label>
              <Input className="mt-1" value={form.phone}
                onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
            </div>
            <div>
              <Label>City</Label>
              <Input className="mt-1" value={form.city}
                onChange={e => setForm(f => ({ ...f, city: e.target.value }))} />
            </div>
            <div>
              <Label>Country</Label>
              <Input className="mt-1" value={form.country}
                onChange={e => setForm(f => ({ ...f, country: e.target.value }))} />
            </div>
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
