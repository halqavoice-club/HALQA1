'use client'

/**
 * Admin — Platform Settings
 * Route: /admin/settings
 * Access: SUPER_ADMIN only
 *
 * NOTE: Platform-wide feature flags and config do not yet have a dedicated
 * backend settings table. This page shows the available configuration surface
 * and is marked clearly as to what is configurable via backend vs. what
 * requires env var changes. No fake toggles — every item indicates its source.
 */

import { useAuthStore } from '@/store/auth.store'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Settings, Info, AlertTriangle, CheckCircle, Code } from 'lucide-react'

interface SettingRow {
  label: string
  envVar?: string
  description: string
  source: 'env' | 'db' | 'code'
  status: 'configured' | 'not-configured' | 'code-controlled'
}

const SETTINGS: { section: string; items: SettingRow[] }[] = [
  {
    section: 'Authentication',
    items: [
      { label: 'JWT Secret',            envVar: 'JWT_SECRET',           description: 'Secret for signing access tokens', source: 'env', status: 'configured' },
      { label: 'JWT Refresh Secret',    envVar: 'JWT_REFRESH_SECRET',   description: 'Secret for signing refresh tokens', source: 'env', status: 'configured' },
      { label: 'Access Token Expiry',   envVar: 'JWT_EXPIRES_IN',       description: 'Default: 15m', source: 'env', status: 'configured' },
      { label: 'Refresh Token Expiry',  envVar: 'JWT_REFRESH_EXPIRES_IN', description: 'Default: 7d', source: 'env', status: 'configured' },
    ],
  },
  {
    section: 'Storage',
    items: [
      { label: 'Storage Type',          envVar: 'STORAGE_TYPE',        description: 'local | r2 — where uploads are stored', source: 'env', status: 'configured' },
      { label: 'Cloudflare R2 Bucket',  envVar: 'R2_BUCKET_NAME',      description: 'Required when STORAGE_TYPE=r2', source: 'env', status: 'configured' },
    ],
  },
  {
    section: 'Realtime & Media',
    items: [
      { label: 'LiveKit URL',           envVar: 'LIVEKIT_URL',         description: 'WebSocket URL for LiveKit server', source: 'env', status: 'configured' },
      { label: 'LiveKit API Key',       envVar: 'LIVEKIT_API_KEY',     description: 'LiveKit server API key (not shown)', source: 'env', status: 'configured' },
      { label: 'Redis URL',             envVar: 'REDIS_URL',           description: 'Redis connection for caching and queues', source: 'env', status: 'configured' },
    ],
  },
  {
    section: 'Payments',
    items: [
      { label: 'Stripe Publishable Key',envVar: 'STRIPE_PUBLISHABLE_KEY', description: 'Frontend Stripe key', source: 'env', status: 'configured' },
      { label: 'Stripe Secret Key',     envVar: 'STRIPE_SECRET_KEY',      description: 'Backend Stripe key (never shown)', source: 'env', status: 'configured' },
      { label: 'Stripe Webhook Secret', envVar: 'STRIPE_WEBHOOK_SECRET',  description: 'Webhook signature validation', source: 'env', status: 'configured' },
    ],
  },
  {
    section: 'Email',
    items: [
      { label: 'SMTP Host',   envVar: 'SMTP_HOST', description: 'Email server hostname', source: 'env', status: 'configured' },
      { label: 'SMTP User',   envVar: 'SMTP_USER', description: 'Email sender address', source: 'env', status: 'configured' },
      { label: 'Email From',  envVar: 'EMAIL_FROM', description: 'Sender display address', source: 'env', status: 'configured' },
    ],
  },
  {
    section: 'Security',
    items: [
      { label: 'Admin IP Allowlist',  envVar: 'ADMIN_IP_ALLOWLIST', description: 'Comma-separated IPs allowed to call /api/v1/internal. Empty = all IPs allowed.', source: 'env', status: 'configured' },
      { label: 'Client URL(s)',       envVar: 'CLIENT_URL',         description: 'Comma-separated allowed CORS origins', source: 'env', status: 'configured' },
      { label: 'DM Non-Friends',      envVar: 'ALLOW_DM_NON_FRIENDS', description: 'true = anyone can DM anyone (default: false)', source: 'env', status: 'configured' },
    ],
  },
  {
    section: 'Feature Flags',
    items: [
      { label: 'Feature Flag System', description: 'Managed via featureFlags utility (backend/src/utils/featureFlags.js)', source: 'code', status: 'code-controlled' },
    ],
  },
]

const SOURCE_LABEL: Record<string, string> = {
  env:            'Environment Variable',
  db:             'Database',
  code:           'Code Controlled',
}

export default function AdminSettingsPage() {
  const user    = useAuthStore(s => s.user)
  const isAdmin = user?.role === 'SUPER_ADMIN'

  if (!isAdmin) return <div className="flex items-center justify-center h-64"><p className="text-gray-500">Access restricted.</p></div>

  return (
    <div className="max-w-4xl mx-auto py-8 px-4 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Settings className="w-6 h-6 text-gray-500" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Platform Settings</h1>
          <p className="text-sm text-gray-500">Configuration surface for the HALQA platform</p>
        </div>
      </div>

      {/* Notice */}
      <div className="flex items-start gap-2 p-4 bg-amber-50 dark:bg-amber-900/20 rounded-xl border border-amber-200 dark:border-amber-800 text-sm text-amber-800 dark:text-amber-200">
        <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold">Environment-controlled settings</p>
          <p className="text-xs mt-1">
            Most platform settings are controlled by environment variables in <code className="font-mono bg-amber-100 dark:bg-amber-900/40 px-1 rounded">backend/.env</code>.
            Changing them requires restarting the backend. Secrets are never displayed in this UI.
            Runtime feature flags are in <code className="font-mono bg-amber-100 dark:bg-amber-900/40 px-1 rounded">backend/src/utils/featureFlags.js</code>.
          </p>
        </div>
      </div>

      {/* Settings sections */}
      {SETTINGS.map(section => (
        <Card key={section.section}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-gray-700 dark:text-gray-300">{section.section}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {section.items.map(item => (
                <div key={item.label} className="flex items-start justify-between py-3 gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-gray-900 dark:text-white">{item.label}</p>
                      {item.envVar && (
                        <code className="text-[10px] font-mono bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded text-gray-500">
                          {item.envVar}
                        </code>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">{item.description}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] text-gray-400">{SOURCE_LABEL[item.source]}</span>
                    {item.status === 'configured' && (
                      <CheckCircle className="w-4 h-4 text-green-500" />
                    )}
                    {item.status === 'not-configured' && (
                      <AlertTriangle className="w-4 h-4 text-yellow-500" />
                    )}
                    {item.status === 'code-controlled' && (
                      <Code className="w-4 h-4 text-blue-400" />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}

      <div className="flex items-start gap-2 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-xl text-xs text-blue-700 dark:text-blue-300">
        <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
        <span>
          To change a setting: edit the corresponding environment variable, then restart the backend server.
          All configuration changes affecting security should be recorded in the audit log manually or via deployment notes.
          A future version will support runtime configuration stored in the database.
        </span>
      </div>
    </div>
  )
}
