'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import api from '@/lib/api'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { DataTable, Column } from '@/components/ui/data-table'
import { Pagination } from '@/components/ui/pagination'
import { ErrorState } from '@/components/ui/error-state'
import { Shield } from 'lucide-react'
import { format } from 'date-fns'

const ACTION_COLORS: Record<string, string> = {
  CREATE: 'bg-green-100 text-green-700',
  UPDATE: 'bg-blue-100 text-blue-700',
  DELETE: 'bg-red-100 text-red-700',
  LOGIN: 'bg-purple-100 text-purple-700',
  LOGOUT: 'bg-gray-100 text-gray-700',
  EXPORT: 'bg-yellow-100 text-yellow-700',
  IMPORT: 'bg-orange-100 text-orange-700',
  VIEW: 'bg-slate-100 text-slate-700'
}

const COLUMNS: Column<any>[] = [
  {
    key: 'createdAt',
    header: 'Time',
    sortable: true,
    render: (row) => (
      <span className="text-xs text-gray-500 whitespace-nowrap">
        {format(new Date(row.createdAt), 'MMM d, yyyy HH:mm:ss')}
      </span>
    )
  },
  {
    key: 'user',
    header: 'User',
    render: (row) => row.user ? (
      <div>
        <p className="font-medium text-gray-900 text-xs">{row.user.firstName} {row.user.lastName}</p>
        <p className="text-gray-400 text-xs">{row.user.email}</p>
      </div>
    ) : <span className="text-gray-400 text-xs">System</span>
  },
  {
    key: 'action',
    header: 'Action',
    sortable: true,
    render: (row) => (
      <Badge className={`text-xs ${ACTION_COLORS[row.action] || 'bg-gray-100 text-gray-700'}`}>
        {row.action}
      </Badge>
    )
  },
  {
    key: 'entity',
    header: 'Entity',
    sortable: true,
    render: (row) => (
      <div>
        <span className="text-gray-700 font-medium text-sm">{row.entity}</span>
        {row.entityId && (
          <p className="text-gray-400 text-xs font-mono">{row.entityId.substring(0, 8)}...</p>
        )}
      </div>
    )
  },
  {
    key: 'ipAddress',
    header: 'IP Address',
    render: (row) => (
      <span className="text-gray-500 text-xs font-mono">{row.ipAddress || '—'}</span>
    )
  }
]

export default function AuditPage() {
  const [page, setPage] = useState(1)
  const [action, setAction] = useState('')
  const [entity, setEntity] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['audit', page, action, entity, startDate, endDate],
    queryFn: () => api.get('/audit', {
      params: { page, limit: 50, action: action || undefined, entity: entity || undefined, startDate: startDate || undefined, endDate: endDate || undefined }
    }).then(r => r.data)
  })

  const logs = data?.data || []
  const pagination = data?.pagination

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Shield className="w-6 h-6 text-halqa-700" /> Audit Logs
        </h1>
        <p className="text-gray-500 text-sm">Track all system actions and changes</p>
      </div>

      {/* Filters */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <Label>Action</Label>
              <Select value={action || 'all'} onValueChange={v => { setAction(v === 'all' ? '' : v); setPage(1) }}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="All actions" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Actions</SelectItem>
                  {Object.keys(ACTION_COLORS).map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Entity</Label>
              <Input className="mt-1" placeholder="e.g., students" value={entity}
                onChange={e => { setEntity(e.target.value); setPage(1) }} />
            </div>
            <div>
              <Label>Start Date</Label>
              <Input type="date" className="mt-1" value={startDate} onChange={e => setStartDate(e.target.value)} />
            </div>
            <div>
              <Label>End Date</Label>
              <Input type="date" className="mt-1" value={endDate} onChange={e => setEndDate(e.target.value)} />
            </div>
          </div>
        </CardContent>
      </Card>

      {isError ? (
        <ErrorState onRetry={refetch} />
      ) : (
        <>
          <DataTable
            columns={COLUMNS}
            data={logs}
            isLoading={isLoading}
            emptyMessage="No audit logs found"
          />
          {pagination && pagination.totalPages > 1 && (
            <Pagination
              page={pagination.page}
              totalPages={pagination.totalPages}
              total={pagination.total}
              limit={pagination.limit}
              onPageChange={setPage}
            />
          )}
        </>
      )}
    </div>
  )
}
