'use client'

import { useParams, useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { useRef } from 'react'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { getAvatarUrl } from '@/lib/avatar'
import { format } from 'date-fns'
import {
  ArrowLeft, Printer, Download, GraduationCap,
  CheckCircle, XCircle, Clock, Star, BookMarked,
  TrendingUp, Award, User,
} from 'lucide-react'
import Link from 'next/link'
import { cn } from '@/lib/utils'

function getLetterGrade(pct: number): { letter: string; color: string } {
  if (pct >= 90) return { letter: 'A+', color: 'text-green-700 bg-green-100' }
  if (pct >= 80) return { letter: 'A',  color: 'text-green-600 bg-green-50' }
  if (pct >= 75) return { letter: 'B+', color: 'text-blue-700 bg-blue-100' }
  if (pct >= 70) return { letter: 'B',  color: 'text-blue-600 bg-blue-50' }
  if (pct >= 65) return { letter: 'C+', color: 'text-yellow-700 bg-yellow-100' }
  if (pct >= 60) return { letter: 'C',  color: 'text-yellow-600 bg-yellow-50' }
  return { letter: 'F', color: 'text-red-700 bg-red-100' }
}

export default function StudentReportCardPage() {
  const { id }  = useParams<{ id: string }>()
  const router  = useRouter()
  const printRef = useRef<HTMLDivElement>(null)

  const { data: student, isLoading: studentLoading } = useQuery({
    queryKey: ['student', id],
    queryFn:  () => api.get(`/students/${id}`).then(r => r.data.data),
  })

  const { data: gradesData, isLoading: gradesLoading } = useQuery({
    queryKey: ['grades', 'student', id],
    queryFn:  () => api.get(`/grades/student/${id}`).then(r => r.data.data),
    enabled: !!id,
  })

  const { data: attendanceData, isLoading: attLoading } = useQuery({
    queryKey: ['attendance', 'student', id],
    queryFn:  () => api.get(`/attendance/student/${id}`, { params: { limit: 200 } }).then(r => r.data),
    enabled: !!id,
  })

  const { data: behaviorData } = useQuery({
    queryKey: ['behavior', 'student', id],
    queryFn: () => api.get(`/behavior/student/${id}`).then(r => r.data),
    enabled: !!id,
  })

  const isLoading = studentLoading || gradesLoading || attLoading

  if (isLoading) {
    return (
      <div className="space-y-4 max-w-3xl">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    )
  }

  if (!student) {
    return (
      <div className="text-center py-16">
        <p className="text-gray-500">Student not found</p>
        <Link href="/students"><Button variant="outline" className="mt-4">Back to Students</Button></Link>
      </div>
    )
  }

  const grades          = gradesData?.grades ?? []
  const gradeSummary    = gradesData?.summary ?? {}
  const attendance      = attendanceData?.data?.records ?? []
  const attStats        = attendanceData?.data?.stats ?? {}
  const behaviorLogs    = behaviorData?.data?.logs ?? []
  const behaviorStats   = behaviorData?.data?.stats ?? {}

  // Group grades by class
  const gradesByClass: Record<string, typeof grades> = {}
  for (const g of grades) {
    const key = g.class?.name ?? 'General'
    if (!gradesByClass[key]) gradesByClass[key] = []
    gradesByClass[key].push(g)
  }

  const handlePrint = () => {
    window.print()
  }

  const schoolName = student.school?.name ?? 'School'
  const studentName = `${student.user?.firstName} ${student.user?.lastName}`
  const generatedAt = format(new Date(), 'MMMM d, yyyy')

  return (
    <div className="space-y-4 max-w-3xl">
      {/* Toolbar — hidden on print */}
      <div className="flex items-center justify-between print:hidden">
        <Link href={`/students/${id}`} className="flex items-center gap-2 text-gray-500 hover:text-gray-700 text-sm">
          <ArrowLeft className="w-4 h-4" /> Back to Student
        </Link>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handlePrint} className="gap-2">
            <Printer className="w-4 h-4" /> Print
          </Button>
        </div>
      </div>

      {/* Report card — printable */}
      <div
        ref={printRef}
        className="bg-white border border-gray-200 rounded-2xl shadow-sm p-8 space-y-8 print:shadow-none print:border-0 print:rounded-none"
        style={{ fontFamily: 'Georgia, serif' }}
      >
        {/* Header */}
        <div className="text-center border-b border-gray-200 pb-6">
          <div className="flex justify-center mb-3">
            <div className="w-16 h-16 bg-halqa-100 rounded-full flex items-center justify-center">
              <GraduationCap className="w-8 h-8 text-halqa-700" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">{schoolName}</h1>
          <p className="text-sm text-gray-500 mt-1">Student Progress Report Card</p>
          <p className="text-xs text-gray-400 mt-0.5">Generated on {generatedAt}</p>
        </div>

        {/* Student info */}
        <div className="flex items-center gap-6">
          <Avatar className="w-20 h-20 flex-shrink-0">
            <AvatarImage src={getAvatarUrl(student.user?.avatarUrl)} />
            <AvatarFallback className="bg-halqa-100 text-halqa-700 text-xl font-bold">
              {student.user?.firstName?.[0]}{student.user?.lastName?.[0]}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-gray-500 text-xs uppercase tracking-wider font-semibold">Student Name</p>
              <p className="font-bold text-gray-900 text-lg">{studentName}</p>
            </div>
            <div>
              <p className="text-gray-500 text-xs uppercase tracking-wider font-semibold">Student ID</p>
              <p className="font-semibold text-gray-700">{student.studentId}</p>
            </div>
            <div>
              <p className="text-gray-500 text-xs uppercase tracking-wider font-semibold">Grade Level</p>
              <p className="font-semibold text-gray-700">{student.gradeLevel ?? '—'}</p>
            </div>
            <div>
              <p className="text-gray-500 text-xs uppercase tracking-wider font-semibold">Classes Enrolled</p>
              <p className="font-semibold text-gray-700">{student.enrollments?.length ?? 0}</p>
            </div>
          </div>
        </div>

        {/* Summary stats */}
        <div className="grid grid-cols-4 gap-4">
          {[
            { label: 'GPA',           value: gradeSummary.gpa ?? '—',               icon: Award,         color: 'bg-halqa-50 text-halqa-700' },
            { label: 'Avg Grade',     value: `${gradeSummary.average?.toFixed(1) ?? '—'}%`, icon: BookMarked, color: 'bg-blue-50 text-blue-700' },
            { label: 'Attendance',    value: `${attStats.percentage ?? 0}%`,          icon: CheckCircle,   color: 'bg-green-50 text-green-700' },
            { label: 'Behavior Pts',  value: `${(behaviorStats.totalPoints ?? 0) >= 0 ? '+' : ''}${behaviorStats.totalPoints ?? 0}`, icon: Star, color: (behaviorStats.totalPoints ?? 0) >= 0 ? 'bg-yellow-50 text-yellow-700' : 'bg-red-50 text-red-700' },
          ].map(item => {
            const Icon = item.icon
            return (
              <div key={item.label} className={cn('rounded-xl p-4 text-center', item.color)}>
                <Icon className="w-5 h-5 mx-auto mb-1" />
                <p className="text-2xl font-bold leading-tight">{item.value}</p>
                <p className="text-xs font-medium mt-0.5">{item.label}</p>
              </div>
            )
          })}
        </div>

        {/* Grades by class */}
        {Object.keys(gradesByClass).length > 0 && (
          <div>
            <h2 className="text-base font-bold text-gray-800 mb-3 flex items-center gap-2">
              <BookMarked className="w-4 h-4 text-halqa-600" /> Academic Performance
            </h2>
            <div className="space-y-6">
              {Object.entries(gradesByClass).map(([className, classGrades]) => {
                const avg = classGrades.reduce((s: number, g: { percentage?: number | null }) => s + (g.percentage ?? 0), 0) / classGrades.length
                const { letter, color } = getLetterGrade(avg)
                return (
                  <div key={className}>
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-semibold text-gray-700 text-sm">{className}</h3>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-500">Class Avg: {avg.toFixed(1)}%</span>
                        <span className={cn('px-2 py-0.5 rounded-full text-xs font-bold', color)}>{letter}</span>
                      </div>
                    </div>
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="bg-gray-50">
                          <th className="text-left px-3 py-2 font-semibold text-gray-600 border border-gray-200">Assessment</th>
                          <th className="text-center px-3 py-2 font-semibold text-gray-600 border border-gray-200">Type</th>
                          <th className="text-center px-3 py-2 font-semibold text-gray-600 border border-gray-200">Score</th>
                          <th className="text-center px-3 py-2 font-semibold text-gray-600 border border-gray-200">%</th>
                          <th className="text-center px-3 py-2 font-semibold text-gray-600 border border-gray-200">Grade</th>
                        </tr>
                      </thead>
                      <tbody>
                        {classGrades.map((g: any) => {
                          const pct = g.percentage ?? ((g.score / g.maxScore) * 100)
                          const { letter: gl, color: gc } = getLetterGrade(pct)
                          return (
                            <tr key={g.id} className="border border-gray-200 even:bg-gray-50/50">
                              <td className="px-3 py-2 text-gray-800">{g.title}</td>
                              <td className="px-3 py-2 text-center">
                                <span className="px-1.5 py-0.5 bg-gray-100 rounded text-[10px] uppercase font-medium">{g.type}</span>
                              </td>
                              <td className="px-3 py-2 text-center text-gray-700">{g.score}/{g.maxScore}</td>
                              <td className="px-3 py-2 text-center text-gray-700">{pct.toFixed(1)}%</td>
                              <td className="px-3 py-2 text-center">
                                <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-bold', gc)}>{gl}</span>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Attendance summary */}
        <div>
          <h2 className="text-base font-bold text-gray-800 mb-3 flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-green-600" /> Attendance Summary
          </h2>
          <div className="grid grid-cols-5 gap-3 text-center text-sm">
            {[
              { label: 'Present',  value: attStats.present  ?? 0, color: 'text-green-700  bg-green-50' },
              { label: 'Absent',   value: attStats.absent   ?? 0, color: 'text-red-700    bg-red-50' },
              { label: 'Late',     value: attStats.late     ?? 0, color: 'text-yellow-700 bg-yellow-50' },
              { label: 'Excused',  value: attStats.excused  ?? 0, color: 'text-blue-700   bg-blue-50' },
              { label: 'Rate',     value: `${attStats.percentage ?? 0}%`, color: 'text-halqa-700 bg-halqa-50' },
            ].map(s => (
              <div key={s.label} className={cn('rounded-xl p-3', s.color)}>
                <p className="text-2xl font-bold">{s.value}</p>
                <p className="text-xs font-medium">{s.label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Behavior */}
        {behaviorLogs.length > 0 && (
          <div>
            <h2 className="text-base font-bold text-gray-800 mb-3 flex items-center gap-2">
              <Star className="w-4 h-4 text-yellow-600" /> Behavior & Conduct
            </h2>
            <div className="grid grid-cols-3 gap-3 text-center text-sm mb-4">
              <div className="rounded-xl p-3 bg-gray-50">
                <p className={cn('text-2xl font-bold', (behaviorStats.totalPoints ?? 0) >= 0 ? 'text-green-700' : 'text-red-700')}>
                  {(behaviorStats.totalPoints ?? 0) >= 0 ? '+' : ''}{behaviorStats.totalPoints ?? 0}
                </p>
                <p className="text-xs font-medium text-gray-500">Net Points</p>
              </div>
              <div className="rounded-xl p-3 bg-green-50">
                <p className="text-2xl font-bold text-green-700">{behaviorStats.positive ?? 0}</p>
                <p className="text-xs font-medium text-green-600">Positive</p>
              </div>
              <div className="rounded-xl p-3 bg-red-50">
                <p className="text-2xl font-bold text-red-700">{behaviorStats.negative ?? 0}</p>
                <p className="text-xs font-medium text-red-600">Negative</p>
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="border-t border-gray-200 pt-4 flex items-start justify-between text-xs text-gray-400">
          <div>
            <p className="font-semibold text-gray-600">{schoolName}</p>
            <p>Report generated on {generatedAt}</p>
          </div>
          <div className="text-right">
            <p>Student ID: {student.studentId}</p>
            <p className="font-semibold text-gray-600">{studentName}</p>
          </div>
        </div>
      </div>

      {/* Print styles */}
      <style jsx global>{`
        @media print {
          body > *:not(.print-target) { display: none; }
          nav, aside, header, .print\\:hidden { display: none !important; }
          @page { margin: 1cm; size: A4 portrait; }
        }
      `}</style>
    </div>
  )
}
