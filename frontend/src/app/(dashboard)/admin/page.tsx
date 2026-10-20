'use client'

/**
 * Super Admin Dashboard — Platform overview
 * Route: /admin
 * Access: SUPER_ADMIN only
 */

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import api from '@/lib/api'
import { useAuthStore } from '@/store/auth.store'
import {
  Users, School, Video, Shield, FileText, Megaphone,
  AlertTriangle, TrendingUp, Activity, ArrowRight,
  CheckCircle, XCircle, Clock, RefreshCw,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  color = 'indigo',
  href,
}: {
  icon: React.ElementType
  label: string
  value: number | string
  sub?: string
  color?: string
  href?: string
}) {
  const colorMap: Record<string, string> = {
    indigo: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400',
    green:  'bg-green-50 text-green-600 dark:bg-green-900/30 dark:text-green-400',
    red:    'bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400',
    yellow: 'bg-yellow-50 text-yellow-600 dark:bg-yellow-900/30 dark:text-yellow-400',
    purple: 'bg-purple-50 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400',
    blue:   'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400',
  }

  const inner = (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">{label}</p>
            <p className="text-3xl font-bold text-gray-900 dark:text-white mt-1">
              {typeof value === 'number' ? value.toLocaleString() : value}
            </p>
            {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
          </div>
          <div className={`p-3 rounded-xl ${colorMap[color] ?? colorMap.indigo}`}>
            <Icon className="w-5 h-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  )

  return href ? <Link href={href}>{inner}</Link> : inner
}

export default function AdminDashboardPage() {
  const user = useAuthStore(s => s.user)
  const isAdmin = user?.role === 'SUPER_ADMIN'

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['admin-stats'],
    queryFn: () => api.get('/admin/stats').then(r => r.data.data),
    refetchInterval: 60_000,
    retry: 2,
    enabled: isAdmin,
  })

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500">Access restricted to platform administrators.</p>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="max-w-6xl mx-auto py-8 px-4 space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-28 bg-gray-100 dark:bg-gray-800 rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  if (isError) {
    const errMsg = (error as any)?.response?.data?.message
      || (error as any)?.message
      || 'Unknown error'
    const status = (error as any)?.response?.status
    return (
      <div className="max-w-6xl mx-auto py-8 px-4 space-y-4">
        <div className="flex items-start gap-3 text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20 p-5 rounded-xl border border-red-200 dark:border-red-800">
          <XCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <div className="space-y-2 flex-1">
            <p className="font-semibold">Admin stats failed to load</p>
            <p className="text-sm">{errMsg}</p>
            {status && <p className="text-xs font-mono text-red-500">HTTP {status}</p>}
            <div className="text-xs text-red-600 dark:text-red-400 space-y-1 mt-2 border-t border-red-200 dark:border-red-800 pt-2">
              <p className="font-semibold">Checklist:</p>
              <p>1. Backend running on port 5000? → <code className="font-mono bg-red-100 dark:bg-red-900/40 px-1 rounded">http://localhost:5000/health/liveness</code></p>
              <p>2. High memory? → Stop any running Jest tests, then restart backend with: <code className="font-mono bg-red-100 dark:bg-red-900/40 px-1 rounded">npm run dev</code></p>
              <p>3. After restart, run: <code className="font-mono bg-red-100 dark:bg-red-900/40 px-1 rounded">npx prisma generate</code></p>
            </div>
            <button
              onClick={() => refetch()}
              className="mt-2 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-medium transition-colors"
            >
              Retry
            </button>
          </div>
        </div>

        {/* Still show the section links so admin can navigate even if stats fail */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[
            { href: '/admin/users',        icon: Users,          title: 'User Management',     color: 'indigo' },
            { href: '/admin/schools',       icon: School,         title: 'School Management',   color: 'purple' },
            { href: '/admin/moderation',    icon: AlertTriangle,  title: 'Content Moderation',  color: 'red' },
            { href: '/admin/audit-logs',    icon: Shield,         title: 'Audit Logs',          color: 'blue' },
            { href: '/admin/system-health', icon: Activity,       title: 'System Health',       color: 'green' },
            { href: '/admin/admins',        icon: Shield,         title: 'Admin Provisioning',  color: 'yellow' },
          ].map(item => {
            const Icon = item.icon
            const colorMap: Record<string, string> = {
              indigo: 'text-indigo-500', purple: 'text-purple-500', red: 'text-red-500',
              blue: 'text-blue-500', green: 'text-green-500', yellow: 'text-yellow-500',
            }
            return (
              <Link key={item.href} href={item.href}>
                <Card className="hover:shadow-md transition-all cursor-pointer">
                  <CardContent className="p-4 flex items-center gap-3">
                    <div className={colorMap[item.color]}><Icon className="w-5 h-5" /></div>
                    <p className="font-medium text-sm">{item.title}</p>
                    <ArrowRight className="w-4 h-4 text-gray-300 ml-auto" />
                  </CardContent>
                </Card>
              </Link>
            )
          })}
        </div>
      </div>
    )
  }

  const s = data

  return (
    <div className="max-w-6xl mx-auto py-8 px-4 space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Shield className="w-6 h-6 text-indigo-500" />
            Platform Administration
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Super Admin control panel · Last updated{' '}
            {s?.generatedAt ? new Date(s.generatedAt).toLocaleTimeString() : '—'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {s?.moderation?.pendingReports > 0 && (
            <Link
              href="/admin/moderation"
              className="flex items-center gap-2 px-3 py-2 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 rounded-lg hover:bg-red-100 transition-colors"
            >
              <AlertTriangle className="w-4 h-4" />
              <span className="text-sm font-semibold">{s.moderation.pendingReports} pending reports</span>
            </Link>
          )}
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-600 transition-colors"
            title="Refresh stats"
          >
            <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Users */}
      <section>
        <h2 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">Users</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard icon={Users}        label="Total Users"    value={s?.users?.total ?? 0}       color="indigo" href="/admin/users" />
          <StatCard icon={CheckCircle}  label="Active"         value={s?.users?.active ?? 0}      color="green" />
          <StatCard icon={XCircle}      label="Suspended/Banned" value={s?.users?.suspended ?? 0} color="red" />
          <StatCard icon={TrendingUp}   label="New (30 days)"  value={s?.users?.newLast30d ?? 0}  color="blue"
            sub={`${s?.users?.newLast7d ?? 0} in last 7 days`} />
        </div>
      </section>

      {/* Schools */}
      <section>
        <h2 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">Schools</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard icon={School}   label="Total Schools"  value={s?.schools?.total ?? 0}        color="purple" href="/admin/schools" />
          <StatCard icon={Activity} label="Active Schools" value={s?.schools?.active ?? 0}       color="green" />
          <StatCard icon={Users}    label="Total Members"  value={s?.schools?.totalMembers ?? 0} color="indigo" />
          <StatCard icon={FileText} label="Total Classes"  value={s?.schools?.totalClasses ?? 0} color="blue" />
        </div>
      </section>

      {/* Platform */}
      <section>
        <h2 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">Platform Activity</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard icon={Video}       label="Live Now"        value={s?.liveClasses?.active ?? 0}  color="red"
            sub={`${s?.liveClasses?.total ?? 0} total streams`} />
          <StatCard icon={AlertTriangle} label="Pending Reports" value={s?.moderation?.pendingReports ?? 0} color="yellow" href="/admin/moderation" />
          <StatCard icon={Shield}      label="Audit Logs (7d)" value={s?.audit?.last7d ?? 0}        color="indigo" href="/admin/audit-logs"
            sub={`${(s?.audit?.total ?? 0).toLocaleString()} total`} />
          <StatCard icon={Clock}       label="Total Audit Logs" value={s?.audit?.total ?? 0}        color="blue" />
        </div>
      </section>

      {/* Quick access cards */}
      <section>
        <h2 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">Admin Sections</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[
            {
              href: '/admin/users',
              icon: Users,
              title: 'User Management',
              desc: 'View, search, suspend, or ban platform users.',
              color: 'indigo',
            },
            {
              href: '/admin/schools',
              icon: School,
              title: 'School Management',
              desc: 'Activate or deactivate schools, view membership counts.',
              color: 'purple',
            },
            {
              href: '/admin/moderation',
              icon: AlertTriangle,
              title: 'Content Moderation',
              desc: `Review flagged reports. ${s?.moderation?.pendingReports > 0 ? `${s.moderation.pendingReports} pending.` : 'Queue is clear.'}`,
              color: 'red',
            },
            {
              href: '/admin/audit-logs',
              icon: Shield,
              title: 'Audit Logs',
              desc: 'Platform-wide action trail. All admin and user actions logged.',
              color: 'blue',
            },
            {
              href: '/admin/announcements',
              icon: Megaphone,
              title: 'Announcements',
              desc: 'View all school announcements across the platform.',
              color: 'green',
            },
            {
              href: '/admin/admins',
              icon: Shield,
              title: 'Admin Provisioning',
              desc: 'Grant or revoke SUPER_ADMIN platform access.',
              color: 'yellow',
            },
          ].map(item => {
            const Icon = item.icon
            const colorMap: Record<string, string> = {
              indigo: 'text-indigo-500',
              purple: 'text-purple-500',
              red:    'text-red-500',
              blue:   'text-blue-500',
              green:  'text-green-500',
              yellow: 'text-yellow-500',
            }
            return (
              <Link key={item.href} href={item.href}>
                <Card className="hover:shadow-md hover:border-indigo-300 dark:hover:border-indigo-600 transition-all cursor-pointer h-full">
                  <CardContent className="p-5 flex items-start gap-4">
                    <div className={`mt-0.5 ${colorMap[item.color] ?? 'text-indigo-500'}`}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm text-gray-900 dark:text-white">{item.title}</p>
                      <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{item.desc}</p>
                    </div>
                    <ArrowRight className="w-4 h-4 text-gray-300 flex-shrink-0 mt-0.5" />
                  </CardContent>
                </Card>
              </Link>
            )
          })}
        </div>
      </section>
    </div>
  )
}
