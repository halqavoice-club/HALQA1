'use client'

/**
 * Admin — Platform Analytics
 * Route: /admin/analytics
 * Access: SUPER_ADMIN only
 * Data: GET /api/v1/admin/stats/analytics (real aggregated data)
 */

import { useQuery } from '@tanstack/react-query'
import api from '@/lib/api'
import { useAuthStore } from '@/store/auth.store'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { BarChart3, Users, GraduationCap, Rss, Video, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

function Metric({ label, value, sub }: { label: string; value: any; sub?: string }) {
  return (
    <div className="flex flex-col">
      <p className="text-xs text-gray-500 font-medium">{label}</p>
      <p className="text-2xl font-bold text-gray-900 dark:text-white mt-0.5">
        {typeof value === 'number' ? value.toLocaleString() : (value ?? '—')}
      </p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  )
}

export default function AdminAnalyticsPage() {
  const user    = useAuthStore(s => s.user)
  const isAdmin = user?.role === 'SUPER_ADMIN'

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['admin-analytics'],
    queryFn:  () => api.get('/admin/stats/analytics').then(r => r.data.data as {
      users:     { dau: number; wau: number; mau: number; newToday: number; newWeek: number; newMonth: number }
      social:    { totalPosts: number; postsWeek: number; totalCommunities: number }
      education: { totalSchools: number; activeSchools: number; totalStudents: number; totalTeachers: number }
      live:      { totalLiveClasses: number; totalVoiceRooms: number }
    }),
    refetchInterval: 120_000,
    enabled: isAdmin,
  })

  if (!isAdmin) return <div className="flex items-center justify-center h-64"><p className="text-gray-500">Access restricted.</p></div>

  const d = data

  return (
    <div className="max-w-5xl mx-auto py-8 px-4 space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BarChart3 className="w-6 h-6 text-indigo-500" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Platform Analytics</h1>
            <p className="text-sm text-gray-500">Aggregated platform metrics — all numbers are real DB counts</p>
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isLoading}>
          <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isLoading ? 'animate-spin' : ''}`} />Refresh
        </Button>
      </div>

      {isLoading && !d ? (
        <div className="space-y-4">
          {Array.from({length:4}).map((_,i) => <div key={i} className="h-32 bg-gray-100 dark:bg-gray-800 rounded-xl animate-pulse"/>)}
        </div>
      ) : (
        <div className="space-y-6">
          {/* Users */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2 text-gray-700 dark:text-gray-300">
                <Users className="w-4 h-4 text-indigo-500" /> User Activity
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-6">
                <Metric label="DAU (approx)"  value={d?.users?.dau}      sub="active today" />
                <Metric label="WAU (approx)"  value={d?.users?.wau}      sub="active 7 days" />
                <Metric label="MAU (approx)"  value={d?.users?.mau}      sub="active 30 days" />
                <Metric label="New Today"     value={d?.users?.newToday} />
                <Metric label="New This Week" value={d?.users?.newWeek} />
                <Metric label="New This Month"value={d?.users?.newMonth} />
              </div>
              <p className="text-xs text-gray-400 mt-3">
                DAU/WAU/MAU are approximated from lastLoginAt — users without recent logins are not counted.
              </p>
            </CardContent>
          </Card>

          {/* Social */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2 text-gray-700 dark:text-gray-300">
                <Rss className="w-4 h-4 text-blue-500" /> Social Activity
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-6">
                <Metric label="Total Posts"       value={d?.social?.totalPosts} />
                <Metric label="Posts This Week"   value={d?.social?.postsWeek} />
                <Metric label="Communities"       value={d?.social?.totalCommunities} />
              </div>
            </CardContent>
          </Card>

          {/* Education */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2 text-gray-700 dark:text-gray-300">
                <GraduationCap className="w-4 h-4 text-purple-500" /> Education
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
                <Metric label="Total Schools"   value={d?.education?.totalSchools} />
                <Metric label="Active Schools"  value={d?.education?.activeSchools} />
                <Metric label="Students"        value={d?.education?.totalStudents} sub="active memberships" />
                <Metric label="Teachers"        value={d?.education?.totalTeachers} sub="active memberships" />
              </div>
            </CardContent>
          </Card>

          {/* Live */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2 text-gray-700 dark:text-gray-300">
                <Video className="w-4 h-4 text-red-500" /> Live & Voice
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-6">
                <Metric label="Total Live Classes"  value={d?.live?.totalLiveClasses} sub="all-time" />
                <Metric label="Total Voice Rooms"   value={d?.live?.totalVoiceRooms}  sub="all-time" />
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
