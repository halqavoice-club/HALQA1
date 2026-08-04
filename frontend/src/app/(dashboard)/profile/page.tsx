'use client'

import { useState, useRef, useCallback } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/components/ui/use-toast'
import { useAuthStore } from '@/store/auth.store'
import { User, Mail, Shield, Camera, Save, Loader2, LogOut, X, Upload } from 'lucide-react'
import { format } from 'date-fns'
import { resolveMediaUrl } from '@/lib/media'
import Link from 'next/link'

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin',
  SCHOOL_ADMIN: 'School Admin',
  TEACHER: 'Teacher',
  STUDENT: 'Student',
  GUARDIAN: 'Guardian / Parent',
  REPRESENTATIVE: 'Representative'
}

const ROLE_COLORS: Record<string, string> = {
  SUPER_ADMIN: 'bg-red-100 text-red-700',
  SCHOOL_ADMIN: 'bg-purple-100 text-purple-700',
  TEACHER: 'bg-green-100 text-green-700',
  STUDENT: 'bg-blue-100 text-blue-700',
  GUARDIAN: 'bg-orange-100 text-orange-700',
  REPRESENTATIVE: 'bg-gray-100 text-gray-700'
}

function getAvatarSrc(url: string | null | undefined): string {
  return resolveMediaUrl(url)
}

