'use client'

/**
 * Admin Content Moderation Queue
 *
 * Lists reported users/content and allows admins to review and take action.
 * Only accessible to SUPER_ADMIN (platform-level operation — F-1 fix).
 * SCHOOL_ADMIN cannot moderate platform-wide social reports.
 *
 * Backend:
 *   GET  /api/v1/report-block/reports
 *   PATCH /api/v1/report-block/reports/:id/review
 *
 * ARCH FIX (HALQA-ARCH-05): ACTION_TAKEN now has downstream enforcement.
 * When selecting ACTION_TAKEN, admin must choose a moderation action
 * (WARN / SUSPEND / BAN) which the backend applies to the reported user
 * and writes an audit log entry.
 */

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'
import { useAuthStore } from '@/store/auth.store'
import { useToast } from '@/components/ui/use-toast'
import { Button } from '@/components/ui/button'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Shield, AlertTriangle, CheckCircle, XCircle, Eye, Clock,
  Ban, AlertOctagon, Info,
} from 'lucide-react'

const STATUS_STYLES: Record<string, string> = {
  PENDING:      'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  REVIEWED:     'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  DISMISSED:    'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  ACTION_TAKEN: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  RESOLVED:     'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
}

const REASON_LABELS: Record<string, string> = {
  spam:            'Spam',
  harassment:      'Harassment',
  hate_speech:     'Hate speech',
  sexual_content:  'Sexual content',
  scam:            'Scam / Fraud',
  impersonation:   'Impersonation',
  underage:        'Underage user',
  other:           'Other',
  SPAM:            'Spam',
  HARASSMENT:      'Harassment',
  INAPPROPRIATE:   'Inappropriate content',
  HATE_SPEECH:     'Hate speech',
  IMPERSONATION:   'Impersonation',
  VIOLENCE:        'Violence',
  MISINFORMATION:  'Misinformation',
  OTHER:           'Other',
}

type ReviewStatus = 'REVIEWED' | 'DISMISSED' | 'ACTION_TAKEN' | ''
type ModerationAction = 'WARN' | 'SUSPEND' | 'BAN' | ''

