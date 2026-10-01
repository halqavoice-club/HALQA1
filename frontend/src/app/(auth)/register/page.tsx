'use client'

/**
 * Register page — new user sign-up
 *
 * Two registration paths:
 *   1. Google Sign-Up  → single click, account created immediately
 *   2. Email/password  → fill form, verify email, then sign in
 *
 * Both paths create a MEMBER account with no school membership.
 * Education roles (STUDENT, TEACHER etc.) come from school membership only.
 */

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Eye, EyeOff, BookOpen, Loader2, CheckCircle2 } from 'lucide-react'
import { useAuthStore } from '@/store/auth.store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/components/ui/use-toast'
import { LanguageSwitcher } from '@/components/ui/language-switcher'
import { ThemeSwitcher } from '@/components/ui/theme-switcher'
import { GoogleOAuthProvider, GoogleLogin, type CredentialResponse } from '@react-oauth/google'
import api from '@/lib/api'

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || ''
const GOOGLE_ENABLED   = GOOGLE_CLIENT_ID.length > 0

const registerSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required').max(100),
  lastName:  z.string().trim().min(1, 'Last name is required').max(100),
  email:     z.string().email('Invalid email address'),
  password:  z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Must contain at least one uppercase letter')
    .regex(/[0-9]/, 'Must contain at least one number'),
  confirmPassword: z.string(),
}).refine(d => d.password === d.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
})

type RegisterForm = z.infer<typeof registerSchema>

// Google icon
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

