'use client'

/**
 * Admin Content Moderation Queue
 *
 * Lists reported users/content and allows admins to review and take action.
 * Only accessible to SUPER_ADMIN and SCHOOL_ADMIN roles.
 * Backend: GET /api/v1/report-block/reports  +  PATCH /api/v1/report-block/reports/:id
 */

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'
import { useAuthStore } from '@/store/auth.store'
import { useToast } from '@/components/ui/use-toast'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Shield, AlertTriangle, CheckCircle, XCircle, Eye, Clock } from 'lucide-react'

const STATUS_STYLES: Record<string, string> = {
  PENDING:   'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  REVIEWED:  'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  RESOLVED:  'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  DISMISSED: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
}

const REASON_LABELS: Record<string, string> = {
  SPAM:            'Spam',
  HARASSMENT:      'Harassment',
  INAPPROPRIATE:   'Inappropriate content',
  HATE_SPEECH:     'Hate speech',
  IMPERSONATION:   'Impersonation',
  VIOLENCE:        'Violence',
  MISINFORMATION:  'Misinformation',
  OTHER:           'Other',
}

export default function ModerationQueuePage() {
  const user          = useAuthStore(s => s.user)
  const { toast }     = useToast()
  const queryClient   = useQueryClient()
  const [statusFilter, setStatusFilter] = useState('PENDING')
  const [selectedId, setSelectedId]     = useState<string | null>(null)
  const [action, setAction]             = useState<'RESOLVED' | 'DISMISSED' | ''>('')
  const [adminNote, setAdminNote]       = useState('')

  // Guard — admin only
  if (!user || !['SUPER_ADMIN', 'SCHOOL_ADMIN'].includes(user.role)) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500">Access restricted to administrators.</p>
      </div>
    )
  }

  // Fetch reports
  const { data, isLoading } = useQuery({
    queryKey: ['moderation-reports', statusFilter],
    queryFn:  () => api.get(`/report-block/reports?status=${statusFilter}&limit=50`).then(r => r.data.data),
    refetchInterval: 30_000, // refresh every 30s
  })

  const reports = Array.isArray(data) ? data : (data?.reports ?? [])

  // Review mutation
  const reviewMutation = useMutation({
    mutationFn: ({ id, action, adminNote }: any) =>
      api.patch(`/report-block/reports/${id}`, { action, adminNote }),
    onSuccess: () => {
      toast({ title: 'Report reviewed', description: `Marked as ${action.toLowerCase()}.` })
      queryClient.invalidateQueries({ queryKey: ['moderation-reports'] })
      setSelectedId(null)
      setAction('')
      setAdminNote('')
    },
    onError: (err: any) => {
      toast({ title: 'Action failed', description: err.response?.data?.message, variant: 'destructive' })
    }
  })

  const selectedReport = reports.find((r: any) => r.id === selectedId)
  const pendingCount   = reports.filter((r: any) => r.status === 'PENDING').length

  return (
    <div className="max-w-5xl mx-auto py-8 px-4 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Shield className="w-6 h-6 text-indigo-500" />
            Content Moderation Queue
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Review user reports and take action on flagged content.
          </p>
        </div>
        {pendingCount > 0 && (
          <div className="flex items-center gap-2 px-3 py-2 bg-red-50 dark:bg-red-900/20 rounded-lg">
            <AlertTriangle className="w-4 h-4 text-red-500" />
            <span className="text-sm font-semibold text-red-700 dark:text-red-300">
              {pendingCount} pending
            </span>
          </div>
        )}
      </div>

      {/* Filter */}
      <div className="flex items-center gap-3">
        <span className="text-sm text-gray-600 dark:text-gray-400">Status:</span>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="PENDING">Pending</SelectItem>
            <SelectItem value="REVIEWED">Reviewed</SelectItem>
            <SelectItem value="RESOLVED">Resolved</SelectItem>
            <SelectItem value="DISMISSED">Dismissed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Report list */}
        <div className="space-y-3">
          {isLoading && (
            <div className="space-y-2">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-20 bg-gray-100 dark:bg-gray-800 rounded-xl animate-pulse" />
              ))}
            </div>
          )}
          {!isLoading && reports.length === 0 && (
            <div className="text-center py-12 text-gray-400">
              <CheckCircle className="w-10 h-10 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No {statusFilter.toLowerCase()} reports</p>
            </div>
          )}
          {reports.map((report: any) => (
            <button
              key={report.id}
              onClick={() => { setSelectedId(report.id); setAction(''); setAdminNote('') }}
              className={`w-full text-left p-4 rounded-xl border transition-all ${
                selectedId === report.id
                  ? 'border-indigo-400 bg-indigo-50 dark:bg-indigo-900/20'
                  : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-gray-300'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm text-gray-900 dark:text-white truncate">
                      {report.reporter?.firstName} {report.reporter?.lastName}
                    </span>
                    <span className="text-xs text-gray-400">→</span>
                    <span className="font-semibold text-sm text-gray-900 dark:text-white truncate">
                      {report.reported?.firstName} {report.reported?.lastName}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    {REASON_LABELS[report.reason] ?? report.reason}
                    {report.description && ` · "${report.description.slice(0, 50)}"`}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {new Date(report.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLES[report.status] ?? ''}`}>
                  {report.status}
                </span>
              </div>
            </button>
          ))}
        </div>

        {/* Review panel */}
        {selectedReport ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Eye className="w-4 h-4" /> Review Report
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Reporter</span>
                  <span className="font-medium">
                    {selectedReport.reporter?.firstName} {selectedReport.reporter?.lastName}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Reported</span>
                  <span className="font-medium">
                    {selectedReport.reported?.firstName} {selectedReport.reported?.lastName}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Reason</span>
                  <span className="font-medium">{REASON_LABELS[selectedReport.reason] ?? selectedReport.reason}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Status</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLES[selectedReport.status] ?? ''}`}>
                    {selectedReport.status}
                  </span>
                </div>
                {selectedReport.description && (
                  <div>
                    <span className="text-gray-500 block mb-1">Description</span>
                    <p className="p-2 bg-gray-50 dark:bg-gray-800 rounded text-gray-700 dark:text-gray-300">
                      {selectedReport.description}
                    </p>
                  </div>
                )}
                {selectedReport.adminNote && (
                  <div>
                    <span className="text-gray-500 block mb-1">Previous admin note</span>
                    <p className="p-2 bg-blue-50 dark:bg-blue-900/20 rounded text-blue-700 dark:text-blue-300 italic text-xs">
                      {selectedReport.adminNote}
                    </p>
                  </div>
                )}
              </div>

              {selectedReport.status === 'PENDING' && (
                <div className="space-y-3 pt-2 border-t border-gray-100 dark:border-gray-700">
                  <div>
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Action</label>
                    <div className="flex gap-2 mt-1">
                      <Button
                        size="sm"
                        variant={action === 'RESOLVED' ? 'default' : 'outline'}
                        onClick={() => setAction('RESOLVED')}
                        className="flex-1"
                      >
                        <CheckCircle className="w-3.5 h-3.5 mr-1" /> Resolve
                      </Button>
                      <Button
                        size="sm"
                        variant={action === 'DISMISSED' ? 'destructive' : 'outline'}
                        onClick={() => setAction('DISMISSED')}
                        className="flex-1"
                      >
                        <XCircle className="w-3.5 h-3.5 mr-1" /> Dismiss
                      </Button>
                    </div>
                  </div>

                  <div>
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      Admin note (optional)
                    </label>
                    <Textarea
                      value={adminNote}
                      onChange={e => setAdminNote(e.target.value)}
                      placeholder="Internal note about this report…"
                      rows={3}
                      maxLength={500}
                      className="mt-1 text-sm"
                    />
                  </div>

                  <Button
                    onClick={() => reviewMutation.mutate({ id: selectedReport.id, action, adminNote })}
                    disabled={!action || reviewMutation.isPending}
                    className="w-full"
                  >
                    {reviewMutation.isPending ? 'Submitting…' : `Mark as ${action || 'resolved/dismissed'}`}
                  </Button>
                </div>
              )}

              {selectedReport.status !== 'PENDING' && (
                <p className="text-sm text-gray-400 text-center py-2">
                  This report has already been {selectedReport.status.toLowerCase()}.
                </p>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="flex items-center justify-center h-64 text-gray-400 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-xl">
            <div className="text-center">
              <Clock className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">Select a report to review</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
