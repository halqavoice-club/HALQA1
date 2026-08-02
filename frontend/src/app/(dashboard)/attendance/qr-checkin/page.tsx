'use client'

import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import api from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/use-toast'
import { useAuthStore } from '@/store/auth.store'
import { QrCode, CheckCircle, Camera, Keyboard, Printer, Users } from 'lucide-react'
import { QrScanner } from '@/components/qr-scanner'
import { ErrorState } from '@/components/ui/error-state'
import { getAvatarUrl } from '@/lib/avatar'

// QR code image URL using free API
function qrUrl(value: string, size = 120) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(value)}&bgcolor=ffffff&color=1e3a8a`
}

type CheckInMode = 'qr' | 'manual' | 'student' | 'bulk'

export default function QrCheckInPage() {
  const { toast } = useToast()
  const { user } = useAuthStore()
  const [mode, setMode] = useState<CheckInMode>('manual')
  const [classId, setClassId] = useState('')
  const [manualCode, setManualCode] = useState('')
  const [lastCheckedIn, setLastCheckedIn] = useState<any>(null)

  const isStudent = user?.role === 'STUDENT'
  const canMark = ['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER'].includes(user?.role || '')

  // Fetch own profile for student QR display
  const { data: myProfile } = useQuery({
    queryKey: ['my-profile-qr'],
    queryFn: () => api.get('/auth/me').then(r => r.data.data),
    enabled: isStudent,
  })
  const myStudentData = myProfile?.student
  const myQrCode = myStudentData?.qrCode || ''

  // Classes for teacher
  const { data: classes, isError: classesError, refetch: refetchClasses } = useQuery({
    queryKey: ['classes'],
    queryFn: () => api.get('/classes').then(r => r.data.data),
    enabled: canMark,
  })

  // Students in class for bulk QR
  const { data: classStudents, isLoading: loadingStudents } = useQuery({
    queryKey: ['class-students-qr', classId],
    queryFn: () => api.get(`/classes/${classId}`).then(r => r.data.data),
    enabled: !!classId && mode === 'bulk',
  })
  const students = classStudents?.enrollments?.map((e: any) => e.student) || []

  const checkInMutation = useMutation({
    mutationFn: (qrCode: string) => api.post('/attendance/qr-checkin', { qrCode, classId }),
    onSuccess: (res) => {
      const { student } = res.data.data
      setLastCheckedIn(student)
      setManualCode('')
      toast({ title: `✅ ${student.name} checked in!`, description: 'Attendance recorded' })
    },
    onError: (err: any) => {
      toast({ title: 'Check-in failed', description: err.response?.data?.message || 'Invalid QR code', variant: 'destructive' })
    }
  })

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!classId) { toast({ title: 'Select a class first', variant: 'destructive' }); return }
    if (manualCode.trim()) checkInMutation.mutate(manualCode.trim())
  }

  const handlePrintBulk = () => window.print()

  // ── Student view — show own QR code ──
  if (isStudent) {
    return (
      <div className="max-w-sm mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">My QR Code</h1>
          <p className="text-gray-500 text-sm">Show this to your teacher to check in</p>
        </div>

        <Card className="border-0 shadow-sm">
          <CardContent className="p-6 text-center">
            {/* Avatar */}
            <div className="w-16 h-16 rounded-full bg-halqa-100 flex items-center justify-center mx-auto mb-3 overflow-hidden">
              {myProfile?.avatarUrl ? (
                <img src={getAvatarUrl(myProfile.avatarUrl)} alt="" className="w-full h-full object-cover" />
              ) : (
                <span className="text-halqa-700 font-bold text-xl">
                  {myProfile?.firstName?.[0]}{myProfile?.lastName?.[0]}
                </span>
              )}
            </div>
            <p className="font-bold text-gray-900 text-lg">{myProfile?.firstName} {myProfile?.lastName}</p>
            <p className="text-gray-500 text-sm mb-5">{myStudentData?.studentId}</p>

            {/* QR Code */}
            {myQrCode ? (
              <div className="flex flex-col items-center gap-3">
                <div className="p-4 bg-white border-2 border-halqa-200 rounded-2xl shadow-sm inline-block">
                  <img
                    src={qrUrl(myQrCode, 200)}
                    alt="My QR Code"
                    className="w-48 h-48"
                    crossOrigin="anonymous"
                  />
                </div>
                <p className="text-xs font-mono text-gray-400 bg-gray-50 px-3 py-1 rounded-full">{myQrCode}</p>
                <Button variant="outline" size="sm" className="gap-2 no-print" onClick={() => window.print()}>
                  <Printer className="w-4 h-4" /> Print QR Card
                </Button>
              </div>
            ) : (
              <div className="py-8 text-gray-400">
                <QrCode className="w-12 h-12 mx-auto mb-2 text-gray-200" />
                <p className="text-sm">QR code not assigned yet</p>
                <p className="text-xs mt-1">Contact your teacher or admin</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Instructions */}
        <Card className="border-0 shadow-sm bg-halqa-50">
          <CardContent className="p-4">
            <p className="text-sm font-semibold text-halqa-800 mb-2">How to use</p>
            <ol className="text-xs text-halqa-700 space-y-1 list-decimal list-inside">
              <li>Show this QR code to your teacher</li>
              <li>Teacher scans it on the QR Check-in page</li>
              <li>Your attendance is recorded automatically</li>
            </ol>
          </CardContent>
        </Card>
      </div>
    )
  }

  // ── Teacher / Admin view ──
  return (
    <div className="max-w-lg mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">QR Check-in</h1>
        <p className="text-gray-500 text-sm">Scan student QR codes to mark attendance</p>
      </div>

      {/* Class selector */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-4">
          <Label>Select Class *</Label>
          {classesError ? (
            <ErrorState onRetry={refetchClasses} />
          ) : (
            <Select value={classId} onValueChange={setClassId}>
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="Choose a class" />
              </SelectTrigger>
              <SelectContent>
                {(classes || []).map((cls: any) => (
                  <SelectItem key={cls.id} value={cls.id}>{cls.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </CardContent>
      </Card>

      {/* Mode tabs */}
      <div className="grid grid-cols-4 gap-2">
        {[
          { key: 'manual'  as CheckInMode, label: 'Manual',  icon: Keyboard },
          { key: 'qr'      as CheckInMode, label: 'Scan',    icon: Camera },
          { key: 'student' as CheckInMode, label: 'Student', icon: QrCode },
          { key: 'bulk'    as CheckInMode, label: 'Bulk QR', icon: Users },
        ].map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setMode(key)}
            className={`flex flex-col items-center gap-1 py-2.5 rounded-xl text-xs font-medium transition-all border ${
              mode === key
                ? 'bg-halqa-700 text-white border-halqa-700'
                : 'bg-white text-gray-600 border-gray-200 hover:border-halqa-300'
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {/* Manual entry */}
      {mode === 'manual' && (
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <QrCode className="w-4 h-4" /> Enter QR Code / Student ID
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleManualSubmit} className="space-y-4">
              <Input
                placeholder="Type or scan QR code..."
                value={manualCode}
                onChange={e => setManualCode(e.target.value)}
                autoFocus
                className="text-center text-lg font-mono"
              />
              <Button
                type="submit"
                className="w-full bg-halqa-700 hover:bg-halqa-800"
                disabled={!manualCode || !classId || checkInMutation.isPending}
              >
                {checkInMutation.isPending ? 'Checking in...' : 'Check In'}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {/* QR Scanner */}
      {mode === 'qr' && (
        <QrScanner
          onScan={(code) => {
            if (!classId) { toast({ title: 'Select a class first', variant: 'destructive' }); return }
            checkInMutation.mutate(code)
          }}
          onError={(err) => toast({ title: err, variant: 'destructive' })}
          className="w-full"
        />
      )}

      {/* Student QR lookup */}
      {mode === 'student' && (
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">Student QR Codes</CardTitle>
          </CardHeader>
          <CardContent>
            {!classId ? (
              <p className="text-sm text-gray-500 text-center py-4">Select a class to view student QR codes</p>
            ) : loadingStudents ? (
              <div className="space-y-2">{[...Array(4)].map((_, i) => <div key={i} className="h-16 bg-gray-100 rounded-lg animate-pulse" />)}</div>
            ) : (
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {students.map((s: any) => (
                  <div key={s.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                    <div className="w-10 h-10 bg-halqa-100 rounded-full flex items-center justify-center flex-shrink-0 font-bold text-halqa-700 text-sm">
                      {s.user?.firstName?.[0]}{s.user?.lastName?.[0]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{s.user?.firstName} {s.user?.lastName}</p>
                      <p className="text-xs text-gray-400">{s.studentId}</p>
                    </div>
                    {s.qrCode ? (
                      <img src={qrUrl(s.qrCode, 48)} alt="QR" className="w-12 h-12 rounded border border-gray-200" />
                    ) : (
                      <Badge variant="outline" className="text-xs text-gray-400">No QR</Badge>
                    )}
                  </div>
                ))}
                {students.length === 0 && <p className="text-sm text-gray-500 text-center py-4">No students in this class</p>}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Bulk QR print */}
      {mode === 'bulk' && (
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold">Print QR Cards</CardTitle>
              {students.length > 0 && (
                <Button size="sm" variant="outline" className="gap-2 no-print" onClick={handlePrintBulk}>
                  <Printer className="w-4 h-4" /> Print All
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {!classId ? (
              <p className="text-sm text-gray-500 text-center py-4">Select a class to print QR cards</p>
            ) : loadingStudents ? (
              <div className="grid grid-cols-2 gap-3">{[...Array(4)].map((_, i) => <div key={i} className="h-40 bg-gray-100 rounded-xl animate-pulse" />)}</div>
            ) : (
              <div className="grid grid-cols-2 gap-3" id="qr-print-grid">
                {students.map((s: any) => (
                  <div key={s.id} className="border border-gray-200 rounded-xl p-3 text-center avoid-break">
                    <div className="w-8 h-8 bg-halqa-100 rounded-full flex items-center justify-center mx-auto mb-1 font-bold text-halqa-700 text-xs">
                      {s.user?.firstName?.[0]}{s.user?.lastName?.[0]}
                    </div>
                    <p className="text-xs font-semibold text-gray-900 truncate">{s.user?.firstName} {s.user?.lastName}</p>
                    <p className="text-[10px] text-gray-400 mb-2">{s.studentId}</p>
                    {s.qrCode ? (
                      <img src={qrUrl(s.qrCode, 80)} alt="QR" className="w-20 h-20 mx-auto rounded" />
                    ) : (
                      <div className="w-20 h-20 mx-auto bg-gray-100 rounded flex items-center justify-center">
                        <p className="text-[10px] text-gray-400">No QR</p>
                      </div>
                    )}
                  </div>
                ))}
                {students.length === 0 && <p className="text-sm text-gray-500 text-center py-4 col-span-2">No students in this class</p>}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Last checked in */}
      {lastCheckedIn && (
        <Card className="border-0 shadow-sm bg-green-50">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
                <CheckCircle className="w-6 h-6 text-green-600" />
              </div>
              <div>
                <p className="font-semibold text-green-800">Checked In Successfully</p>
                <p className="text-sm text-green-600">{lastCheckedIn.name}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
