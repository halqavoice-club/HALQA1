'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'
import { useToast } from '@/components/ui/use-toast'
import { getAvatarUrl } from '@/lib/avatar'
import { cn } from '@/lib/utils'
import { Flag, Loader2, ArrowLeft, CheckCircle, XCircle, AlertTriangle, ChevronDown } from 'lucide-react'
import Link from 'next/link'

interface UserReport {
  id:          string
  reason:      string
  description: string | null
  status:      'PENDING' | 'REVIEWED' | 'DISMISSED' | 'ACTION_TAKEN'
  createdAt:   string
  reporter:    { id: string; firstName: string; lastName: string; avatarUrl: string | null }
  reported:    { id: string; firstName: string; lastName: string; avatarUrl: string | null; role: string }
}

const STATUS_OPTS = ['PENDING', 'REVIEWED', 'DISMISSED', 'ACTION_TAKEN'] as const
type ReportStatus = typeof STATUS_OPTS[number]

const STATUS_CFG: Record<ReportStatus, { label: string; cls: string; icon: React.ReactNode }> = {
  PENDING:      { label: 'Pending',      cls: 'bg-yellow-100 text-yellow-700', icon: <AlertTriangle className="w-3 h-3" /> },
  REVIEWED:     { label: 'Reviewed',     cls: 'bg-blue-100 text-blue-700',     icon: <CheckCircle   className="w-3 h-3" /> },
  DISMISSED:    { label: 'Dismissed',    cls: 'bg-gray-100 text-gray-500',     icon: <XCircle       className="w-3 h-3" /> },
  ACTION_TAKEN: { label: 'Action Taken', cls: 'bg-red-100 text-red-600',       icon: <Flag          className="w-3 h-3" /> },
}

const REASON_LABELS: Record<string, string> = {
  spam:            'Spam',
  harassment:      'Harassment',
  hate_speech:     'Hate speech',
  sexual_content:  'Inappropriate content',
  scam:            'Scam / fraud',
  impersonation:   'Impersonation',
  other:           'Other',
}

function Avatar({ u }: { u: { firstName: string; lastName: string; avatarUrl: string | null } }) {
  const src = getAvatarUrl(u.avatarUrl)
  return (
    <div className="w-8 h-8 rounded-full overflow-hidden bg-gray-100 flex items-center justify-center text-xs font-bold text-gray-500 flex-shrink-0">
      {src
        ? <img src={src} alt="" className="w-full h-full object-cover" />
        : `${u.firstName[0]}${u.lastName[0]}`}
    </div>
  )
}

