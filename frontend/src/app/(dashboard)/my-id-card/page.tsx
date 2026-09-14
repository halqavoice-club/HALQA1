'use client'

/**
 * My ID Card — /my-id-card
 *
 * A student's dedicated page to view and print their own Student ID Card.
 * Fetches directly from GET /students/me — the backend returns the full
 * student record including school branding, QR code, and enrollments.
 *
 * Access: any authenticated user who has a Student record in a school.
 * Admins/teachers view cards via /students/:id instead.
 */

import { useQuery } from '@tanstack/react-query'
import api from '@/lib/api'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { GraduationCap, ArrowLeft, Printer, RefreshCw } from 'lucide-react'
import Link from 'next/link'
import { getAvatarUrl, getFileUrl } from '@/lib/avatar'
import { format } from 'date-fns'

export default function MyIdCardPage() {
  const { data: student, isLoading, isError, refetch } = useQuery({
    queryKey: ['student-me'],
    queryFn: () => api.get('/students/me').then(r => r.data.data),
    staleTime: 5 * 60_000,
    retry: 1,
  })

  if (isLoading) {
    return (
      <div className="max-w-sm mx-auto space-y-4 pt-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-56 rounded-xl" />
        <Skeleton className="h-4 w-32 mx-auto" />
      </div>
    )
  }

  if (isError || !student) {
    return (
      <div className="max-w-md mx-auto text-center pt-16 space-y-4">
        <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto">
          <GraduationCap className="w-8 h-8 text-gray-400" />
        </div>
        <h1 className="text-xl font-bold text-gray-900">No Student Record Found</h1>
        <p className="text-gray-500 text-sm">
          You don&apos;t have a student record linked to your account yet.
          Contact your school admin to add you as a student, or wait for your
          join request to be approved.
        </p>
        <div className="flex gap-3 justify-center">
          <Button variant="outline" className="gap-2" onClick={() => refetch()}>
            <RefreshCw className="w-4 h-4" /> Try Again
          </Button>
          <Link href="/education">
            <Button variant="outline" className="gap-2">
              <ArrowLeft className="w-4 h-4" /> Back to Education
            </Button>
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-sm mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/education" className="text-gray-500 hover:text-gray-700">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">My ID Card</h1>
          <p className="text-gray-500 text-sm">Your student identification card</p>
        </div>
      </div>

      <IdCardView student={student} />

      <p className="text-xs text-gray-400 text-center no-print">
        Use Ctrl+P or the Print button to print this card
      </p>
    </div>
  )
}

// ── ID Card view component ────────────────────────────────────────────────────

function IdCardView({ student }: { student: any }) {
  const handlePrint = () => window.print()

  // School branding — always from student.school (backend-authoritative)
  const school     = student.school
  const schoolName = school?.name ?? '(School not available)'
  const schoolLogo = school?.logoUrl ? getFileUrl(school.logoUrl) : null

  // Student details
  const fullName  = `${student.user?.firstName ?? ''} ${student.user?.lastName ?? ''}`.trim()
  const initials  = `${student.user?.firstName?.[0] ?? ''}${student.user?.lastName?.[0] ?? ''}`.toUpperCase()
  const avatarSrc = student.user?.avatarUrl ? getAvatarUrl(student.user.avatarUrl) : null
  const classes   = student.enrollments?.map((e: any) => e.class?.name).filter(Boolean).join(', ') || '—'

  // QR — falls back to studentId if qrCode is null (shouldn't happen after the fix)
  const qrValue = student.qrCode || student.studentId
  const qrUrl   = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(qrValue)}&bgcolor=ffffff&color=1e3a8a`

  const issuedDate = format(new Date(), 'MMM yyyy')

  return (
    <div className="space-y-3">
      {/* Print button */}
      <div className="flex justify-end no-print">
        <Button size="sm" variant="outline" onClick={handlePrint} className="gap-2">
          <Printer className="w-4 h-4" /> Print Card
        </Button>
      </div>

      {/* ── Physical card ─────────────────────────────────────────────────── */}
      <div
        id="student-id-card"
        className="rounded-xl overflow-hidden border-2 border-halqa-700 w-full shadow-md"
        style={{ aspectRatio: '1.586' }}
      >
        {/* Header band — school name + logo */}
        <div className="bg-halqa-800 px-4 py-2.5 flex items-center justify-between">
          <div className="min-w-0 flex-1">
            <p className="text-white font-bold text-sm leading-tight truncate">{schoolName}</p>
            <p className="text-halqa-300 text-[11px] mt-0.5">Student Identification Card</p>
          </div>
          <div className="w-9 h-9 bg-white/20 rounded-lg flex items-center justify-center overflow-hidden flex-shrink-0 ml-3">
            {schoolLogo ? (
              <img
                src={schoolLogo}
                alt={schoolName}
                className="w-full h-full object-contain p-0.5"
                onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
              />
            ) : (
              <span className="text-white/70 text-lg">🏫</span>
            )}
          </div>
        </div>

        {/* Card body */}
        <div className="bg-white px-4 py-3 flex gap-3 h-[calc(100%-40px-32px)]">
          {/* Student photo */}
          <div className="flex-shrink-0">
            {avatarSrc ? (
              <img
                src={avatarSrc}
                alt={fullName}
                className="w-16 h-16 rounded-lg object-cover border-2 border-halqa-200"
              />
            ) : (
              <div className="w-16 h-16 rounded-lg bg-halqa-100 border-2 border-halqa-200 flex items-center justify-center">
                <span className="text-halqa-700 font-bold text-xl">{initials}</span>
              </div>
            )}
          </div>

          {/* Info column */}
          <div className="flex-1 min-w-0">
            <p className="font-bold text-gray-900 text-[15px] leading-tight">{fullName}</p>
            <p className="text-halqa-700 font-semibold text-xs mt-0.5">{student.studentId}</p>
            <div className="mt-1.5 space-y-0.5">
              <p className="text-gray-500 text-[11px] truncate">📚 {classes}</p>
              {student.gradeLevel && (
                <p className="text-gray-500 text-[11px]">🎓 {student.gradeLevel}</p>
              )}
              {student.user?.dateOfBirth && (
                <p className="text-gray-500 text-[11px]">
                  📅 {format(new Date(student.user.dateOfBirth), 'MMM d, yyyy')}
                </p>
              )}
            </div>
          </div>

          {/* QR code */}
          <div className="flex-shrink-0 flex flex-col items-center gap-1">
            <img
              src={qrUrl}
              alt="QR Code"
              className="w-16 h-16 rounded border border-gray-200"
              crossOrigin="anonymous"
            />
            <p className="text-gray-400 text-[8px] font-mono text-center leading-tight" style={{ maxWidth: 64, wordBreak: 'break-all' }}>
              {qrValue}
            </p>
          </div>
        </div>

        {/* Footer band */}
        <div className="bg-halqa-50 border-t border-halqa-100 px-4 py-1.5 flex items-center justify-between">
          <p className="text-halqa-600 text-[10px]">Issued: {issuedDate}</p>
          <p className="text-halqa-400 text-[10px]">Scan QR for attendance</p>
        </div>
      </div>

      {/* Print styles — same card layout at physical credit-card size */}
      <style jsx global>{`
        @media print {
          body * { visibility: hidden !important; }
          #student-id-card, #student-id-card * { visibility: visible !important; }
          #student-id-card {
            position: fixed !important;
            top: 10mm !important;
            left: 10mm !important;
            width: 85.6mm !important;
            height: 54mm !important;
            aspect-ratio: auto !important;
          }
          .no-print { display: none !important; }
        }
      `}</style>
    </div>
  )
}
