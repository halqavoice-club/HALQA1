'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Eye, EyeOff, BookOpen, Loader2, GraduationCap, UserCheck, Shield, Users } from 'lucide-react'
import { useAuthStore } from '@/store/auth.store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/components/ui/use-toast'
import { getDefaultRoute } from '@/lib/role-routes'
import { LanguageSwitcher } from '@/components/ui/language-switcher'
import { ThemeSwitcher } from '@/components/ui/theme-switcher'
import { useTranslation } from '@/hooks/useTranslation'

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required')
})

type LoginForm = z.infer<typeof loginSchema>

const DEMO_USERS = [
  { role: 'Admin',    email: 'admin@halqa-academy.com',   password: 'Admin@2024',    icon: Shield,        color: 'bg-purple-100 text-purple-700' },
  { role: 'Teacher',  email: 'teacher@halqa-academy.com', password: 'Teacher@2024',  icon: UserCheck,     color: 'bg-green-100 text-green-700' },
  { role: 'Student',  email: 'student1@halqa.com',        password: 'Student@2024',  icon: GraduationCap, color: 'bg-blue-100 text-blue-700' },
  { role: 'Guardian', email: 'parent@halqa.com',          password: 'Guardian@2024', icon: Users,         color: 'bg-orange-100 text-orange-700' },
]

export default function LoginPage() {
  const [showPassword, setShowPassword] = useState(false)
  const { login, isLoading } = useAuthStore()
  const router = useRouter()
  const { toast } = useToast()
  const { t } = useTranslation()

  const { register, handleSubmit, setValue, formState: { errors } } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema)
  })

  const onSubmit = async (data: LoginForm) => {
    try {
      await login(data.email, data.password)
      const role = useAuthStore.getState().user?.role || 'SCHOOL_ADMIN'
      router.push(getDefaultRoute(role))
    } catch (error: any) {
      toast({
        title: 'Login failed',
        description: error.message || 'Invalid email or password',
        variant: 'destructive'
      })
    }
  }

  const fillDemo = (email: string, password: string) => {
    setValue('email', email)
    setValue('password', password)
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
              disabled={isLoading}
            >
              {isLoading
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> {t.loading}</>
                : t.login
              }
            </Button>
          </form>

          {/* Quick-fill demo buttons — development only */}
          {process.env.NODE_ENV === 'development' && (
            <div className="mt-6">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                Quick Login (Dev Only)
              </p>
              <div className="grid grid-cols-2 gap-2">
                {DEMO_USERS.map(u => {
                  const Icon = u.icon
                  return (
                    <button
                      key={u.role}
                      type="button"
                      onClick={() => fillDemo(u.email, u.password)}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all hover:opacity-80 ${u.color}`}
                    >
                      <Icon className="w-3.5 h-3.5 flex-shrink-0" />
                      {u.role}
                    </button>
                  )
                })}
              </div>
              <p className="text-xs text-gray-400 mt-2 text-center">
                Click a role to fill credentials, then Sign in
              </p>
            </div>
          )}
        </div>

        <p className="text-center text-halqa-200 text-sm mt-6">
          © {new Date().getFullYear()} Halqa Management System
        </p>
      </div>
    </div>
  )
}
