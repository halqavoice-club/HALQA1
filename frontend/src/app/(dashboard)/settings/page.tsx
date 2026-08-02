'use client'

import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Separator } from '@/components/ui/separator'
import { useToast } from '@/components/ui/use-toast'
import { useAuthStore } from '@/store/auth.store'
import { Settings, Bell, Shield, School, User, Save, Loader2, Globe, Sun, Moon, Monitor } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorState } from '@/components/ui/error-state'
import { useThemeStore, type Theme } from '@/store/theme.store'
import { LANGUAGE_OPTIONS, type Language } from '@/lib/i18n/translations'
import { useTranslation } from '@/hooks/useTranslation'
import { SchoolLogoUpload } from '@/components/school-logo-upload'

function getLangFlag(lang: Language): string {
  const flags: Record<Language, string> = { en:'🇬🇧', ar:'🇸🇦', om:'🇪🇹', am:'🇪🇹', so:'🇸🇴' }
  return flags[lang] ?? '🌐'
}

export default function SettingsPage() {
  const { user } = useAuthStore()
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const { data: schoolData, isError: schoolError, refetch: refetchSchool } = useQuery({
    queryKey: ['school', user?.schoolId],
    queryFn: () => api.get(`/schools/${user?.schoolId}`).then(r => r.data.data),
    enabled: !!user?.schoolId
  })

  const [schoolForm, setSchoolForm] = useState({
    name: '', phone: '', email: '', address: '', city: '',
    timezone: 'America/New_York'
  })

  const [settingsForm, setSettingsForm] = useState({
    schoolStartTime: '08:00', schoolEndTime: '15:00',
    allowSelfCheckIn: true, requireGpsCheckIn: false,
    parentNotifications: true, emailEnabled: true,
    smsEnabled: false, maxAbsenceAlert: 3, passingGrade: 60
  })

  // Populate forms when school data loads
  useEffect(() => {
    if (schoolData) {
      setSchoolForm({
        name: schoolData.name || '',
        phone: schoolData.phone || '',
        email: schoolData.email || '',
        address: schoolData.address || '',
        city: schoolData.city || '',
        timezone: schoolData.timezone || 'America/New_York'
      })
      if (schoolData.settings) {
        setSettingsForm({
          schoolStartTime: schoolData.settings.schoolStartTime || '08:00',
          schoolEndTime: schoolData.settings.schoolEndTime || '15:00',
          allowSelfCheckIn: schoolData.settings.allowSelfCheckIn ?? true,
          requireGpsCheckIn: schoolData.settings.requireGpsCheckIn ?? false,
          parentNotifications: schoolData.settings.parentNotifications ?? true,
          emailEnabled: schoolData.settings.emailEnabled ?? true,
          smsEnabled: schoolData.settings.smsEnabled ?? false,
          maxAbsenceAlert: schoolData.settings.maxAbsenceAlert || 3,
          passingGrade: schoolData.settings.passingGrade || 60
        })
      }
    }
  }, [schoolData])

  const [profileForm, setProfileForm] = useState({
    firstName: user?.firstName || '',
    lastName: user?.lastName || '',
    phone: '',
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  })

  const schoolMutation = useMutation({
    mutationFn: (d: any) => api.put(`/schools/${user?.schoolId}`, d),
    onSuccess: () => {
      toast({ title: 'School info updated' })
      queryClient.invalidateQueries({ queryKey: ['school'] })
    },
    onError: () => toast({ title: 'Update failed', variant: 'destructive' })
  })

  const settingsMutation = useMutation({
    mutationFn: (d: any) => api.put(`/schools/${user?.schoolId}/settings`, d),
    onSuccess: () => toast({ title: 'Settings saved' }),
    onError: () => toast({ title: 'Save failed', variant: 'destructive' })
  })

  const profileMutation = useMutation({
    mutationFn: (d: any) => api.put('/users/profile', d),
    onSuccess: () => toast({ title: 'Profile updated' }),
    onError: () => toast({ title: 'Update failed', variant: 'destructive' })
  })

  const passwordMutation = useMutation({
    mutationFn: (d: any) => api.put('/auth/change-password', d),
    onSuccess: () => {
      toast({ title: 'Password changed' })
      setProfileForm(f => ({ ...f, currentPassword: '', newPassword: '', confirmPassword: '' }))
    },
    onError: (err: any) => toast({ title: err.response?.data?.message || 'Failed', variant: 'destructive' })
  })

  const isAdmin = ['SUPER_ADMIN', 'SCHOOL_ADMIN'].includes(user?.role || '')
  const { theme, language, setTheme, setLanguage } = useThemeStore()
  const { t } = useTranslation()

  // Show skeleton while school data loads for admins
  const isLoadingSchool = isAdmin && !!user?.schoolId && !schoolData

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-gray-500 text-sm">Manage your account and school configuration</p>
      </div>

      {isLoadingSchool && (
        <div className="space-y-3">
          <Skeleton className="h-10 w-64 rounded-lg" />
          <Skeleton className="h-48 rounded-xl" />
        </div>
      )}

      <Tabs defaultValue="profile">
        <TabsList className={`grid w-full ${isAdmin ? 'grid-cols-4' : 'grid-cols-2'}`}>
          <TabsTrigger value="profile" className="gap-2"><User className="w-4 h-4" /> {t.profile}</TabsTrigger>
          <TabsTrigger value="appearance" className="gap-2"><Sun className="w-4 h-4" /> {t.theme}</TabsTrigger>
          {isAdmin && <TabsTrigger value="school" className="gap-2"><School className="w-4 h-4" /> School</TabsTrigger>}
          {isAdmin && <TabsTrigger value="notifications" className="gap-2"><Bell className="w-4 h-4" /> Notifications</TabsTrigger>}
        </TabsList>

        {/* Profile tab */}
        <TabsContent value="profile" className="space-y-4 mt-4">
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">Personal Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>First Name</Label>
                  <Input className="mt-1" value={profileForm.firstName}
                    onChange={e => setProfileForm(f => ({ ...f, firstName: e.target.value }))} />
                </div>
                <div>
                  <Label>Last Name</Label>
                  <Input className="mt-1" value={profileForm.lastName}
                    onChange={e => setProfileForm(f => ({ ...f, lastName: e.target.value }))} />
                </div>
              </div>
              <div>
                <Label>Email</Label>
                <Input className="mt-1 bg-gray-50" value={user?.email || ''} disabled />
                <p className="text-xs text-gray-400 mt-1">Email cannot be changed</p>
              </div>
              <div>
                <Label>Phone</Label>
                <Input className="mt-1" placeholder="+1 555 0100" value={profileForm.phone}
                  onChange={e => setProfileForm(f => ({ ...f, phone: e.target.value }))} />
              </div>
              <Button
                onClick={() => profileMutation.mutate({ firstName: profileForm.firstName, lastName: profileForm.lastName, phone: profileForm.phone })}
                disabled={profileMutation.isPending}
                className="bg-halqa-700 hover:bg-halqa-800 gap-2"
              >
                {profileMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save Profile
              </Button>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Shield className="w-4 h-4" /> Privacy &amp; Safety
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between py-2">
                <div>
                  <p className="text-sm font-medium text-gray-800">Blocked Users</p>
                  <p className="text-xs text-gray-400">Manage users you've blocked</p>
                </div>
                <a
                  href="/settings/blocked"
                  className="text-xs text-indigo-600 hover:text-indigo-700 font-semibold bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-xl transition-colors"
                >
                  Manage →
                </a>
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Shield className="w-4 h-4" /> Change Password
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Current Password</Label>
                <Input type="password" className="mt-1" value={profileForm.currentPassword}
                  onChange={e => setProfileForm(f => ({ ...f, currentPassword: e.target.value }))} />
              </div>
              <div>
                <Label>New Password</Label>
                <Input type="password" className="mt-1" value={profileForm.newPassword}
                  onChange={e => setProfileForm(f => ({ ...f, newPassword: e.target.value }))} />
              </div>
              <div>
                <Label>Confirm New Password</Label>
                <Input type="password" className="mt-1" value={profileForm.confirmPassword}
                  onChange={e => setProfileForm(f => ({ ...f, confirmPassword: e.target.value }))} />
              </div>
              <Button
                onClick={() => {
                  if (profileForm.newPassword !== profileForm.confirmPassword) {
                    toast({ title: "Passwords don't match", variant: 'destructive' }); return
                  }
                  passwordMutation.mutate({ currentPassword: profileForm.currentPassword, newPassword: profileForm.newPassword })
                }}
                disabled={!profileForm.currentPassword || !profileForm.newPassword || passwordMutation.isPending}
                variant="outline"
                className="gap-2"
              >
                {passwordMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
                Change Password
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Appearance tab */}
        <TabsContent value="appearance" className="space-y-4 mt-4">
          {/* Language */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Globe className="w-4 h-4" /> {t.language}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                {LANGUAGE_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => setLanguage(opt.value as Language)}
                    className={`flex items-center gap-3 p-3 rounded-xl border-2 transition-all text-left ${
                      language === opt.value
                        ? 'border-halqa-600 bg-halqa-50'
                        : 'border-gray-200 hover:border-halqa-300 hover:bg-gray-50'
                    }`}
                  >
                    <span className="text-2xl">{getLangFlag(opt.value as Language)}</span>
                    <div>
                      <p className={`text-sm font-semibold ${language === opt.value ? 'text-halqa-700' : 'text-gray-900'}`}>
                        {opt.nativeLabel}
                      </p>
                      <p className="text-xs text-gray-400">{opt.label}</p>
                    </div>
                    {language === opt.value && (
                      <div className="ml-auto w-2 h-2 rounded-full bg-halqa-600" />
                    )}
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Theme */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Sun className="w-4 h-4" /> {t.theme}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-3">
                {([
                  { value: 'light', label: t.lightMode, icon: Sun, preview: 'bg-white border-gray-200' },
                  { value: 'dark',  label: t.darkMode,  icon: Moon, preview: 'bg-gray-900 border-gray-700' },
                  { value: 'system',label: t.systemMode,icon: Monitor, preview: 'bg-gradient-to-br from-white to-gray-900 border-gray-400' },
                ] as const).map(opt => {
                  const Icon = opt.icon
                  return (
                    <button
                      key={opt.value}
                      onClick={() => setTheme(opt.value as Theme)}
                      className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all ${
                        theme === opt.value
                          ? 'border-halqa-600 bg-halqa-50'
                          : 'border-gray-200 hover:border-halqa-300'
                      }`}
                    >
                      <div className={`w-12 h-8 rounded-lg border ${opt.preview} flex items-center justify-center`}>
                        <Icon className={`w-4 h-4 ${opt.value === 'dark' ? 'text-white' : 'text-gray-600'}`} />
                      </div>
                      <span className={`text-sm font-medium ${theme === opt.value ? 'text-halqa-700' : 'text-gray-700'}`}>
                        {opt.label}
                      </span>
                    </button>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* School tab */}
        {isAdmin && (          <TabsContent value="school" className="space-y-4 mt-4">
            {schoolError ? (
              <ErrorState onRetry={refetchSchool} />
            ) : (
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold">School Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Logo upload */}
                {user?.schoolId && (
                  <div className="pb-4 border-b border-gray-100">
                    <SchoolLogoUpload
                      schoolId={user.schoolId}
                      currentLogoUrl={schoolData?.logoUrl}
                      schoolName={schoolForm.name || 'School'}
                      onUpdated={() => queryClient.invalidateQueries({ queryKey: ['school'] })}
                    />
                  </div>
                )}
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <Label>School Name</Label>
                    <Input className="mt-1" value={schoolForm.name}
                      onChange={e => setSchoolForm(f => ({ ...f, name: e.target.value }))} />
                  </div>
                  <div>
                    <Label>Phone</Label>
                    <Input className="mt-1" value={schoolForm.phone}
                      onChange={e => setSchoolForm(f => ({ ...f, phone: e.target.value }))} />
                  </div>
                  <div>
                    <Label>Email</Label>
                    <Input type="email" className="mt-1" value={schoolForm.email}
                      onChange={e => setSchoolForm(f => ({ ...f, email: e.target.value }))} />
                  </div>
                  <div className="col-span-2">
                    <Label>Address</Label>
                    <Input className="mt-1" value={schoolForm.address}
                      onChange={e => setSchoolForm(f => ({ ...f, address: e.target.value }))} />
                  </div>
                  <div>
                    <Label>City</Label>
                    <Input className="mt-1" value={schoolForm.city}
                      onChange={e => setSchoolForm(f => ({ ...f, city: e.target.value }))} />
                  </div>
                  <div>
                    <Label>Timezone</Label>
                    <Input className="mt-1" value={schoolForm.timezone}
                      onChange={e => setSchoolForm(f => ({ ...f, timezone: e.target.value }))} />
                  </div>
                </div>

                <Separator />

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>School Start Time</Label>
                    <Input type="time" className="mt-1" value={settingsForm.schoolStartTime}
                      onChange={e => setSettingsForm(f => ({ ...f, schoolStartTime: e.target.value }))} />
                  </div>
                  <div>
                    <Label>School End Time</Label>
                    <Input type="time" className="mt-1" value={settingsForm.schoolEndTime}
                      onChange={e => setSettingsForm(f => ({ ...f, schoolEndTime: e.target.value }))} />
                  </div>
                  <div>
                    <Label>Passing Grade (%)</Label>
                    <Input type="number" className="mt-1" value={settingsForm.passingGrade}
                      onChange={e => setSettingsForm(f => ({ ...f, passingGrade: Number(e.target.value) }))} />
                  </div>
                  <div>
                    <Label>Max Absence Alert (days)</Label>
                    <Input type="number" className="mt-1" value={settingsForm.maxAbsenceAlert}
                      onChange={e => setSettingsForm(f => ({ ...f, maxAbsenceAlert: Number(e.target.value) }))} />
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button onClick={() => schoolMutation.mutate(schoolForm)} disabled={schoolMutation.isPending}
                    className="bg-halqa-700 hover:bg-halqa-800 gap-2">
                    {schoolMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    Save School Info
                  </Button>
                  <Button onClick={() => settingsMutation.mutate(settingsForm)} disabled={settingsMutation.isPending}
                    variant="outline" className="gap-2">
                    {settingsMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Settings className="w-4 h-4" />}
                    Save Settings
                  </Button>
                </div>
              </CardContent>
            </Card>
            )}
          </TabsContent>
        )}

        {/* Notifications tab */}
        {isAdmin && (
          <TabsContent value="notifications" className="space-y-4 mt-4">
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold">Notification Settings</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                {[
                  { key: 'parentNotifications', label: 'Parent Notifications', desc: 'Send alerts to parents for attendance and behavior' },
                  { key: 'emailEnabled', label: 'Email Notifications', desc: 'Send notifications via email' },
                  { key: 'smsEnabled', label: 'SMS Notifications', desc: 'Send notifications via SMS (requires SMS provider)' },
                  { key: 'allowSelfCheckIn', label: 'Allow QR Self Check-in', desc: 'Students can check in using their QR code' },
                  { key: 'requireGpsCheckIn', label: 'Require GPS for Check-in', desc: 'Verify location when checking in' },
                ].map(item => (
                  <div key={item.key} className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{item.label}</p>
                      <p className="text-xs text-gray-500">{item.desc}</p>
                    </div>
                    <Switch
                      checked={settingsForm[item.key as keyof typeof settingsForm] as boolean}
                      onCheckedChange={v => setSettingsForm(f => ({ ...f, [item.key]: v }))}
                    />
                  </div>
                ))}
                <Button onClick={() => settingsMutation.mutate(settingsForm)} disabled={settingsMutation.isPending}
                  className="bg-halqa-700 hover:bg-halqa-800 gap-2">
                  {settingsMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Save Notification Settings
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}
