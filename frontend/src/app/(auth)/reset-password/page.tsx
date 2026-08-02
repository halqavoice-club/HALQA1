'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { BookOpen, ArrowLeft, Loader2, Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/components/ui/use-toast'
import api from '@/lib/api'

const schema = z.object({
  email: z.string().email(),
  otp: z.string().length(6, 'Code must be 6 digits'),
  newPassword: z.string().min(8, 'Password must be at least 8 characters'),
  confirmPassword: z.string()
}).refine(d => d.newPassword === d.confirmPassword, {
  message: "Passwords don't match",
  path: ['confirmPassword']
})

type Form = z.infer<typeof schema>

export default function ResetPasswordPage() {
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const { toast } = useToast()
  const router = useRouter()

  const { register, handleSubmit, formState: { errors } } = useForm<Form>({
    resolver: zodResolver(schema)
  })

  const onSubmit = async (data: Form) => {
    setLoading(true)
    try {
      await api.post('/auth/reset-password', {
        email: data.email,
        otp: data.otp,
        newPassword: data.newPassword
      })
      toast({ title: 'Password reset successfully' })
      router.push('/login')
    } catch (err: any) {
      toast({ title: err.response?.data?.message || 'Reset failed', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-halqa-900 via-halqa-800 to-halqa-700 flex items-center justify-center p-4">
      <div className="w-full max-w-md animate-fade-in">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-white/10 rounded-2xl mb-4">
            <BookOpen className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white">Halqa Management</h1>
        </div>

        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <h2 className="text-2xl font-semibold text-gray-900 mb-6">Reset password</h2>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div>
              <Label>Email address</Label>
              <Input type="email" placeholder="you@school.com" className="mt-1" {...register('email')} />
              {errors.email && <p className="text-sm text-red-500 mt-1">{errors.email.message}</p>}
            </div>
            <div>
              <Label>6-digit code</Label>
              <Input placeholder="123456" maxLength={6} className="mt-1 text-center text-lg font-mono tracking-widest" {...register('otp')} />
              {errors.otp && <p className="text-sm text-red-500 mt-1">{errors.otp.message}</p>}
            </div>
            <div>
              <Label>New password</Label>
              <div className="relative mt-1">
                <Input type={showPw ? 'text' : 'password'} placeholder="••••••••" className="pr-10" {...register('newPassword')} />
                <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
                  {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {errors.newPassword && <p className="text-sm text-red-500 mt-1">{errors.newPassword.message}</p>}
            </div>
            <div>
              <Label>Confirm password</Label>
              <Input type="password" placeholder="••••••••" className="mt-1" {...register('confirmPassword')} />
              {errors.confirmPassword && <p className="text-sm text-red-500 mt-1">{errors.confirmPassword.message}</p>}
            </div>
            <Button type="submit" className="w-full bg-halqa-700 hover:bg-halqa-800" disabled={loading}>
              {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Resetting...</> : 'Reset Password'}
            </Button>
          </form>

          <Link href="/login" className="flex items-center justify-center gap-2 mt-6 text-sm text-gray-500 hover:text-gray-700">
            <ArrowLeft className="w-4 h-4" /> Back to login
          </Link>
        </div>
      </div>
    </div>
  )
}
