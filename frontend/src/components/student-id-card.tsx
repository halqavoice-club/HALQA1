'use client'

/**
 * StudentIdCard
 *
 * ID CARD SCHOOL OWNERSHIP INVARIANT:
 *   The school name and school logo on this card ALWAYS come from
 *   student.school — the school record fetched by the backend for
 *   THIS student's own enrollment (Student.schoolId → School).
 *
 *   They NEVER come from:
 *     - The currently logged-in admin's school
 *     - The frontend school context / Zustand school store
 *     - Any hardcoded string ("Halqa Academy", etc.)
 *     - Any prop that could be overridden by caller context
 *
 *   The backend (GET /students/:id) is the authoritative source and
 *   always includes { school: { id, name, logoUrl, ... } } in the
 *   response from the student's own School record.
 */

import { useRef } from 'react'
import { Printer, X, School } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getFileUrl } from '@/lib/avatar'
import { format } from 'date-fns'

interface StudentIdCardProps {
  student: {
    studentId: string
    qrCode: string | null
    gradeLevel?: string | null
    user: {
      firstName: string
      lastName: string
      email: string
      avatarUrl?: string | null
      dateOfBirth?: string | null
    }
    enrollments?: { class: { name: string } }[]
    // ID-CARD-01: school is the authoritative source of school branding.
    // The backend MUST include this via Student → School relation.
    // The frontend must NOT substitute with any other school context.
    school?: {
      id: string
      name: string
      logoUrl?: string | null
      address?: string | null
      phone?: string | null
    } | null
  }
  onClose: () => void
}

export function StudentIdCard({ student, onClose }: StudentIdCardProps) {
  const cardRef = useRef<HTMLDivElement>(null)

  const handlePrint = () => window.print()

  const classes = student.enrollments?.map(e => e.class.name).join(', ') || '—'

  // Avatar: student's own photo
  const avatarSrc = student.user.avatarUrl
    ? getFileUrl(student.user.avatarUrl)
    : null
  const initials = `${student.user.firstName[0]}${student.user.lastName[0]}`

  // ID-CARD-02: School branding — ALWAYS from student.school (backend-authoritative).
  // Do NOT fall back to any admin/teacher school context.
  // If the school record is missing (school deleted/inactive), show a safe
  // neutral placeholder — never substitute another school's branding.
  const school = student.school
  const schoolName  = school?.name    ?? '(School not available)'
  const schoolLogo  = school?.logoUrl ? getFileUrl(school.logoUrl) : null

  // QR code URL using free API — encodes the student's own QR token
  const qrValue = student.qrCode || student.studentId
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(qrValue)}&bgcolor=ffffff&color=1e3a8a`

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">

        {/* Modal header */}
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="font-semibold text-gray-900">Student ID Card</h3>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={handlePrint} className="gap-2 no-print">
              <Printer className="w-4 h-4" /> Print
            </Button>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 no-print">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* ID Card */}
        <div className="p-4" ref={cardRef}>
          <div
            id="student-id-card"
            className="relative rounded-xl overflow-hidden border-2 border-halqa-700"
            style={{ width: '100%', aspectRatio: '1.586' }}
          >
            {/* ── Header band ─────────────────────────────────────────────
                ID-CARD-03: school name and logo come ONLY from student.school.
                Never from the admin's school context or any hardcoded value.
            ─────────────────────────────────────────────────────────────── */}
            <div className="bg-halqa-800 px-4 py-2 flex items-center justify-between">
              <div>
                <p className="text-white font-bold text-sm leading-tight">
                  {schoolName}
                </p>
                <p className="text-halqa-300 text-xs">Student Identification Card</p>
              </div>

              {/* School logo — from student's own school record only */}
              <div className="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center overflow-hidden flex-shrink-0">
                {schoolLogo ? (
                  <img
                    src={schoolLogo}
                    alt={schoolName}
                    className="w-full h-full object-contain p-0.5"
                    onError={(e) => {
                      // If logo fails to load, show neutral school icon
                      (e.target as HTMLImageElement).style.display = 'none'
                    }}
                  />
                ) : (
                  // ID-CARD-04: Neutral placeholder — NEVER another school's logo.
                  // School icon represents "a school" generically, not Halqa specifically.
                  <School className="w-5 h-5 text-white/80" />
                )}
              </div>
            </div>

            {/* Card body */}
            <div className="bg-white px-4 py-3 flex gap-3">
              {/* Avatar */}
              <div className="flex-shrink-0">
                {avatarSrc ? (
                  <img
                    src={avatarSrc}
                    alt={`${student.user.firstName} ${student.user.lastName}`}
                    className="w-16 h-16 rounded-lg object-cover border-2 border-halqa-200"
                  />
                ) : (
                  <div className="w-16 h-16 rounded-lg bg-halqa-100 border-2 border-halqa-200 flex items-center justify-center">
                    <span className="text-halqa-700 font-bold text-xl">{initials}</span>
                  </div>
                )}
              </div>

              {/* Student info */}
              <div className="flex-1 min-w-0">
                <p className="font-bold text-gray-900 text-base leading-tight truncate">
                  {student.user.firstName} {student.user.lastName}
                </p>
                <p className="text-halqa-700 font-semibold text-xs mt-0.5">{student.studentId}</p>
                <div className="mt-1.5 space-y-0.5">
                  <p className="text-gray-500 text-xs truncate">📚 {classes}</p>
                  {student.gradeLevel && (
                    <p className="text-gray-500 text-xs">🎓 {student.gradeLevel}</p>
                  )}
                  {student.user.dateOfBirth && (
                    <p className="text-gray-500 text-xs">
                      📅 {format(new Date(student.user.dateOfBirth), 'MMM d, yyyy')}
                    </p>
                  )}
                </div>
              </div>

              {/* QR Code */}
              <div className="flex-shrink-0 flex flex-col items-center gap-1">
                <img
                  src={qrUrl}
                  alt="QR Code"
                  className="w-16 h-16 rounded border border-gray-200"
                  crossOrigin="anonymous"
                />
                <p className="text-gray-400 text-[9px] font-mono">{qrValue}</p>
              </div>
            </div>

            {/* Footer band */}
            <div className="bg-halqa-50 border-t border-halqa-100 px-4 py-1.5 flex items-center justify-between">
              <p className="text-halqa-600 text-xs">
                Issued: {format(new Date(), 'MMM yyyy')}
              </p>
              <p className="text-halqa-400 text-xs">Scan QR for attendance</p>
            </div>
          </div>
        </div>

        {/* Print hint */}
        <p className="text-xs text-gray-400 text-center pb-4 no-print">
          Use Ctrl+P or the Print button to print this card
        </p>
      </div>

      {/* Print-only styles — same card, same school branding */}
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
          }
          .no-print { display: none !important; }
        }
      `}</style>
    </div>
  )
}
