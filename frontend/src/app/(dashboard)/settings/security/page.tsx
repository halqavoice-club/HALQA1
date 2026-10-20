'use client'

/**
 * Security Settings Page — 2FA Setup / Disable
 *
 * Allows authenticated users to enable or disable TOTP-based 2FA.
 * Uses QRCode from the browser's native QR rendering via a data URI.
 * The backend /api/v1/auth/2fa/setup endpoint returns the otpAuthUrl
 * which we pass to a QR code library (qrcode.react if available, or
 * rendered as a text link for manual entry).
 */

import { useState } from 'react'
import { useAuthStore } from '@/store/auth.store'
import api from '@/lib/api'
import { useToast } from '@/components/ui/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ShieldCheck, ShieldOff, Copy, CheckCircle } from 'lucide-react'

export default function SecuritySettingsPage() {
  const user       = useAuthStore(s => s.user)
  const { toast }  = useToast()
  const [step, setStep] = useState<'idle' | 'setup' | 'verify' | 'backup' | 'disable'>('idle')
  const [secret, setSecret]         = useState('')
  const [otpAuthUrl, setOtpAuthUrl] = useState('')
  const [code, setCode]             = useState('')
  const [password, setPassword]     = useState('')
  const [backupCodes, setBackupCodes] = useState<string[]>([])
  const [loading, setLoading]       = useState(false)
  const [copied, setCopied]         = useState(false)

  const is2FAEnabled = (user as any)?.twoFactorEnabled === true

  async function handleSetup() {
    setLoading(true)
    try {
      const res = await api.post('/auth/2fa/setup')
      setSecret(res.data.data.secret)
      setOtpAuthUrl(res.data.data.otpAuthUrl)
      setStep('setup')
    } catch (err: any) {
      toast({ title: 'Setup failed', description: err.response?.data?.message, variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  async function handleVerify() {
    if (code.length !== 6) return
    setLoading(true)
    try {
      const res = await api.post('/auth/2fa/verify', { code })
      setBackupCodes(res.data.data.backupCodes || [])
      setStep('backup')
      toast({ title: '2FA enabled', description: 'Two-factor authentication is now active.' })
    } catch (err: any) {
      toast({ title: 'Verification failed', description: err.response?.data?.message || 'Invalid code', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  async function handleDisable() {
    setLoading(true)
    try {
      await api.post('/auth/2fa/disable', { password })
      setStep('idle')
      setPassword('')
      toast({ title: '2FA disabled' })
    } catch (err: any) {
      toast({ title: 'Failed', description: err.response?.data?.message, variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  function copySecret() {
    navigator.clipboard.writeText(secret)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="max-w-xl mx-auto py-8 px-4 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Security Settings</h1>
        <p className="text-sm text-gray-500 mt-1">Manage your account security preferences.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {is2FAEnabled
              ? <><ShieldCheck className="w-5 h-5 text-green-500" /> Two-Factor Authentication — Active</>
              : <><ShieldOff className="w-5 h-5 text-gray-400" /> Two-Factor Authentication — Disabled</>
            }
          </CardTitle>
          <CardDescription>
            {is2FAEnabled
              ? 'Your account is protected with TOTP two-factor authentication.'
              : 'Add an extra layer of security using an authenticator app (Google Authenticator, Authy, etc.).'
            }
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* ── Idle state ─────────────────────────────────────────── */}
          {step === 'idle' && !is2FAEnabled && (
            <Button onClick={handleSetup} disabled={loading}>
              {loading ? 'Setting up…' : 'Enable 2FA'}
            </Button>
          )}

          {step === 'idle' && is2FAEnabled && (
            <Button variant="destructive" onClick={() => setStep('disable')}>
              Disable 2FA
            </Button>
          )}

          {/* ── Setup: show secret + QR URI ────────────────────────── */}
          {step === 'setup' && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                Scan this secret with your authenticator app, or enter it manually:
              </p>
              <div className="flex items-center gap-2 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg font-mono text-sm break-all">
                <span className="flex-1">{secret}</span>
                <Button variant="ghost" size="sm" onClick={copySecret} aria-label="Copy secret">
                  {copied ? <CheckCircle className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                </Button>
              </div>
              <p className="text-xs text-gray-500 break-all">OTP Auth URL: <code>{otpAuthUrl}</code></p>
              <Button onClick={() => setStep('verify')}>I've scanned it — Next</Button>
            </div>
          )}

          {/* ── Verify: enter first code ───────────────────────────── */}
          {step === 'verify' && (
            <div className="space-y-4">
              <div>
                <Label htmlFor="totp-code">Enter the 6-digit code from your app</Label>
                <Input
                  id="totp-code"
                  value={code}
                  onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  maxLength={6}
                  inputMode="numeric"
                  className="mt-1 w-40 font-mono text-xl tracking-widest text-center"
                />
              </div>
              <Button onClick={handleVerify} disabled={loading || code.length !== 6}>
                {loading ? 'Verifying…' : 'Activate 2FA'}
              </Button>
            </div>
          )}

          {/* ── Backup codes ───────────────────────────────────────── */}
          {step === 'backup' && backupCodes.length > 0 && (
            <div className="space-y-4">
              <p className="text-sm font-semibold text-amber-600">
                ⚠️ Save these backup codes now. They won't be shown again.
              </p>
              <div className="grid grid-cols-2 gap-2">
                {backupCodes.map((code, i) => (
                  <code key={i} className="p-2 bg-gray-50 dark:bg-gray-800 rounded text-sm font-mono text-center">
                    {code}
                  </code>
                ))}
              </div>
              <Button onClick={() => setStep('idle')}>I've saved my backup codes</Button>
            </div>
          )}

          {/* ── Disable flow ───────────────────────────────────────── */}
          {step === 'disable' && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">Confirm your password to disable 2FA.</p>
              <div>
                <Label htmlFor="confirm-password">Current password</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="mt-1"
                />
              </div>
              <div className="flex gap-2">
                <Button variant="destructive" onClick={handleDisable} disabled={loading || !password}>
                  {loading ? 'Disabling…' : 'Confirm Disable'}
                </Button>
                <Button variant="ghost" onClick={() => setStep('idle')}>Cancel</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
