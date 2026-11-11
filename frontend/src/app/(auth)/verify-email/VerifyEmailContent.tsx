'use client'

/**
 * VerifyEmailContent — extracted into its own client component so that
 * the page.tsx wrapper can wrap it in <Suspense> as required by Next.js 14
 * when useSearchParams() is used at the page level.
 */

import { useState, useRef, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { BookOpen, Loader2, CheckCircle2, Mail } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/components/ui/use-toast'
import api from '@/lib/api'

export default function VerifyEmailContent() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const { toast }    = useToast()

  // Email can be pre-filled from the register redirect: /verify-email?email=...
  const [email,      setEmail]      = useState(searchParams.get('email') || '')
  const [otp,        setOtp]        = useState(['', '', '', '', '', ''])
  const [loading,    setLoading]    = useState(false)
  const [verified,   setVerified]   = useState(false)
  const [resending,  setResending]  = useState(false)
  const [cooldown,   setCooldown]   = useState(0)

  const inputRefs = useRef<(HTMLInputElement | null)[]>([])

  // Cooldown timer for resend button
  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown(c => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  // Auto-focus first empty box on mount
  useEffect(() => {
    inputRefs.current[0]?.focus()
  }, [])

  const otpValue = otp.join('')

  function handleOtpChange(index: number, value: string) {
    // Only allow digits
    const digit = value.replace(/\D/g, '').slice(-1)
    const next  = [...otp]
    next[index] = digit
    setOtp(next)

    // Auto-advance to next box
    if (digit && index < 5) {
      inputRefs.current[index + 1]?.focus()
    }
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      // Move back on backspace when current box is empty
      inputRefs.current[index - 1]?.focus()
    }
  }

  function handlePaste(e: React.ClipboardEvent) {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
    if (pasted.length === 6) {
      setOtp(pasted.split(''))
      inputRefs.current[5]?.focus()
    }
    e.preventDefault()
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) {
      toast({ title: 'Enter your email address', variant: 'destructive' })
      return
    }
    if (otpValue.length < 6) {
      toast({ title: 'Enter the full 6-digit code', variant: 'destructive' })
      return
    }

    setLoading(true)
    try {
      await api.post('/auth/verify-email', { email: email.trim(), otp: otpValue })
      setVerified(true)
    } catch (error: any) {
      const message = error.response?.data?.message || 'Invalid or expired code'
      toast({ title: 'Verification failed', description: message, variant: 'destructive' })
      // Clear OTP boxes on failure
      setOtp(['', '', '', '', '', ''])
      inputRefs.current[0]?.focus()
    } finally {
      setLoading(false)
    }
  }

  async function handleResend() {
    if (!email.trim()) {
      toast({ title: 'Enter your email address first', variant: 'destructive' })
      return
    }
    setResending(true)
    try {
      await api.post('/auth/forgot-password', { email: email.trim() })
      toast({ title: 'New code sent!', description: 'Check your email for the new 6-digit code.' })
      setCooldown(60)
      setOtp(['', '', '', '', '', ''])
      inputRefs.current[0]?.focus()
    } catch (error: any) {
      toast({ title: 'Could not resend code', variant: 'destructive' })
    } finally {
      setResending(false)
    }
  }

  if (verified) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-halqa-900 via-halqa-800 to-halqa-700 flex items-center justify-center p-4">
        <div className="w-full max-w-md animate-fade-in">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-white/10 rounded-2xl mb-4 backdrop-blur-sm">
              <BookOpen className="w-8 h-8 text-white" />
            </div>
          </div>
          <div className="bg-white rounded-2xl shadow-2xl p-8 text-center">
            <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto mb-4" />
            <h2 className="text-2xl font-semibold text-gray-900 mb-2">Email verified!</h2>
            <p className="text-gray-500 text-sm mb-6">
              Your account is now active. Sign in to start using HALQA.
            </p>
            <Button
              className="w-full bg-halqa-700 hover:bg-halqa-800 text-white h-11 text-base font-semibold"
              onClick={() => router.push('/login')}
            >
              Sign In Now
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-halqa-900 via-halqa-800 to-halqa-700 flex items-center justify-center p-4">
      <div className="w-full max-w-md animate-fade-in">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-white/10 rounded-2xl mb-4 backdrop-blur-sm">
            <BookOpen className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white">Halqa Management</h1>
          <p className="text-halqa-200 mt-1">Verify your email</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <div className="flex justify-center mb-4">
            <div className="w-14 h-14 bg-indigo-100 rounded-2xl flex items-center justify-center">
              <Mail className="w-7 h-7 text-indigo-600" />
            </div>
          </div>

          <h2 className="text-xl font-semibold text-gray-900 mb-1 text-center">Check your email</h2>
          <p className="text-gray-500 text-sm text-center mb-6">
            We sent a 6-digit code to your email. Enter it below to activate your account.
          </p>

          <form onSubmit={handleVerify} className="space-y-5">
            {/* Email field — pre-filled from URL param but editable */}
            <div className="space-y-1.5">
              <Label htmlFor="email">Email Address</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                disabled={loading}
              />
            </div>

            {/* OTP input — 6 individual digit boxes */}
            <div className="space-y-1.5">
              <Label>Verification Code</Label>
              <div className="flex gap-2 justify-between" onPaste={handlePaste}>
                {otp.map((digit, i) => (
                  <input
                    key={i}
                    ref={el => { inputRefs.current[i] = el }}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={e => handleOtpChange(i, e.target.value)}
                    onKeyDown={e => handleKeyDown(i, e)}
                    disabled={loading}
                    className="w-12 h-14 text-center text-xl font-bold border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors disabled:bg-gray-50"
                    aria-label={`Digit ${i + 1}`}
                  />
                ))}
              </div>
              <p className="text-xs text-gray-400 text-center">
                The code expires in {'{'}OTP_EXPIRY_MINUTES{'}'} minutes
              </p>
            </div>

            <Button
              type="submit"
              className="w-full bg-halqa-700 hover:bg-halqa-800 text-white h-11 text-base font-semibold"
              disabled={loading || otpValue.length < 6}
            >
              {loading
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Verifying…</>
                : 'Verify Email'
              }
            </Button>
          </form>

          {/* Resend */}
          <div className="mt-4 text-center">
            <p className="text-sm text-gray-500">
              Didn&apos;t receive the code?{' '}
              {cooldown > 0 ? (
                <span className="text-gray-400">Resend in {cooldown}s</span>
              ) : (
                <button
                  type="button"
                  onClick={handleResend}
                  disabled={resending}
                  className="text-halqa-600 hover:text-halqa-700 font-medium disabled:opacity-50"
                >
                  {resending ? 'Sending…' : 'Resend code'}
                </button>
              )}
            </p>
          </div>

          <p className="text-center text-sm text-gray-400 mt-4">
            <Link href="/login" className="hover:text-halqa-600">← Back to sign in</Link>
          </p>
        </div>

        <p className="text-center text-halqa-200 text-sm mt-6">
          © {new Date().getFullYear()} Halqa Management System
        </p>
      </div>
    </div>
  )
}
