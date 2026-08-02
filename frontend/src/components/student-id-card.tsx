'use client'

import { useRef } from 'react'
import { Printer, Download, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getAvatarUrl } from '@/lib/avatar'
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
    school?: { name: string; logoUrl?: string | null }
  }
  schoolName?: string
  onClose: () => void
}

export function StudentIdCard({ student, schoolName, onClose }: StudentIdCardProps) {
  const cardRef = useRef<HTMLDivElement>(null)

  const handlePrint = () => window.print()

  const classes = student.enrollments?.map(e => e.class.name).join(', ') || '—'
  const avatarSrc = getAvatarUrl(student.user.avatarUrl)
  const initials = `${student.user.firstName[0]}${student.user.lastName[0]}`

  // QR code URL using a free API (no library needed)
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
            {/* Header band */}
            <div className="bg-halqa-800 px-4 py-2 flex items-center justify-between">
              <div>
                <p className="text-white font-bold text-sm leading-tight">
                  {schoolName || student.school?.name || 'Halqa Academy'}
                </p>
                <p className="text-halqa-300 text-xs">Student Identification Card</p>
              </div>
              <div className="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-sm">H</span>
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

              {/* Info */}
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

      {/* Print-only styles */}
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