export default function ProfilePage() {
  const { user, logout, setUser } = useAuthStore()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [preview, setPreview] = useState<string | null>(null)
  const [avatarUploading, setAvatarUploading] = useState(false)

  const [form, setForm] = useState({
    firstName: user?.firstName || '',
    lastName: user?.lastName || '',
    phone: '',
    bio: '',
  })

  const [pwForm, setPwForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  })

  // ── Avatar pick & upload ──────────────────────────────────────────────────
  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Validate client-side
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) {
      toast({ title: 'Only JPEG, PNG, WebP or GIF images are allowed', variant: 'destructive' })
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: 'Image must be under 5 MB', variant: 'destructive' })
      return
    }

    // Show local preview immediately
    const objectUrl = URL.createObjectURL(file)
    setPreview(objectUrl)

    // Upload
    setAvatarUploading(true)
    try {
      const formData = new FormData()
      formData.append('avatar', file)

      const res = await api.post('/users/avatar', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })

      const updatedUser = res.data.data
      if (user) setUser({ ...user, avatarUrl: updatedUser.avatarUrl })
      queryClient.invalidateQueries({ queryKey: ['me'] })
      toast({ title: 'Profile photo updated' })
    } catch (err: any) {
      toast({
        title: err.response?.data?.message || 'Upload failed',
        variant: 'destructive'
      })
      setPreview(null)
    } finally {
      setAvatarUploading(false)
      // Reset input so same file can be re-selected
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }, [user, setUser, queryClient, toast])

  // ── Profile info ──────────────────────────────────────────────────────────
  const profileMutation = useMutation({
    mutationFn: (data: any) => api.put('/users/profile', data),
    onSuccess: (res) => {
      toast({ title: 'Profile updated' })
      if (user) setUser({ ...user, ...res.data.data })
      queryClient.invalidateQueries({ queryKey: ['me'] })
    },
    onError: () => toast({ title: 'Update failed', variant: 'destructive' })
  })

  // ── Password ──────────────────────────────────────────────────────────────
  const passwordMutation = useMutation({
    mutationFn: (data: any) => api.put('/auth/change-password', data),
    onSuccess: () => {
      toast({ title: 'Password changed successfully' })
      setPwForm({ currentPassword: '', newPassword: '', confirmPassword: '' })
    },
    onError: (err: any) => toast({
      title: err.response?.data?.message || 'Password change failed',
      variant: 'destructive'
    })
  })

  if (!user) {
    return (
      <div className="max-w-2xl space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-48 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    )
  }

  const handleRemoveAvatar = async () => {
    setAvatarUploading(true)
    try {
      await api.put('/users/profile', { avatarUrl: null })
      setUser({ ...user, avatarUrl: null })
      setPreview(null)
      toast({ title: 'Profile photo removed' })
    } catch {
      toast({ title: 'Failed to remove photo', variant: 'destructive' })
    } finally {
      setAvatarUploading(false)
    }
  }

  const handlePasswordChange = () => {
    if (pwForm.newPassword !== pwForm.confirmPassword) {
      toast({ title: "Passwords don't match", variant: 'destructive' }); return
    }
    if (pwForm.newPassword.length < 8) {
      toast({ title: 'Password must be at least 8 characters', variant: 'destructive' }); return
    }
    passwordMutation.mutate({ currentPassword: pwForm.currentPassword, newPassword: pwForm.newPassword })
  }

  const currentAvatar = preview || getAvatarSrc(user.avatarUrl)

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">My Profile</h1>
        <p className="text-gray-500 text-sm">Manage your personal information and security</p>
      </div>

      {/* ── Profile header card ── */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-6">
          <div className="flex items-center gap-5">

            {/* Avatar with upload overlay */}
            <div className="relative flex-shrink-0">
              <Avatar className="w-24 h-24 ring-4 ring-white shadow-md">
                <AvatarImage src={currentAvatar} className="object-cover" />
                <AvatarFallback className="bg-halqa-100 text-halqa-700 text-3xl font-bold">
                  {user.firstName?.[0]}{user.lastName?.[0]}
                </AvatarFallback>
              </Avatar>

              {/* Uploading spinner overlay */}
              {avatarUploading && (
                <div className="absolute inset-0 rounded-full bg-black/50 flex items-center justify-center">
                  <Loader2 className="w-6 h-6 text-white animate-spin" />
                </div>
              )}

              {/* Camera button */}
              {!avatarUploading && (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="absolute -bottom-1 -right-1 w-8 h-8 bg-halqa-700 rounded-full flex items-center justify-center text-white hover:bg-halqa-800 transition-colors shadow-md"
                  title="Change photo"
                >
                  <Camera className="w-4 h-4" />
                </button>
              )}

              {/* Remove button — only shown when avatar exists */}
              {(user.avatarUrl || preview) && !avatarUploading && (
                <button
                  onClick={handleRemoveAvatar}
                  className="absolute -top-1 -right-1 w-6 h-6 bg-red-500 rounded-full flex items-center justify-center text-white hover:bg-red-600 transition-colors shadow-md"
                  title="Remove photo"
                >
                  <X className="w-3 h-3" />
                </button>
              )}

              {/* Hidden file input */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="hidden"
                onChange={handleFileChange}
              />
            </div>

            {/* Name / role */}
            <div className="flex-1 min-w-0">
              <h2 className="text-xl font-bold text-gray-900">{user.firstName} {user.lastName}</h2>
              <p className="text-gray-500 text-sm truncate">{user.email}</p>
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <Badge className={ROLE_COLORS[user.role] || 'bg-gray-100 text-gray-700'}>
                  {ROLE_LABELS[user.role] || user.role}
                </Badge>
                {user.school && (
                  <Badge variant="outline" className="text-xs">{user.school.name}</Badge>
                )}
              </div>
              <div className="flex items-center gap-3 mt-3">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={avatarUploading}
                  className="text-xs text-halqa-600 hover:text-halqa-800 flex items-center gap-1 transition-colors disabled:opacity-50"
                >
                  <Upload className="w-3 h-3" />
                  {user.avatarUrl ? 'Change photo' : 'Upload photo'}
                </button>
                {/* Link to own public social profile */}
                <Link
                  href={`/social/profile/${user.id}`}
                  className="text-xs text-indigo-600 hover:text-indigo-800 flex items-center gap-1 transition-colors"
                >
                  <User className="w-3 h-3" />
                  View public profile
                </Link>
              </div>
            </div>
          </div>

          {/* Meta row */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-5 pt-5 border-t border-gray-100 text-sm text-gray-600">
            <div className="flex items-center gap-2">
              <Mail className="w-4 h-4 text-gray-400 flex-shrink-0" />
              <span className="truncate">{user.email}</span>
            </div>
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-gray-400 flex-shrink-0" />
              <span>{user.emailVerified ? 'Email verified' : 'Not verified'}</span>
            </div>
            {user.lastLoginAt && (
              <div className="flex items-center gap-2">
                <User className="w-4 h-4 text-gray-400 flex-shrink-0" />
                <span>Last login: {format(new Date(user.lastLoginAt), 'MMM d, h:mm a')}</span>
              </div>
            )}
          </div>

          {/* Upload hint */}
          <p className="text-xs text-gray-400 mt-3">
            Accepted: JPEG, PNG, WebP, GIF · Max 5 MB
          </p>
        </CardContent>
      </Card>

      {/* ── Personal info ── */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <User className="w-4 h-4" /> Personal Information
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>First Name</Label>
              <Input className="mt-1" value={form.firstName}
                onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))} />
            </div>
            <div>
              <Label>Last Name</Label>
              <Input className="mt-1" value={form.lastName}
                onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))} />
            </div>
          </div>
          <div>
            <Label>Email Address</Label>
            <Input className="mt-1 bg-gray-50" value={user.email} disabled />
            <p className="text-xs text-gray-400 mt-1">Email cannot be changed. Contact admin if needed.</p>
          </div>
          <div>
            <Label>Phone Number</Label>
            <Input className="mt-1" placeholder="+1 555 0100" value={form.phone}
              onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
          </div>
          <div>
            <Label>Bio <span className="text-gray-400 font-normal text-xs">(optional — shown on your profile)</span></Label>
            <textarea
              className="mt-1 w-full px-3 py-2 border border-input rounded-md text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
              rows={3}
              maxLength={200}
              placeholder="Tell people a little about yourself…"
              value={form.bio}
              onChange={e => setForm(f => ({ ...f, bio: e.target.value }))}
            />
            <p className="text-xs text-gray-400 mt-1">{form.bio.length}/200</p>
          </div>
          <Button
            onClick={() => profileMutation.mutate(form)}
            disabled={profileMutation.isPending}
            className="bg-halqa-700 hover:bg-halqa-800 gap-2"
          >
            {profileMutation.isPending
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</>
              : <><Save className="w-4 h-4" /> Save Changes</>}
          </Button>
        </CardContent>
      </Card>

      {/* ── Change password ── */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Shield className="w-4 h-4" /> Change Password
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Current Password</Label>
            <Input type="password" className="mt-1" value={pwForm.currentPassword}
              onChange={e => setPwForm(f => ({ ...f, currentPassword: e.target.value }))} />
          </div>
          <div>
            <Label>New Password</Label>
            <Input type="password" className="mt-1" placeholder="Min. 8 characters" value={pwForm.newPassword}
              onChange={e => setPwForm(f => ({ ...f, newPassword: e.target.value }))} />
          </div>
          <div>
            <Label>Confirm New Password</Label>
            <Input type="password" className="mt-1" value={pwForm.confirmPassword}
              onChange={e => setPwForm(f => ({ ...f, confirmPassword: e.target.value }))} />
          </div>
          <Button
            onClick={handlePasswordChange}
            disabled={!pwForm.currentPassword || !pwForm.newPassword || passwordMutation.isPending}
            variant="outline" className="gap-2"
          >
            {passwordMutation.isPending
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Changing...</>
              : <><Shield className="w-4 h-4" /> Change Password</>}
          </Button>
        </CardContent>
      </Card>

      {/* ── Sign out ── */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold text-red-600">Sign Out</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-gray-500 mb-4">Sign out of your account on this device.</p>
          <Button variant="outline" className="gap-2 text-red-600 border-red-200 hover:bg-red-50" onClick={logout}>
            <LogOut className="w-4 h-4" /> Sign Out
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
