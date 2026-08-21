'use client'

/**
 * Admin — System Health
 * Route: /admin/system-health
 * Access: SUPER_ADMIN only
 * Data source: GET /api/v1/health/detailed (real health checks — database, redis, livekit, memory, event loop)
 */

import { useQuery } from '@tanstack/react-query'
import api from '@/lib/api'
import { useAuthStore } from '@/store/auth.store'
import { Activity, CheckCircle, XCircle, AlertTriangle, RefreshCw, Clock } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

type HealthStatus = 'ok' | 'warning' | 'critical' | 'error' | 'disconnected' | 'not_configured' | 'degraded' | 'unknown'

function StatusBadge({ status }: { status: HealthStatus }) {
  const map: Record<HealthStatus, { label: string; cls: string; icon: React.ElementType }> = {
    ok:             { label: 'Healthy',       cls: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',   icon: CheckCircle },
    warning:        { label: 'Warning',       cls: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300', icon: AlertTriangle },
    critical:       { label: 'Critical',      cls: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',           icon: XCircle },
    error:          { label: 'Error',         cls: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',           icon: XCircle },
    disconnected:   { label: 'Disconnected',  cls: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300', icon: XCircle },
    not_configured: { label: 'Not Configured',cls: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',          icon: Clock },
    degraded:       { label: 'Degraded',      cls: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300', icon: AlertTriangle },
    unknown:        { label: 'Unknown',       cls: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',          icon: Clock },
  }
  const cfg = map[status] ?? map.unknown
  const Icon = cfg.icon
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${cfg.cls}`}>
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  )
}

function HealthCard({ title, check }: { title: string; check: any }) {
  if (!check) return null
  const status: HealthStatus = check.status ?? 'unknown'
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between mb-3">
          <p className="font-semibold text-sm text-gray-900 dark:text-white">{title}</p>
          <StatusBadge status={status} />
        </div>
        <div className="space-y-1 text-xs text-gray-500">
          {check.latencyMs !== undefined && (
            <div className="flex justify-between">
              <span>Latency</span>
              <span className="font-mono">{check.latencyMs}ms</span>
            </div>
          )}
          {check.heapUsedMb !== undefined && (
            <>
              <div className="flex justify-between">
                <span>Heap Used</span>
                <span className="font-mono">{check.heapUsedMb}MB / {check.heapTotalMb}MB</span>
              </div>
              <div className="flex justify-between">
                <span>Heap Usage</span>
                <span className="font-mono">{check.heapUsagePercent}%</span>
              </div>
              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5 mt-1">
                <div
                  className={`h-1.5 rounded-full ${check.heapUsagePercent > 90 ? 'bg-red-500' : check.heapUsagePercent > 75 ? 'bg-yellow-500' : 'bg-green-500'}`}
                  style={{ width: `${Math.min(100, check.heapUsagePercent)}%` }}
                />
              </div>
            </>
          )}
          {check.lagMs !== undefined && (
            <div className="flex justify-between">
              <span>Event Loop Lag</span>
              <span className="font-mono">{check.lagMs}ms</span>
            </div>
          )}
          {check.message && (
            <p className="text-gray-400 mt-1">{check.message}</p>
          )}
          {check.error && (
            <p className="text-red-400 mt-1">{check.error}</p>
          )}
          {check.openBreakers?.length > 0 && (
            <p className="text-orange-500">Open breakers: {check.openBreakers.join(', ')}</p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

export default function SystemHealthPage() {
  const user = useAuthStore(s => s.user)
  const isAdmin = user?.role === 'SUPER_ADMIN'

  const { data, isLoading, isError, refetch, dataUpdatedAt } = useQuery({
    queryKey: ['system-health'],
    queryFn: () => api.get('/health/detailed').then(r => r.data),
    refetchInterval: 30_000,
    enabled: isAdmin,
  })

  if (!isAdmin) {
    return <div className="flex items-center justify-center h-64"><p className="text-gray-500">Access restricted.</p></div>
  }

  const checks = data?.checks ?? {}
  const overall: HealthStatus = data?.status ?? 'unknown'

  return (
    <div className="max-w-4xl mx-auto py-8 px-4 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Activity className="w-6 h-6 text-green-500" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">System Health</h1>
            <p className="text-sm text-gray-500">
              Real infrastructure status ·{' '}
              {dataUpdatedAt ? `Updated ${new Date(dataUpdatedAt).toLocaleTimeString()}` : 'Loading…'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {data && <StatusBadge status={overall} />}
          <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isLoading}>
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {isError && (
        <div className="p-4 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 rounded-xl text-sm">
          Failed to fetch health status. The health endpoint may be unreachable.
        </div>
      )}

      {isLoading && !data ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-28 bg-gray-100 dark:bg-gray-800 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <HealthCard title="Database (MySQL)"   check={checks.database} />
            <HealthCard title="Cache (Redis)"      check={checks.redis} />
            <HealthCard title="LiveKit"            check={checks.livekit} />
            <HealthCard title="Memory"             check={checks.memory} />
            <HealthCard title="Event Loop"         check={checks.eventLoop} />
            <HealthCard title="Circuit Breakers"   check={checks.circuitBreakers} />
          </div>

          {/* Summary */}
          <div className="p-4 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 text-sm space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-gray-500 font-medium">Uptime</span>
              <span className="font-mono">{data?.uptime ? `${Math.floor(data.uptime / 3600)}h ${Math.floor((data.uptime % 3600) / 60)}m` : '—'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-500 font-medium">Startup Duration</span>
              <span className="font-mono">{data?.startupDuration ? `${(data.startupDuration / 1000).toFixed(1)}s` : '—'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-500 font-medium">Startup Complete</span>
              <span>{data?.startupComplete ? '✅ Yes' : '⏳ No'}</span>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
