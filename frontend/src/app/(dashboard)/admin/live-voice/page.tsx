'use client'

/**
 * Admin — Live & Voice Operational View
 * Route: /admin/live-voice
 * Access: SUPER_ADMIN only
 * Data: GET /api/v1/admin/stats/live-voice (real data)
 */

import { useQuery } from '@tanstack/react-query'
import api from '@/lib/api'
import { useAuthStore } from '@/store/auth.store'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useToast } from '@/components/ui/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Radio, Video, Users, Clock, RefreshCw, StopCircle } from 'lucide-react'
import { useState } from 'react'

function StatCard({ icon: Icon, label, value, color = 'indigo' }: any) {
  const c: Record<string, string> = {
    indigo: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400',
    green:  'bg-green-50 text-green-600 dark:bg-green-900/30 dark:text-green-400',
    red:    'bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400',
    blue:   'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400',
  }
  return (
    <Card>
      <CardContent className="p-5 flex items-start justify-between">
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{label}</p>
          <p className="text-3xl font-bold text-gray-900 dark:text-white mt-1">{value}</p>
        </div>
        <div className={`p-3 rounded-xl ${c[color]}`}><Icon className="w-5 h-5" /></div>
      </CardContent>
    </Card>
  )
}

export default function AdminLiveVoicePage() {
  const user    = useAuthStore(s => s.user)
  const { toast } = useToast()
  const qc      = useQueryClient()
  const isAdmin = user?.role === 'SUPER_ADMIN'
  const [search, setSearch] = useState('')

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['admin-live-voice'],
    queryFn:  () => api.get('/admin/stats/live-voice').then(r => r.data.data as {
      live:  { active: number; total: number; participants: number; sessions: any[] }
      voice: { active: number; total: number; participants: number; rooms: any[] }
    }),
    refetchInterval: 30_000,
    enabled: isAdmin,
  })

  // End a live class (emergency admin action)
  // Sprint 2 fix — was using content-participation endpoint POST /live-classes/:id/end
  // which requires HOST/staff role. Now uses dedicated admin termination endpoint
  // that bypasses content auth and writes an audit log. (LS-GAP-001 / UIGAP-007)
  const endLiveMutation = useMutation({
    mutationFn: (id: string) => api.post(`/admin/actions/live-classes/${id}/terminate`, { reason: 'Admin terminated via dashboard' }),
    onSuccess: () => {
      toast({ title: 'Live class terminated' })
      qc.invalidateQueries({ queryKey: ['admin-live-voice'] })
    },
    onError: (e: any) => toast({ title: 'Failed', description: e.response?.data?.message, variant: 'destructive' }),
  })

  // End a voice room (emergency admin action)
  // Sprint 2 fix — was using content-participation endpoint PATCH /voice/:id/end
  // which also requires the caller to be SUPER_ADMIN in voice.controller.js,
  // but through a route that has no IP allowlist. Now uses dedicated admin endpoint.
  const endVoiceMutation = useMutation({
    mutationFn: (id: string) => api.post(`/admin/actions/voice/${id}/terminate`, { reason: 'Admin terminated via dashboard' }),
    onSuccess: () => {
      toast({ title: 'Voice room archived' })
      qc.invalidateQueries({ queryKey: ['admin-live-voice'] })
    },
    onError: (e: any) => toast({ title: 'Failed', description: e.response?.data?.message, variant: 'destructive' }),
  })

  if (!isAdmin) return <div className="flex items-center justify-center h-64"><p className="text-gray-500">Access restricted.</p></div>

  const liveSessions = (data?.live?.sessions ?? []).filter((s: any) =>
    !search || s.title?.toLowerCase().includes(search.toLowerCase())
  )
  const voiceRooms = (data?.voice?.rooms ?? []).filter((r: any) =>
    !search || r.title?.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="max-w-6xl mx-auto py-8 px-4 space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Radio className="w-6 h-6 text-red-500" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Live & Voice</h1>
            <p className="text-sm text-gray-500">Platform-wide operational view — real-time data</p>
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isLoading}>
          <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isLoading ? 'animate-spin' : ''}`} />Refresh
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard icon={Video}  label="Active Live"      value={data?.live?.active  ?? 0} color="red" />
        <StatCard icon={Users}  label="Live Participants" value={data?.live?.participants ?? 0} color="indigo" />
        <StatCard icon={Radio}  label="Active Voice"     value={data?.voice?.active ?? 0} color="green" />
        <StatCard icon={Users}  label="Voice Listeners"  value={data?.voice?.participants ?? 0} color="blue" />
      </div>

      {/* Search */}
      <Input
        placeholder="Search by room/session title…"
        value={search}
        onChange={e => setSearch(e.target.value)}
        className="max-w-sm"
      />

      {/* Live Classes */}
      <section>
        <h2 className="text-sm font-bold uppercase tracking-widest text-gray-400 mb-3 flex items-center gap-2">
          <Video className="w-4 h-4 text-red-500" />
          Active Live Classes ({liveSessions.length})
        </h2>
        {isLoading ? (
          <div className="space-y-2">{Array.from({length:3}).map((_,i) => <div key={i} className="h-14 bg-gray-100 dark:bg-gray-800 rounded-xl animate-pulse"/>)}</div>
        ) : liveSessions.length === 0 ? (
          <div className="text-center py-10 text-gray-400 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-xl">
            <Video className="w-8 h-8 mx-auto mb-2 opacity-40"/>
            <p className="text-sm">No active live classes</p>
          </div>
        ) : (
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">Session</th>
                  <th className="text-center px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">Participants</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">Started</th>
                  <th className="px-4 py-3"/>
                </tr>
              </thead>
              <tbody>
                {liveSessions.map((s: any) => (
                  <tr key={s.id} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/40">
                    <td className="px-4 py-3">
                      <p className="font-medium truncate max-w-xs">{s.title}</p>
                      <p className="text-xs text-gray-400 font-mono">{s.id.slice(0,8)}…</p>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="flex items-center justify-center gap-1 text-gray-700 dark:text-gray-300">
                        <Users className="w-3.5 h-3.5"/>
                        {s._count?.participants ?? 0}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs">
                      {new Date(s.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        size="sm" variant="outline"
                        className="text-red-600 border-red-200 hover:bg-red-50"
                        onClick={() => { if(confirm('End this live class?')) endLiveMutation.mutate(s.id) }}
                        disabled={endLiveMutation.isPending}
                      >
                        <StopCircle className="w-3.5 h-3.5 mr-1"/>End
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Voice Rooms */}
      <section>
        <h2 className="text-sm font-bold uppercase tracking-widest text-gray-400 mb-3 flex items-center gap-2">
          <Radio className="w-4 h-4 text-green-500" />
          Active Voice Rooms ({voiceRooms.length})
        </h2>
        {isLoading ? (
          <div className="space-y-2">{Array.from({length:3}).map((_,i) => <div key={i} className="h-14 bg-gray-100 dark:bg-gray-800 rounded-xl animate-pulse"/>)}</div>
        ) : voiceRooms.length === 0 ? (
          <div className="text-center py-10 text-gray-400 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-xl">
            <Radio className="w-8 h-8 mx-auto mb-2 opacity-40"/>
            <p className="text-sm">No active voice rooms</p>
          </div>
        ) : (
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">Room</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">Host</th>
                  <th className="text-center px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">Listeners</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">Privacy</th>
                  <th className="px-4 py-3"/>
                </tr>
              </thead>
              <tbody>
                {voiceRooms.map((r: any) => (
                  <tr key={r.id} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/40">
                    <td className="px-4 py-3">
                      <p className="font-medium truncate max-w-xs">{r.title}</p>
                      <p className="text-xs text-gray-400 font-mono">{r.id.slice(0,8)}…</p>
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                      {r.host?.firstName} {r.host?.lastName}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="flex items-center justify-center gap-1 text-gray-700 dark:text-gray-300">
                        <Users className="w-3.5 h-3.5"/>
                        {r._count?.participants ?? 0}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${r.privacy === 'PUBLIC' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'}`}>
                        {r.privacy}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        size="sm" variant="outline"
                        className="text-red-600 border-red-200 hover:bg-red-50"
                        onClick={() => { if(confirm('End this voice room?')) endVoiceMutation.mutate(r.id) }}
                        disabled={endVoiceMutation.isPending}
                      >
                        <StopCircle className="w-3.5 h-3.5 mr-1"/>End
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
