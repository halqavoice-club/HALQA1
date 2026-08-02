'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import Link from 'next/link'
import { BookOpen, ArrowLeft, Loader2, CheckCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/components/ui/use-toast'
import api from '@/lib/api'

const schema = z.object({ email: z.string().email('Invalid email') })
type Form = z.infer<typeof schema>

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const { toast } = useToast()

  const { register, handleSubmit, formState: { errors } } = useForm<Form>({
    resolver: zodResolver(schema)
  })

  const onSubmit = async (data: Form) => {
    setLoading(true)
    try {
      await api.post('/auth/forgot-password', data)
      setSent(true)
    } catch (err: any) {
      toast({ title: err.response?.data?.message || 'Something went wrong', variant: 'destructive' })
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
          {sent ? (
            <div className="text-center py-4">
              <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
              <h2 className="text-xl font-semibold text-gray-900 mb-2">Check your email</h2>
              <p className="text-gray-500 text-sm mb-6">
                If that email exists, we sent a 6-digit reset code.
              </p>
              <Link href="/reset-password">
                <Button className="w-full bg-halqa-700 hover:bg-halqa-800">Enter Reset Code</Button>
              </Link>
            </div>
          ) : (
            <>
              <h2 className="text-2xl font-semibold text-gray-900 mb-2">Forgot password?</h2>
              <p className="text-gray-500 text-sm mb-6">Enter your email and we'll send a reset code.</p>

              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                <div>
                  <Label>Email address</Label>
                  <Input
                    type="email"
                    placeholder="you@school.com"
                    className="mt-1"
                    {...register('email')}
                  />
                  {errors.email && <p className="text-sm text-red-500 mt-1">{errors.email.message}</p>}
                </div>
                <Button type="submit" className="w-full bg-halqa-700 hover:bg-halqa-800" disabled={loading}>
                  {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Sending...</> : 'Send Reset Code'}
                </Button>
              </form>
            </>
          )}

          <Link href="/login" className="flex items-center justify-center gap-2 mt-6 text-sm text-gray-500 hover:text-gray-700">
            <ArrowLeft className="w-4 h-4" /> Back to login
          </Link>
        </div>
      </div>
    </div>
  )
}