function ReportRow({ report, onReview }: {
  report: UserReport
  onReview: (id: string, status: ReportStatus) => void
}) {
  const [open, setOpen] = useState(false)
  const cfg = STATUS_CFG[report.status]

  return (
    <div className="border border-gray-100 rounded-2xl overflow-hidden">
      {/* Summary row */}
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-3 p-4 hover:bg-gray-50 transition-colors text-left"
      >
        {/* Reported user */}
        <Avatar u={report.reported} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-gray-800">
              {report.reported.firstName} {report.reported.lastName}
            </p>
            <span className={cn(
              'inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full',
              cfg.cls
            )}>
              {cfg.icon} {cfg.label}
            </span>
          </div>
          <p className="text-xs text-gray-400 mt-0.5">
            <span className="font-medium text-gray-600">{REASON_LABELS[report.reason] ?? report.reason}</span>
            {' · '}reported by {report.reporter.firstName} {report.reporter.lastName}
            {' · '}{new Date(report.createdAt).toLocaleDateString()}
          </p>
        </div>
        <ChevronDown className={cn('w-4 h-4 text-gray-400 flex-shrink-0 transition-transform', open && 'rotate-180')} />
      </button>

      {/* Expanded */}
      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-gray-50">
          {/* Reporter + reported */}
          <div className="grid grid-cols-2 gap-3 pt-3">
            <div className="bg-gray-50 rounded-xl p-3">
              <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wide mb-1.5">Reporter</p>
              <div className="flex items-center gap-2">
                <Avatar u={report.reporter} />
                <div>
                  <p className="text-xs font-semibold text-gray-700">
                    {report.reporter.firstName} {report.reporter.lastName}
                  </p>
                  <Link href={`/social/profile/${report.reporter.id}`} className="text-[10px] text-indigo-500 hover:underline">
                    View profile →
                  </Link>
                </div>
              </div>
            </div>
            <div className="bg-gray-50 rounded-xl p-3">
              <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wide mb-1.5">Reported User</p>
              <div className="flex items-center gap-2">
                <Avatar u={report.reported} />
                <div>
                  <p className="text-xs font-semibold text-gray-700">
                    {report.reported.firstName} {report.reported.lastName}
                  </p>
                  <Link href={`/social/profile/${report.reported.id}`} className="text-[10px] text-indigo-500 hover:underline">
                    View profile →
                  </Link>
                </div>
              </div>
            </div>
          </div>

          {/* Description */}
          {report.description && (
            <div className="bg-orange-50 border border-orange-100 rounded-xl px-3 py-2">
              <p className="text-[10px] text-orange-600 font-bold uppercase tracking-wide mb-0.5">Description</p>
              <p className="text-xs text-gray-700">{report.description}</p>
            </div>
          )}

          {/* Review actions */}
          {report.status === 'PENDING' && (
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => onReview(report.id, 'REVIEWED')}
                className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-xl transition-colors font-semibold"
              >
                <CheckCircle className="w-3.5 h-3.5" /> Mark Reviewed
              </button>
              <button
                onClick={() => onReview(report.id, 'ACTION_TAKEN')}
                className="flex items-center gap-1.5 text-xs text-red-600 hover:text-red-700 bg-red-50 hover:bg-red-100 px-3 py-1.5 rounded-xl transition-colors font-semibold"
              >
                <Flag className="w-3.5 h-3.5" /> Action Taken
              </button>
              <button
                onClick={() => onReview(report.id, 'DISMISSED')}
                className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-xl transition-colors font-semibold"
              >
                <XCircle className="w-3.5 h-3.5" /> Dismiss
              </button>
            </div>
          )}
          {report.status !== 'PENDING' && (
            <button
              onClick={() => onReview(report.id, 'PENDING')}
              className="text-xs text-gray-400 hover:text-gray-600 underline"
            >
              Re-open as Pending
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default function UserReportsPage() {
  const { toast }     = useToast()
  const queryClient   = useQueryClient()
  const [filter, setFilter] = useState<'all' | ReportStatus>('all')

  const { data, isLoading } = useQuery<{ reports: UserReport[]; total: number }>({
    queryKey: ['user-reports', filter],
    queryFn:  () => api.get('/social/reports', {
      params: filter !== 'all' ? { status: filter } : {},
    }).then(r => r.data.data),
  })

  const reviewMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: ReportStatus }) =>
      api.patch(`/social/reports/${id}/review`, { status }),
    onSuccess: () => {
      toast({ title: 'Report updated' })
      queryClient.invalidateQueries({ queryKey: ['user-reports'] })
    },
    onError: (e: any) => toast({ title: e?.response?.data?.message || 'Failed', variant: 'destructive' }),
  })

  const reports  = data?.reports ?? []
  const pending  = reports.filter(r => r.status === 'PENDING').length

  return (
    <div className="space-y-5 max-w-2xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/users" className="p-2 rounded-xl hover:bg-gray-100 transition-colors">
          <ArrowLeft className="w-4 h-4 text-gray-500" />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <Flag className="w-5 h-5 text-orange-500" />
            User Reports
            {pending > 0 && (
              <span className="text-xs font-bold bg-orange-500 text-white px-2 py-0.5 rounded-full">
                {pending} pending
              </span>
            )}
          </h1>
          <p className="text-sm text-gray-400">{data?.total ?? 0} total reports</p>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 flex-wrap">
        {(['all', ...STATUS_OPTS] as const).map(s => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={cn(
              'px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors',
              filter === s
                ? 'bg-indigo-600 text-white'
                : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
            )}
          >
            {s === 'all' ? 'All' : STATUS_CFG[s].label}
          </button>
        ))}
      </div>

      {/* Report list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-gray-300" />
        </div>
      ) : reports.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Flag className="w-10 h-10 mx-auto mb-3 opacity-20" />
          <p className="font-medium">No reports {filter !== 'all' ? `with status "${filter}"` : ''}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {reports.map(r => (
            <ReportRow
              key={r.id}
              report={r}
              onReview={(id, status) => reviewMutation.mutate({ id, status })}
            />
          ))}
        </div>
      )}
    </div>
  )
}