// Password strength indicator
function PasswordStrength({ password }: { password: string }) {
  if (!password) return null
  const checks = [
    { label: '8+ characters',      pass: password.length >= 8 },
    { label: 'Uppercase letter',   pass: /[A-Z]/.test(password) },
    { label: 'Number',             pass: /[0-9]/.test(password) },
  ]
  const score = checks.filter(c => c.pass).length
  const color = score === 3 ? 'bg-green-500' : score === 2 ? 'bg-yellow-400' : 'bg-red-400'

  return (
    <div className="mt-2 space-y-1">
      <div className="flex gap-1">
        {[0,1,2].map(i => (
          <div key={i} className={`h-1 flex-1 rounded-full transition-colors ${i < score ? color : 'bg-gray-200'}`} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5">
        {checks.map(c => (
          <span key={c.label} className={`text-[10px] flex items-center gap-0.5 ${c.pass ? 'text-green-600' : 'text-gray-400'}`}>
            {c.pass ? '✓' : '○'} {c.label}
          </span>
        ))}
      </div>
    </div>
  )
}

function RegisterContent() {
  const [showPassword,        setShowPassword]        = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [googleLoading,       setGoogleLoading]       = useState(false)
  const [emailSent,           setEmailSent]           = useState(false)
  const [registeredEmail,     setRegisteredEmail]     = useState('')
  const [isSubmitting,        setIsSubmitting]        = useState(false)

  const { googleSignIn } = useAuthStore()
  const router           = useRouter()
  const { toast }        = useToast()

  const { register, handleSubmit, watch, formState: { errors } } = useForm<RegisterForm>({
    resolver: zodResolver(registerSchema)
  })

  const passwordValue = watch('password', '')

  // ── Email/password registration ──────────────────────────────────────────
  const onSubmit = async (data: RegisterForm) => {
    setIsSubmitting(true)
    try {
      const response = await api.post('/auth/register', {
        email:     data.email,
        password:  data.password,
        firstName: data.firstName,
        lastName:  data.lastName,
      })

      const responseMessage: string = response.data?.message || ''
      // Dev mode: backend sets ACTIVE immediately when SMTP not configured
      const canLoginNow = responseMessage.toLowerCase().includes('sign in now') ||
                          responseMessage.toLowerCase().includes('skipped')

      if (canLoginNow) {
        // Dev mode — skip email screen, go straight to login
        toast({ title: '🎉 Account created!', description: 'You can sign in now.' })
        router.push('/login')
      } else {
        // Production — show "check your email" screen then redirect to verify page
        setRegisteredEmail(data.email)
        setEmailSent(true)
        setTimeout(() => {
          router.push(`/verify-email?email=${encodeURIComponent(data.email)}`)
        }, 2500)
      }
    } catch (error: any) {
      const message = error.response?.data?.message || 'Registration failed. Please try again.'
      toast({ title: 'Registration failed', description: message, variant: 'destructive' })
    } finally {
      setIsSubmitting(false)
    }
  }

  // ── Google Sign-Up (also handles existing accounts — no duplicate created) ─
  const handleGoogleSuccess = async (credentialResponse: CredentialResponse) => {
    const credential = credentialResponse.credential
    if (!credential) {
      toast({ title: 'Google Sign-Up failed', description: 'No credential received.', variant: 'destructive' })
      return
    }

    setGoogleLoading(true)
    try {
      const { mustChangePassword, isNewUser, user } = await googleSignIn(credential)

      if (mustChangePassword) {
        router.replace('/change-password')
        return
      }

      toast({
        title: isNewUser ? '🎉 Account created!' : 'Welcome back!',
        description: isNewUser
          ? 'Your HALQA account is ready. You can now join a school or use social features.'
          : 'You already have an account — signed you in.',
      })

      router.push('/feed')
    } catch (error: any) {
      toast({ title: 'Google Sign-Up failed', description: error.message, variant: 'destructive' })
    } finally {
      setGoogleLoading(false)
    }
  }

  // ── Email verification sent — show confirmation screen ───────────────────
  if (emailSent) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-halqa-900 via-halqa-800 to-halqa-700 flex items-center justify-center p-4">
        <div className="w-full max-w-md animate-fade-in">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-white/10 rounded-2xl mb-4 backdrop-blur-sm">
              <BookOpen className="w-8 h-8 text-white" />
            </div>
          </div>
          <div className="bg-white rounded-2xl shadow-2xl p-8 text-center">
            <CheckCircle2 className="w-14 h-14 text-green-500 mx-auto mb-4" />
            <h2 className="text-2xl font-semibold text-gray-900 mb-2">Check your email</h2>
            <p className="text-gray-500 text-sm mb-6">
              We sent a verification code to <strong>{registeredEmail}</strong>.
              Enter the code to activate your account.
            </p>
            <Button
              className="w-full bg-halqa-700 hover:bg-halqa-800 text-white h-11 text-base font-semibold mb-4"
              onClick={() => router.push('/login')}
            >
              Go to Login
            </Button>
            <p className="text-xs text-gray-400">
              Didn't receive it? Check your spam folder.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-halqa-900 via-halqa-800 to-halqa-700 flex items-center justify-center p-4">
      {/* Language + Theme switchers */}
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
          <p className="text-halqa-200 mt-1">Create your account</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <h2 className="text-2xl font-semibold text-gray-900 mb-1">Create account</h2>
          <p className="text-gray-500 text-sm mb-6">Join HALQA — free forever for social features</p>

          {/* ── Google Sign-Up ────────────────────────────────────────────── */}
          {GOOGLE_ENABLED && (
            <>
              <div className="mb-5">
                {googleLoading ? (
                  <div className="w-full h-11 flex items-center justify-center gap-3 bg-white border border-gray-300 rounded-lg text-gray-700 text-sm font-medium shadow-sm">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Setting up your account…
                  </div>
                ) : (
                  <GoogleLogin
                    onSuccess={handleGoogleSuccess}
                    onError={() => toast({ title: 'Google Sign-Up failed', variant: 'destructive' })}
                    text="signup_with"
                    shape="rectangular"
                    theme="outline"
                    size="large"
                    width="368"
                    locale="en"
                    use_fedcm_for_prompt={false}
                  />
                )}
              </div>

              <div className="flex items-center gap-3 mb-5">
                <div className="flex-1 h-px bg-gray-200" />
                <span className="text-xs text-gray-400 font-medium">or register with email</span>
                <div className="flex-1 h-px bg-gray-200" />
              </div>
            </>
          )}

          {/* Google not configured notice (dev only) */}
          {!GOOGLE_ENABLED && process.env.NODE_ENV === 'development' && (
            <div className="mb-5">
              <div className="w-full h-11 flex items-center justify-center gap-3 bg-gray-50 border border-dashed border-gray-300 rounded-lg text-gray-400 text-sm cursor-not-allowed">
                <GoogleIcon />
                Sign up with Google
                <span className="text-[10px] bg-gray-200 text-gray-500 px-1.5 py-0.5 rounded">not configured</span>
              </div>
            </div>
          )}

          {/* ── Email/password registration form ──────────────────────────── */}
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="firstName">First Name</Label>
                <Input
                  id="firstName"
                  placeholder="Ahmad"
                  autoComplete="given-name"
                  {...register('firstName')}
                  className={errors.firstName ? 'border-red-500' : ''}
                />
                {errors.firstName && <p className="text-xs text-red-500">{errors.firstName.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lastName">Last Name</Label>
                <Input
                  id="lastName"
                  placeholder="Hassan"
                  autoComplete="family-name"
                  {...register('lastName')}
                  className={errors.lastName ? 'border-red-500' : ''}
                />
                {errors.lastName && <p className="text-xs text-red-500">{errors.lastName.message}</p>}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="email">Email Address</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                autoComplete="email"
                {...register('email')}
                className={errors.email ? 'border-red-500' : ''}
              />
              {errors.email && <p className="text-xs text-red-500">{errors.email.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  autoComplete="new-password"
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
              {errors.password
                ? <p className="text-xs text-red-500">{errors.password.message}</p>
                : <PasswordStrength password={passwordValue} />
              }
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="confirmPassword">Confirm Password</Label>
              <div className="relative">
                <Input
                  id="confirmPassword"
                  type={showConfirmPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  autoComplete="new-password"
                  {...register('confirmPassword')}
                  className={errors.confirmPassword ? 'border-red-500 pr-10' : 'pr-10'}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                >
                  {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {errors.confirmPassword && <p className="text-xs text-red-500">{errors.confirmPassword.message}</p>}
            </div>

            <Button
              type="submit"
              className="w-full bg-halqa-700 hover:bg-halqa-800 text-white h-11 text-base font-semibold mt-2"
              disabled={isSubmitting || googleLoading}
            >
              {isSubmitting
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Creating account…</>
                : 'Create Account'
              }
            </Button>
          </form>

          <p className="text-center text-sm text-gray-500 mt-5">
            Already have an account?{' '}
            <Link href="/login" className="text-halqa-600 hover:text-halqa-700 font-medium">
              Sign in
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

export default function RegisterPage() {
  if (!GOOGLE_ENABLED) {
    return <RegisterContent />
  }

  return (
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      <RegisterContent />
    </GoogleOAuthProvider>
  )
}
