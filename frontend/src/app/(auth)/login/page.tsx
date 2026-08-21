'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Eye, EyeOff, BookOpen, Loader2 } from 'lucide-react'
import { useAuthStore } from '@/store/auth.store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/components/ui/use-toast'
import { getDefaultRoute } from '@/lib/role-routes'
import { LanguageSwitcher } from '@/components/ui/language-switcher'
import { ThemeSwitcher } from '@/components/ui/theme-switcher'
import { useTranslation } from '@/hooks/useTranslation'
import { GoogleOAuthProvider, GoogleLogin, type CredentialResponse } from '@react-oauth/google'

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required')
})

type LoginForm = z.infer<typeof loginSchema>

// Google Client ID from environment — undefined when not configured
// The Google button is hidden when this is not set so the app works without Google
const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || ''

// Whether Google Sign-In is configured
const GOOGLE_ENABLED = GOOGLE_CLIENT_ID.length > 0

// Google icon SVG (official brand colors)
function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" className="flex-shrink-0">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  )
}

function LoginContent() {
  const [showPassword, setShowPassword] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const { login, googleSignIn, isLoading } = useAuthStore()
  const router = useRouter()
  const { toast } = useToast()
  const { t } = useTranslation()

  const { register, handleSubmit, formState: { errors } } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema)
  })

  // ── Email/password login (unchanged) ──────────────────────────────────────
  const onSubmit = async (data: LoginForm) => {
    try {
      await login(data.email, data.password)
      const role = useAuthStore.getState().user?.role || 'MEMBER'
      router.push(getDefaultRoute(role))
    } catch (error: any) {
      const message = error.message || 'Invalid email or password'
      // If email not verified — show link to verification page
      if (message.toLowerCase().includes('verify your email')) {
        toast({
          title: 'Email not verified',
          description: (
            <span>
              Please verify your email first.{' '}
              <a
                href={`/verify-email?email=${encodeURIComponent(data.email)}`}
                className="underline font-medium"
              >
                Enter your code here →
              </a>
            </span>
          ) as any,
          variant: 'destructive',
        })
      } else {
        toast({
          title: 'Login failed',
          description: message,
          variant: 'destructive',
        })
      }
    }
  }

  // ── Google Sign-In ──────────────────────────────────────────────────────────
  // Flow:
  //   1. Google OAuth popup → Google returns credential (ID token)
  //   2. We send ONLY the credential to our backend — no user data
  //   3. Backend verifies cryptographically, finds/creates HALQA user
  //   4. Backend returns same { user, accessToken, refreshToken } as normal login
  //   5. We store tokens using existing auth store setToken/setUser
  const handleGoogleSuccess = async (credentialResponse: CredentialResponse) => {
    const credential = credentialResponse.credential
    if (!credential) {
      toast({ title: 'Google Sign-In failed', description: 'No credential received.', variant: 'destructive' })
      return
    }

    setGoogleLoading(true)
    try {
      const { mustChangePassword, isNewUser, user } = await googleSignIn(credential)

      if (mustChangePassword) {
        router.replace('/change-password')
        return
      }

      if (isNewUser) {
        toast({ title: '🎉 Welcome to HALQA!', description: 'Your account has been created.' })
      }

      const role = user?.role || 'MEMBER'
      router.push(getDefaultRoute(role))
    } catch (error: any) {
      const message = error.response?.data?.message || 'Google Sign-In failed. Please try again.'
      toast({ title: 'Google Sign-In failed', description: message, variant: 'destructive' })
    } finally {
      setGoogleLoading(false)
    }
  }

  const handleGoogleError = () => {
    // popup_closed_by_user is not an error — user cancelled intentionally
    toast({
      title: 'Google Sign-In cancelled',
      description: 'You closed the Google sign-in window.',
    })
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-halqa-900 via-halqa-800 to-halqa-700 flex items-center justify-center p-4">
      {/* Language + Theme switchers top-right */}
      <div className="fixed top-4 right-4 flex items-center gap-1 z-10">
        <div className="bg-white/10 backdrop-blur-sm rounded-lg flex items-center">
          <LanguageSwitcher />
          <ThemeSwitcher />
        </div>
      </div>

      <div className="w-full max-w-md animate-fade-in">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-white/10 rounded-2xl mb-4 backdrop-blur-sm">
            <BookOpen className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white">Halqa Management</h1>
          <p className="text-halqa-200 mt-1">Islamic School ERP System</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <h2 className="text-2xl font-semibold text-gray-900 mb-1">{t.welcome}</h2>
          <p className="text-gray-500 text-sm mb-6">{t.loginTitle}</p>

          {/* ── Google Sign-In button ─────────────────────────────────────── */}
          {GOOGLE_ENABLED && (
            <>
              <div className="mb-5">
                {googleLoading ? (
                  <div className="w-full h-11 flex items-center justify-center gap-3 bg-white border border-gray-300 rounded-lg text-gray-700 text-sm font-medium shadow-sm">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Signing in with Google…
                  </div>
                ) : (
                  <GoogleLogin
                    onSuccess={handleGoogleSuccess}
                    onError={handleGoogleError}
                    text="continue_with"
                    shape="rectangular"
                    theme="outline"
                    size="large"
                    width="368"
                    locale="en"
                    use_fedcm_for_prompt={false}
                  />
                )}
              </div>

              {/* Divider */}
              <div className="flex items-center gap-3 mb-5">
                <div className="flex-1 h-px bg-gray-200" />
                <span className="text-xs text-gray-400 font-medium">or sign in with email</span>
                <div className="flex-1 h-px bg-gray-200" />
              </div>
            </>
          )}

          {/* ── Google not configured notice (dev only) ──────────────────────── */}
          {!GOOGLE_ENABLED && process.env.NODE_ENV === 'development' && (
            <div className="mb-5">
              <div className="w-full h-11 flex items-center justify-center gap-3 bg-gray-50 border border-dashed border-gray-300 rounded-lg text-gray-400 text-sm cursor-not-allowed" title="Set NEXT_PUBLIC_GOOGLE_CLIENT_ID in .env.local to enable">
                <GoogleIcon />
                Continue with Google
                <span className="text-[10px] bg-gray-200 text-gray-500 px-1.5 py-0.5 rounded">not configured</span>
              </div>
              <p className="text-[10px] text-gray-400 text-center mt-1">Set NEXT_PUBLIC_GOOGLE_CLIENT_ID in frontend/.env.local</p>
            </div>
          )}

          {/* ── Email/password form (unchanged) ──────────────────────────────── */}
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="email">{t.email}</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@school.com"
                autoComplete="email"
                {...register('email')}
                className={errors.email ? 'border-red-500' : ''}
              />
              {errors.email && <p className="text-sm text-red-500">{errors.email.message}</p>}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">{t.password}</Label>
                <Link href="/forgot-password" className="text-sm text-halqa-600 hover:text-halqa-700">
                  {t.forgotPassword}
                </Link>
              </div>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  {...register('password')}
                  className={errors.password ? 'border-red-500 pr-10' : 'pr-10'}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {errors.password && <p className="text-sm text-red-500">{errors.password.message}</p>}
            </div>

            <Button
              type="submit"
              className="w-full bg-halqa-700 hover:bg-halqa-800 text-white h-11 text-base font-semibold"
              disabled={isLoading || googleLoading}
            >
              {isLoading
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> {t.loading}</>
                : t.login
              }
            </Button>
          </form>

          {/* ── NOTE: Demo role buttons have been removed ─────────────────────
               Development credentials are in backend/src/prisma/seed.js.
               Demo buttons are never shown in production (security requirement). */}

          <p className="text-center text-sm text-gray-500 mt-5">
            Don&apos;t have an account?{' '}
            <Link href="/register" className="text-halqa-600 hover:text-halqa-700 font-medium">
              Create one free
            </Link>
          </p>
          <p className="text-center text-xs text-gray-400 mt-2">
            Need to verify your email?{' '}
            <Link href="/verify-email" className="text-halqa-500 hover:text-halqa-700">
              Enter verification code
            </Link>
          </p>
        </div>

        <p className="text-center text-halqa-200 text-sm mt-6">
          © {new Date().getFullYear()} Halqa Management System
        </p>
      </div>
    </div>
  )
}

export default function LoginPage() {
  // Wrap with GoogleOAuthProvider only when Client ID is configured.
  // Without the env var the page loads normally (email/password only).
  if (!GOOGLE_ENABLED) {
    return <LoginContent />
  }

  return (
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      <LoginContent />
    </GoogleOAuthProvider>
  )
}
