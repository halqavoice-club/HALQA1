'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/components/ui/use-toast'
import { useAuthStore } from '@/store/auth.store'
import { useEducationRole } from '@/hooks/useEducationRole'
import { DollarSign, Plus, CheckCircle, XCircle, Clock, Search, Download } from 'lucide-react'
import { ErrorState } from '@/components/ui/error-state'
import { format } from 'date-fns'
import { downloadFile, buildFilename } from '@/lib/download'

const STATUS_COLORS: Record<string, string> = {
  PAID:    'bg-green-100 text-green-700',
  PENDING: 'bg-yellow-100 text-yellow-700',
  OVERDUE: 'bg-red-100 text-red-700',
  WAIVED:  'bg-gray-100 text-gray-600',
}

const STATUS_ICONS: Record<string, React.ElementType> = {
  PAID:    CheckCircle,
  PENDING: Clock,
  OVERDUE: XCircle,
  WAIVED:  CheckCircle,
}

export default function FeesPage() {
  const { user } = useAuthStore()
  const { isAdmin, isTeacher, isStudent, isGuardian, effectiveRole } = useEducationRole()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [form, setForm] = useState({
    studentId: '', amount: '', description: '', dueDate: '', feeType: 'TUITION'
  })


  const { data: feesData, isLoading, isError: feesError, refetch: refetchFees } = useQuery({
    queryKey: ['fees', search, statusFilter],
    queryFn: () => api.get('/fees', {
      params: {
        search: search || undefined,
        status: statusFilter || undefined,
        limit: 50
      }
    }).then(r => r.data)
  })

  const { data: students } = useQuery({
    queryKey: ['students-list'],
    queryFn: () => api.get('/students', { params: { limit: 200 } }).then(r => r.data.data),
    enabled: showForm
  })

  const createMutation = useMutation({
    mutationFn: (d: any) => api.post('/fees', d),
    onSuccess: () => {
      toast({ title: 'Fee record created' })
      queryClient.invalidateQueries({ queryKey: ['fees'] })
      setShowForm(false)
      setForm({ studentId: '', amount: '', description: '', dueDate: '', feeType: 'TUITION' })
    },
    onError: (e: any) => toast({ title: e.response?.data?.message || 'Failed', variant: 'destructive' })
  })

  const markPaidMutation = useMutation({
    mutationFn: (id: string) => api.put(`/fees/${id}/pay`),
    onSuccess: () => {
      toast({ title: 'Marked as paid' })
      queryClient.invalidateQueries({ queryKey: ['fees'] })
    }
  })

  const fees = feesData?.data || []
  const summary = feesData?.summary || {}

  const handleExport = async () => {
    setDownloading(true)
    try {
      await downloadFile('/fees/export', {}, buildFilename('fees', 'xlsx'))
      toast({ title: 'Fees exported' })
    } catch {
      toast({ title: 'Export failed', variant: 'destructive' })
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <DollarSign className="w-6 h-6 text-halqa-700" /> Fee Management
          </h1>
          <p className="text-gray-500 text-sm">Track student fees and payments</p>
        </div>
        <div className="flex gap-2">
          {isAdmin && (
            <>
              <Button variant="outline" size="sm" onClick={handleExport} disabled={downloading} className="gap-2">
                <Download className="w-4 h-4" /> Export
              </Button>
              <Button onClick={() => setShowForm(true)} className="bg-halqa-700 hover:bg-halqa-800 gap-2">
                <Plus className="w-4 h-4" /> Add Fee
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Fees', value: `$${(summary.total || 0).toLocaleString()}`, color: 'bg-blue-50 text-blue-700' },
          { label: 'Collected', value: `$${(summary.paid || 0).toLocaleString()}`, color: 'bg-green-50 text-green-700' },
          { label: 'Pending', value: `$${(summary.pending || 0).toLocaleString()}`, color: 'bg-yellow-50 text-yellow-700' },
          { label: 'Overdue', value: `$${(summary.overdue || 0).toLocaleString()}`, color: 'bg-red-50 text-red-700' },
        ].map(item => (
          <Card key={item.label} className="border-0 shadow-sm">
            <CardContent className={`p-4 ${item.color} rounded-xl`}>
              <p className="text-xs font-medium opacity-70">{item.label}</p>
              <p className="text-2xl font-bold mt-1">{item.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col md:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input placeholder="Search by student name..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={statusFilter || 'all'} onValueChange={v => setStatusFilter(v === 'all' ? '' : v)}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="All status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="PENDING">Pending</SelectItem>
            <SelectItem value="PAID">Paid</SelectItem>
            <SelectItem value="OVERDUE">Overdue</SelectItem>
            <SelectItem value="WAIVED">Waived</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Add fee form */}
      {showForm && (
        <Card className="border-0 shadow-sm border-l-4 border-l-halqa-500">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">Add Fee Record</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <Label>Student *</Label>
              <Select value={form.studentId || 'none'} onValueChange={v => setForm(f => ({ ...f, studentId: v === 'none' ? '' : v }))}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select student" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Select student</SelectItem>
                  {(students || []).map((s: any) => (
                    <SelectItem key={s.id} value={s.id}>{s.user?.firstName} {s.user?.lastName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Fee Type</Label>
              <Select value={form.feeType} onValueChange={v => setForm(f => ({ ...f, feeType: v }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['TUITION', 'REGISTRATION', 'EXAM', 'ACTIVITY', 'TRANSPORT', 'OTHER'].map(t => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Amount ($) *</Label>
              <Input className="mt-1" type="number" min="0" step="0.01" placeholder="0.00"
                value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
            </div>
            <div>
              <Label>Description</Label>
              <Input className="mt-1" placeholder="e.g., Term 1 Tuition"
                value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            </div>
            <div>
              <Label>Due Date</Label>
              <Input className="mt-1" type="date" value={form.dueDate}
                onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))} />
            </div>
            <div className="flex items-end gap-2">
              <Button onClick={() => createMutation.mutate(form)}
                disabled={!form.studentId || !form.amount || createMutation.isPending}
                className="bg-halqa-700 hover:bg-halqa-800">
                {createMutation.isPending ? 'Saving...' : 'Save'}
              </Button>
              <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Fees table */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-3">
              {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)}
            </div>
          ) : feesError ? (
            <div className="p-4"><ErrorState onRetry={refetchFees} /></div>
          ) : fees.length === 0 ? (
            <div className="text-center py-16 text-gray-500">
              <DollarSign className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p>No fee records found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Student</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Type</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Description</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-600">Amount</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Due Date</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                    {isAdmin && <th className="w-20 px-4 py-3" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {fees.map((fee: any) => {
                    const StatusIcon = STATUS_ICONS[fee.status] || Clock
                    return (
                      <tr key={fee.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium">
                          {fee.student?.user?.firstName} {fee.student?.user?.lastName}
                        </td>
                        <td className="px-4 py-3 text-gray-600">{fee.feeType}</td>
                        <td className="px-4 py-3 text-gray-500 truncate max-w-[200px]">{fee.description || '—'}</td>
                        <td className="px-4 py-3 text-right font-semibold">${Number(fee.amount).toFixed(2)}</td>
                        <td className="px-4 py-3 text-gray-500">
                          {fee.dueDate ? format(new Date(fee.dueDate), 'MMM d, yyyy') : '—'}
                        </td>
                        <td className="px-4 py-3">
                          <Badge className={`text-xs gap-1 ${STATUS_COLORS[fee.status] || ''}`}>
                            <StatusIcon className="w-3 h-3" />
                            {fee.status}
                          </Badge>
                        </td>
                        {isAdmin && (
                          <td className="px-4 py-3">
                            {fee.status === 'PENDING' || fee.status === 'OVERDUE' ? (
                              <Button size="sm" variant="outline"
                                onClick={() => markPaidMutation.mutate(fee.id)}
                                disabled={markPaidMutation.isPending}
                                className="text-xs text-green-600 border-green-200 hover:bg-green-50">
                                Mark Paid
                              </Button>
                            ) : null}
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