export default function ModerationQueuePage() {
  const user        = useAuthStore(s => s.user)
  const { toast }   = useToast()
  const queryClient = useQueryClient()

  const [statusFilter, setStatusFilter] = useState('PENDING')
  const [selectedId, setSelectedId]     = useState<string | null>(null)
  const [reviewStatus, setReviewStatus] = useState<ReviewStatus>('')
  const [modAction, setModAction]       = useState<ModerationAction>('')
  const [adminNote, setAdminNote]       = useState('')

  // SUPER_ADMIN only — backend enforces 403, frontend guards before fetching
  const isAdmin = !!user && user.role === 'SUPER_ADMIN'

  const { data, isLoading } = useQuery({
    queryKey: ['moderation-reports', statusFilter],
    queryFn:  () => api.get(`/report-block/reports?status=${statusFilter}&limit=50`).then(r => r.data.data),
    refetchInterval: 30_000,
    enabled: isAdmin,
  })

  const reviewMutation = useMutation({
    mutationFn: ({ id, status, action, adminNote }: any) =>
      api.patch(`/report-block/reports/${id}/review`, { status, action: action || undefined, adminNote }),
    onSuccess: (_, vars) => {
      const desc = vars.action
        ? `${vars.status} — ${vars.action} applied to user.`
        : `Marked as ${vars.status.toLowerCase()}.`
      toast({ title: 'Report reviewed', description: desc })
      queryClient.invalidateQueries({ queryKey: ['moderation-reports'] })
      queryClient.invalidateQueries({ queryKey: ['admin-stats'] })
      resetPanel()
    },
    onError: (err: any) => {
      toast({ title: 'Action failed', description: err.response?.data?.message, variant: 'destructive' })
    }
  })

  function resetPanel() {
    setSelectedId(null)
    setReviewStatus('')
    setModAction('')
    setAdminNote('')
  }

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500">Access restricted to administrators.</p>
      </div>
    )
  }

  const reports      = Array.isArray(data) ? data : (data?.reports ?? [])
  const selectedReport = reports.find((r: any) => r.id === selectedId)
  const pendingCount   = reports.filter((r: any) => r.status === 'PENDING').length

  // Whether the submit button should be enabled
  const canSubmit =
    !!reviewStatus &&
    (reviewStatus !== 'ACTION_TAKEN' || !!modAction) &&
    !reviewMutation.isPending

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
            Review user reports and take moderation action. All actions are server-authorised and audited.
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
        <Select value={statusFilter} onValueChange={v => { setStatusFilter(v); resetPanel() }}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="PENDING">Pending</SelectItem>
            <SelectItem value="REVIEWED">Reviewed</SelectItem>
            <SelectItem value="ACTION_TAKEN">Action Taken</SelectItem>
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
              <p className="text-sm">No {statusFilter.toLowerCase().replace('_', ' ')} reports</p>
            </div>
          )}
          {reports.map((report: any) => (
            <button
              key={report.id}
              onClick={() => { setSelectedId(report.id); setReviewStatus(''); setModAction(''); setAdminNote('') }}
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
                  {report.status.replace('_', ' ')}
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
              {/* Report details */}
              <div className="space-y-2 text-sm">
                {[
                  ['Reporter', `${selectedReport.reporter?.firstName} ${selectedReport.reporter?.lastName}`],
                  ['Reported', `${selectedReport.reported?.firstName} ${selectedReport.reported?.lastName}`],
                  ['Reason',   REASON_LABELS[selectedReport.reason] ?? selectedReport.reason],
                  ['Status',   selectedReport.status.replace('_', ' ')],
                ].map(([label, val]) => (
                  <div key={label} className="flex justify-between">
                    <span className="text-gray-500">{label}</span>
                    <span className={`font-medium ${label === 'Status' ? `text-xs px-2 py-0.5 rounded-full ${STATUS_STYLES[selectedReport.status] ?? ''}` : ''}`}>
                      {val}
                    </span>
                  </div>
                ))}
                {selectedReport.description && (
                  <div>
                    <span className="text-gray-500 block mb-1">Description</span>
                    <p className="p-2 bg-gray-50 dark:bg-gray-800 rounded text-gray-700 dark:text-gray-300 text-xs">
                      {selectedReport.description}
                    </p>
                  </div>
                )}
              </div>

              {/* Action panel — only for PENDING reports */}
              {selectedReport.status === 'PENDING' && (
                <div className="space-y-4 pt-3 border-t border-gray-100 dark:border-gray-700">

                  {/* Step 1: Review outcome */}
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-2">
                      1. Review outcome
                    </p>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { val: 'REVIEWED',     label: 'Review',      icon: Info,          variant: 'blue' },
                        { val: 'DISMISSED',    label: 'Dismiss',     icon: XCircle,       variant: 'gray' },
                        { val: 'ACTION_TAKEN', label: 'Take Action', icon: AlertOctagon,  variant: 'red' },
                      ].map(opt => {
                        const Icon = opt.icon
                        const isSelected = reviewStatus === opt.val
                        return (
                          <button
                            key={opt.val}
                            onClick={() => { setReviewStatus(opt.val as ReviewStatus); setModAction('') }}
                            className={`flex flex-col items-center gap-1.5 p-2.5 rounded-lg border text-xs font-medium transition-all ${
                              isSelected
                                ? opt.variant === 'red'
                                  ? 'border-red-400 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300'
                                  : opt.variant === 'blue'
                                  ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                                  : 'border-gray-400 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300'
                                : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 text-gray-500'
                            }`}
                          >
                            <Icon className="w-4 h-4" />
                            {opt.label}
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  {/* Step 2: Enforcement action — only when ACTION_TAKEN selected */}
                  {reviewStatus === 'ACTION_TAKEN' && (
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-2">
                        2. Enforcement action
                      </p>
                      <div className="p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-200 mb-3 flex gap-2">
                        <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                        <span>
                          This action is <strong>server-enforced</strong> and creates an audit log.
                          It takes effect immediately and cannot be undone from this screen.
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        {[
                          { val: 'WARN',    label: 'Warn',    icon: AlertTriangle, color: 'yellow' },
                          { val: 'SUSPEND', label: 'Suspend', icon: AlertOctagon,  color: 'orange' },
                          { val: 'BAN',     label: 'Ban',     icon: Ban,           color: 'red' },
                        ].map(opt => {
                          const Icon = opt.icon
                          const isSelected = modAction === opt.val
                          const colorMap: Record<string, string> = {
                            yellow: 'border-yellow-400 bg-yellow-50 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300',
                            orange: 'border-orange-400 bg-orange-50 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300',
                            red:    'border-red-400 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300',
                          }
                          return (
                            <button
                              key={opt.val}
                              onClick={() => setModAction(opt.val as ModerationAction)}
                              className={`flex flex-col items-center gap-1.5 p-2.5 rounded-lg border text-xs font-medium transition-all ${
                                isSelected
                                  ? colorMap[opt.color]
                                  : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 text-gray-500'
                              }`}
                            >
                              <Icon className="w-4 h-4" />
                              {opt.label}
                            </button>
                          )
                        })}
                      </div>
                      {modAction === 'WARN' && (
                        <p className="text-xs text-gray-400 mt-2">
                          User status stays ACTIVE. Action is recorded in audit log only.
                        </p>
                      )}
                      {modAction === 'SUSPEND' && (
                        <p className="text-xs text-orange-600 dark:text-orange-400 mt-2">
                          User status → SUSPENDED. They cannot log in until restored by an admin.
                        </p>
                      )}
                      {modAction === 'BAN' && (
                        <p className="text-xs text-red-600 dark:text-red-400 mt-2">
                          User status → BANNED. Permanent ban. Requires admin to restore.
                        </p>
                      )}
                    </div>
                  )}

                  {/* Admin note */}
                  <div>
                    <label className="text-xs font-bold uppercase tracking-wider text-gray-400 block mb-2">
                      {reviewStatus === 'ACTION_TAKEN' ? '3.' : '2.'} Internal note (optional)
                    </label>
                    <Textarea
                      value={adminNote}
                      onChange={e => setAdminNote(e.target.value)}
                      placeholder="Internal note about this moderation decision…"
                      rows={2}
                      maxLength={500}
                      className="text-sm"
                    />
                  </div>

                  <Button
                    onClick={() => reviewMutation.mutate({
                      id:        selectedReport.id,
                      status:    reviewStatus,
                      action:    reviewStatus === 'ACTION_TAKEN' ? modAction : undefined,
                      adminNote,
                    })}
                    disabled={!canSubmit}
                    variant={reviewStatus === 'ACTION_TAKEN' && modAction === 'BAN' ? 'destructive' : 'default'}
                    className="w-full"
                  >
                    {reviewMutation.isPending
                      ? 'Submitting…'
                      : reviewStatus === 'ACTION_TAKEN' && modAction
                      ? `Apply: ${modAction}`
                      : reviewStatus
                      ? `Mark as ${reviewStatus.toLowerCase().replace('_', ' ')}`
                      : 'Select an outcome above'}
                  </Button>
                </div>
              )}

              {selectedReport.status !== 'PENDING' && (
                <p className="text-sm text-gray-400 text-center py-2">
                  This report has already been {selectedReport.status.toLowerCase().replace('_', ' ')}.
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
