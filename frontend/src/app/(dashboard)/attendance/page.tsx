'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { addDays, subDays, format, isToday } from 'date-fns'
import api from '@/lib/api'
import { useAuthStore } from '@/store/auth.store'
import { useEducationRole } from '@/hooks/useEducationRole'
import { useAttendanceStore, AttendanceStatus } from '@/store/attendance.store'
import { useAttendanceSync } from '@/hooks/useAttendanceSync'
import { getSocket } from '@/lib/socket'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/use-toast'
import { SearchInput } from '@/components/ui/search-input'
import { useDebounce } from '@/hooks/useDebounce'
import {
  CheckCircle2, XCircle, Clock, Circle, Timer,
  ChevronLeft, ChevronRight, RefreshCw, QrCode,
  Trash2, CheckSquare, MoreHorizontal, Wifi, WifiOff,
  ChevronRight as ArrowRight, Loader2, Check,
  ArrowUpDown, ArrowUp, ArrowDown, SlidersHorizontal, X
} from 'lucide-react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { StudentAttendanceView } from './student-view'
import { GuardianAttendanceView } from './guardian-view'

const STATUS_CONFIG: Record<AttendanceStatus, { label: string; icon: React.ElementType; bg: string; text: string; ring: string }> = {
  PRESENT:    { label: 'Present',    icon: CheckCircle2, bg: 'bg-green-500',  text: 'text-white', ring: 'ring-green-400' },
  ABSENT:     { label: 'Absent',     icon: XCircle,      bg: 'bg-red-500',    text: 'text-white', ring: 'ring-red-400' },
  LATE:       { label: 'Late',       icon: Clock,        bg: 'bg-yellow-400', text: 'text-white', ring: 'ring-yellow-300' },
  EXCUSED:    { label: 'Excused',    icon: Circle,       bg: 'bg-blue-500',   text: 'text-white', ring: 'ring-blue-400' },
  LEFT_EARLY: { label: 'Left Early', icon: Timer,        bg: 'bg-orange-500', text: 'text-white', ring: 'ring-orange-400' },
}

const STATUS_CYCLE: AttendanceStatus[] = ['PRESENT', 'ABSENT', 'LATE', 'EXCUSED', 'LEFT_EARLY']

const SORT_OPTIONS = [
  { value: 'first_name', label: 'First Name' },
  { value: 'last_name',  label: 'Last Name' },
  { value: 'student_id_no', label: 'Student ID' },
  { value: 'level',      label: 'Level / Grade' },
]

function StatusButton({ studentId, saving }: { studentId: string; saving?: string }) {
  const { attendance, cycleStatus } = useAttendanceStore()
  const status = (attendance[studentId] || 'PRESENT') as AttendanceStatus
  const cfg = STATUS_CONFIG[status]
  const Icon = cfg.icon
  const [flash, setFlash] = useState(false)
  const handleTap = (e: React.MouseEvent) => {
    e.stopPropagation()
    cycleStatus(studentId)
    setFlash(true)
    setTimeout(() => setFlash(false), 300)
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(30)
  }
  return (
    <button onClick={handleTap}
      className={cn('relative w-11 h-11 rounded-full flex items-center justify-center transition-all duration-150 active:scale-90 select-none', cfg.bg, cfg.text, flash && 'scale-110', saving === 'saving' && 'opacity-70')}
      title={cfg.label + '  tap to change'}>
      {saving === 'saving' ? <Loader2 className="w-5 h-5 animate-spin" /> : saving === 'saved' ? <Check className="w-5 h-5 animate-bounce" /> : <Icon className="w-5 h-5" />}
      {flash && <span className={cn('absolute inset-0 rounded-full ring-4 animate-ping opacity-60', cfg.ring)} />}
    </button>
  )
}

function StudentRow({ student, index, isSelected, onSelect, onLongPress, debouncedSync, classId, date }: {
  student: any; index: number; isSelected: boolean; onSelect: () => void; onLongPress: () => void; debouncedSync: (id: string, status: string) => void; classId: string; date: string
}) {
  const { attendance, savingStates } = useAttendanceStore()
  const status = (attendance[student.id] || 'PRESENT') as AttendanceStatus
  const cfg = STATUS_CONFIG[status]
  const longPressTimer = useRef<ReturnType<typeof setTimeout>>()
  const currentStatus = attendance[student.id]
  useEffect(() => { if (currentStatus) debouncedSync(student.id, currentStatus) }, [currentStatus, student.id, debouncedSync])
  const handleTouchStart = () => { longPressTimer.current = setTimeout(onLongPress, 600) }
  const handleTouchEnd = () => clearTimeout(longPressTimer.current)
  return (
    <div className={cn('flex items-center gap-3 px-4 py-3 transition-colors select-none', isSelected ? 'bg-halqa-50 border-l-4 border-halqa-500' : 'hover:bg-gray-50 border-l-4 border-transparent')}
      onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd} onMouseDown={handleTouchStart} onMouseUp={handleTouchEnd}>
      <button onClick={onSelect} className={cn('w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 transition-all text-xs font-bold', isSelected ? 'bg-halqa-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200')}>
        {isSelected ? <Check className="w-3.5 h-3.5" /> : index + 1}
      </button>
      <Avatar className="w-10 h-10 flex-shrink-0">
        <AvatarFallback className={cn('text-sm font-bold', cfg.bg, cfg.text)}>
          {student.user?.firstName?.[0]}{student.user?.lastName?.[0]}
        </AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-900 truncate">{student.user?.firstName} {student.user?.lastName}</p>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          <span className="text-xs text-gray-400">{student.studentId}</span>
          {student.gradeLevel && <Badge variant="outline" className="text-xs py-0 px-1.5">{student.gradeLevel}</Badge>}
          <span className={cn('text-xs font-medium px-1.5 py-0.5 rounded-full', cfg.bg, cfg.text)}>{cfg.label}</span>
        </div>
      </div>
      <StatusButton studentId={student.id} saving={savingStates[student.id]} />
      <Link href={'/students/' + student.id} onClick={e => e.stopPropagation()}>
        <ArrowRight className="w-4 h-4 text-gray-300 hover:text-halqa-500 transition-colors flex-shrink-0" />
      </Link>
    </div>
  )
}

export default function AttendancePage() {
  const { user } = useAuthStore()
  const { isAdmin, isTeacher, isStudent, isGuardian, effectiveRole } = useEducationRole()

  // Route each role to the correct view â€” no conditional hook calls
  if (isStudent)   return <StudentAttendanceView />
  if (user?.role === 'GUARDIAN')  return <GuardianAttendanceView />

  return <TeacherAttendancePage />
}

// â”€â”€â”€ TEACHER / ADMIN MARKING UI â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function TeacherAttendancePage() {
  const { user } = useAuthStore()
  const { isAdmin, isTeacher, isStudent, isGuardian, effectiveRole } = useEducationRole()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const { classId, date, attendance, selectedStudents, setClass, setDate, markAll, clearAll, selectAll, clearSelection, applyToSelected, loadExisting, offlineQueue, toggleSelect } = useAttendanceStore()
  const [multiSelect, setMultiSelect] = useState(false)
  const [isOnline, setIsOnline] = useState(true)
  const [showMoreMenu, setShowMoreMenu] = useState(false)
  const [showSortFilter, setShowSortFilter] = useState(false)
  const [isBulkSaving, setIsBulkSaving] = useState(false)
  const [showClearConfirm, setShowClearConfirm] = useState(false)

  // Persist sort preferences in localStorage
  const [sortBy, setSortByState] = useState<string>(() => {
    if (typeof window !== 'undefined') return localStorage.getItem('attendance-sortBy') || 'first_name'
    return 'first_name'
  })
  const [order, setOrderState] = useState<'asc' | 'desc'>(() => {
    if (typeof window !== 'undefined') return (localStorage.getItem('attendance-order') as 'asc' | 'desc') || 'asc'
    return 'asc'
  })
  const [levelFilter, setLevelFilter] = useState('')

  const setSortBy = (v: string) => { setSortByState(v); if (typeof window !== 'undefined') localStorage.setItem('attendance-sortBy', v) }
  const setOrder = (v: 'asc' | 'desc') => { setOrderState(v); if (typeof window !== 'undefined') localStorage.setItem('attendance-order', v) }
  const [localSearch, setLocalSearch] = useState('')
  const debouncedSearch = useDebounce(localSearch, 300)
  const { debouncedSync } = useAttendanceSync(classId, date)

  useEffect(() => {
    const onOnline = () => setIsOnline(true)
    const onOffline = () => setIsOnline(false)
    setIsOnline(navigator.onLine)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => { window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline) }
  }, [])

  useEffect(() => {
    const socket = getSocket()
    if (!socket) return
    socket.on('attendance:updated', (data: any) => { if (data.classId === classId) queryClient.invalidateQueries({ queryKey: ['attendance', classId, date] }) })
    return () => { socket.off('attendance:updated') }
  }, [classId, date, queryClient])

  const { data: classes } = useQuery({ queryKey: ['classes'], queryFn: () => api.get('/classes').then(r => r.data.data) })

  const { data: studentsData, isLoading: loadingStudents, isError: studentsError, refetch: refetchStudents } = useQuery({
    queryKey: ['students-attendance', classId, sortBy, order, levelFilter, debouncedSearch],
    queryFn: () => api.get('/students', {
      params: {
        classId: classId || undefined,
        sortBy,
        order,
        level: levelFilter || undefined,
        search: debouncedSearch || undefined,
        limit: 200
      }
    }).then(r => r.data.data),
    enabled: !!classId
  })

  const { data: existingAttendance, refetch: refetchAttendance } = useQuery({
    queryKey: ['attendance', classId, date],
    queryFn: () => api.get('/attendance/class/' + classId + '?date=' + date).then(r => r.data.data),
    enabled: !!classId
  })

  useEffect(() => {
    if (existingAttendance && Array.isArray(existingAttendance)) {
      loadExisting(existingAttendance.map((a: any) => ({ studentId: a.studentId, status: a.status })))
    }
  }, [existingAttendance, loadExisting])

  const students = studentsData || []
  const studentIds = students.map((s: any) => s.id)
  const selectedClass = classes?.find((c: any) => c.id === classId)

  const counts = {
    present: Object.values(attendance).filter(s => s === 'PRESENT').length,
    absent: Object.values(attendance).filter(s => s === 'ABSENT').length,
    late: Object.values(attendance).filter(s => s === 'LATE').length,
    excused: Object.values(attendance).filter(s => s === 'EXCUSED').length,
    leftEarly: Object.values(attendance).filter(s => s === 'LEFT_EARLY').length,
  }
  const total = students.length
  const marked = Object.keys(attendance).filter(id => studentIds.includes(id)).length
  const rate = total > 0 ? Math.round((counts.present / total) * 100) : 0

  const goToPrevDay = () => setDate(format(subDays(new Date(date), 1), 'yyyy-MM-dd'))
  const goToNextDay = () => setDate(format(addDays(new Date(date), 1), 'yyyy-MM-dd'))

  const handleRefresh = () => { refetchStudents(); refetchAttendance(); toast({ title: 'Refreshed' }) }
  const handleLongPress = (studentId: string) => { setMultiSelect(true); toggleSelect(studentId) }

  const toggleOrder = () => setOrder(order === 'asc' ? 'desc' : 'asc')
  const canMark = isTeacher

  // Bulk save all â€” sends all current statuses in one request
  const handleSaveAll = async () => {
    if (!classId || students.length === 0) return
    setIsBulkSaving(true)
    try {
      const records = students.map((s: any) => ({
        studentId: s.id,
        status: attendance[s.id] || 'PRESENT'
      }))
      await api.post('/attendance/bulk', { classId, date, records })
      queryClient.invalidateQueries({ queryKey: ['attendance', classId, date] })
      toast({ title: `âœ… Saved ${records.length} attendance records` })
    } catch {
      toast({ title: 'Save failed â€” check connection', variant: 'destructive' })
    } finally {
      setIsBulkSaving(false)
    }
  }

  const uniqueLevels: string[] = Array.from(new Set(
    students
      .filter((s: any) => s.gradeLevel)
      .map((s: any) => s.gradeLevel as string)
  ))

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] bg-gray-50 -m-4 md:-m-6">

      {/* HEADER */}
      <div className="bg-white border-b border-gray-200 px-4 pt-4 pb-3 flex-shrink-0">
        <div className="flex items-center justify-between mb-3">
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold text-gray-900 truncate">{selectedClass ? selectedClass.name : 'Attendance'}</h1>
            <p className="text-xs text-gray-500">Attendance  Check In</p>
          </div>
          <div className="flex items-center gap-2">
            <div className={cn('flex items-center gap-1 text-xs px-2 py-1 rounded-full', isOnline ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600')}>
              {isOnline ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
              <span className="hidden sm:inline">{isOnline ? 'Online' : 'Offline'}</span>
            </div>
            <button onClick={handleRefresh} className="p-2 rounded-lg hover:bg-gray-100 transition-colors"><RefreshCw className="w-4 h-4 text-gray-600" /></button>
            <Link href="/attendance/qr-checkin"><button className="p-2 rounded-lg hover:bg-gray-100 transition-colors"><QrCode className="w-4 h-4 text-gray-600" /></button></Link>
          </div>
        </div>

        <Select value={classId} onValueChange={setClass}>
          <SelectTrigger className="h-9 text-sm mb-3"><SelectValue placeholder="Select a class to mark attendance" /></SelectTrigger>
          <SelectContent>{(classes || []).map((cls: any) => <SelectItem key={cls.id} value={cls.id}>{cls.name}</SelectItem>)}</SelectContent>
        </Select>

        {/* Date switcher */}
        <div className="flex items-center gap-2">
          <button onClick={goToPrevDay} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"><ChevronLeft className="w-4 h-4 text-gray-600" /></button>
          <div className="flex-1 flex items-center justify-center gap-2">
            <input type="date" value={date} onChange={e => setDate(e.target.value)} className="text-sm font-semibold text-gray-900 bg-transparent border-none outline-none cursor-pointer text-center" />
            {!isToday(new Date(date)) && <button onClick={() => setDate(format(new Date(), 'yyyy-MM-dd'))} className="text-xs text-halqa-600 hover:text-halqa-700 font-medium">Today</button>}
          </div>
          <button onClick={goToNextDay} disabled={isToday(new Date(date))} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-30"><ChevronRight className="w-4 h-4 text-gray-600" /></button>
        </div>
      </div>

      {classId && (
        <>
          {/* SUMMARY BAR */}
          <div className="bg-white border-b border-gray-100 px-4 py-2 flex-shrink-0">
            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-500 font-medium">{total} students  {marked} marked</p>
              <div className="flex items-center gap-3 text-xs font-semibold">
                <span className="text-green-600">{counts.present} </span>
                <span className="text-red-500">{counts.absent} </span>
                <span className="text-yellow-500">{counts.late} </span>
                <span className="text-blue-500">{counts.excused} </span>
                <span className="text-halqa-700 font-bold">{rate}%</span>
              </div>
            </div>
            <div className="mt-1.5 h-1.5 bg-gray-100 rounded-full overflow-hidden flex">
              {counts.present > 0 && <div className="bg-green-500 h-full transition-all" style={{ width: (counts.present / total * 100) + '%' }} />}
              {counts.absent > 0 && <div className="bg-red-500 h-full transition-all" style={{ width: (counts.absent / total * 100) + '%' }} />}
              {counts.late > 0 && <div className="bg-yellow-400 h-full transition-all" style={{ width: (counts.late / total * 100) + '%' }} />}
              {counts.excused > 0 && <div className="bg-blue-500 h-full transition-all" style={{ width: (counts.excused / total * 100) + '%' }} />}
            </div>
          </div>

          {/* SORT & FILTER TOOLBAR */}
          <div className="bg-white border-b border-gray-100 px-4 py-2 flex-shrink-0">
            <div className="flex items-center gap-2 flex-wrap">
              {/* Search */}
              <div className="flex-1 min-w-[160px]">
                <SearchInput value={localSearch} onChange={setLocalSearch} placeholder="Search name or ID..." className="h-8 text-xs" />
              </div>

              {/* Sort by */}
              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger className="h-8 w-36 text-xs">
                  <div className="flex items-center gap-1.5">
                    <ArrowUpDown className="w-3 h-3 text-gray-400" />
                    <SelectValue />
                  </div>
                </SelectTrigger>
                <SelectContent>
                  {SORT_OPTIONS.map(opt => <SelectItem key={opt.value} value={opt.value} className="text-xs">{opt.label}</SelectItem>)}
                </SelectContent>
              </Select>

              {/* Order toggle */}
              <button onClick={toggleOrder}
                className={cn('h-8 px-3 rounded-md border text-xs font-medium flex items-center gap-1.5 transition-colors', order === 'asc' ? 'border-halqa-300 bg-halqa-50 text-halqa-700' : 'border-orange-300 bg-orange-50 text-orange-700')}>
                {order === 'asc' ? <><ArrowUp className="w-3 h-3" /> AZ</> : <><ArrowDown className="w-3 h-3" /> ZA</>}
              </button>

              {/* Level filter */}
              {uniqueLevels.length > 0 && (
                <Select value={levelFilter || 'all'} onValueChange={v => setLevelFilter(v === 'all' ? '' : v)}>
                  <SelectTrigger className="h-8 w-32 text-xs">
                    <div className="flex items-center gap-1.5">
                      <SlidersHorizontal className="w-3 h-3 text-gray-400" />
                      <SelectValue placeholder="All levels" />
                    </div>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="text-xs">All Levels</SelectItem>
                    {uniqueLevels.map(l => <SelectItem key={l} value={l} className="text-xs">{l}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}

              {/* Clear filters */}
              {(localSearch || levelFilter || sortBy !== 'first_name' || order !== 'asc') && (
                <button onClick={() => { setLocalSearch(''); setLevelFilter(''); setSortBy('first_name'); setOrder('asc') }}
                  className="h-8 px-2 rounded-md border border-gray-200 text-xs text-gray-500 hover:bg-gray-50 flex items-center gap-1">
                  <X className="w-3 h-3" /> Reset
                </button>
              )}
            </div>

            {/* Active sort indicator */}
            <div className="flex items-center gap-2 mt-1.5">
              <p className="text-xs text-gray-400">
                Sorted by <span className="font-medium text-gray-600">{SORT_OPTIONS.find(o => o.value === sortBy)?.label}</span>
                {' '}({order === 'asc' ? ' Ascending' : ' Descending'})
                {levelFilter && <>  Level: <span className="font-medium text-halqa-600">{levelFilter}</span></>}
                {debouncedSearch && <>  Search: <span className="font-medium text-halqa-600">&quot;{debouncedSearch}&quot;</span></>}
              </p>
              {loadingStudents && <Loader2 className="w-3 h-3 animate-spin text-gray-400" />}
            </div>
          </div>

          {/* SUB HEADER */}
          <div className="bg-halqa-50 border-b border-halqa-100 px-4 py-1.5 flex-shrink-0">
            <p className="text-xs text-halqa-700 font-medium text-center">Tap icon for quick attendance </p>
          </div>

          {/* MULTI-SELECT TOOLBAR */}
          {multiSelect && (
            <div className="bg-halqa-700 text-white px-4 py-2.5 flex items-center gap-3 flex-shrink-0">
              <span className="text-sm font-medium flex-1">{selectedStudents.size} selected</span>
              <div className="flex gap-1">
                {STATUS_CYCLE.map(s => {
                  const cfg = STATUS_CONFIG[s]; const Icon = cfg.icon
                  return <button key={s} onClick={() => applyToSelected(s)} className={cn('w-8 h-8 rounded-full flex items-center justify-center', cfg.bg)} title={cfg.label}><Icon className="w-4 h-4 text-white" /></button>
                })}
              </div>
              <button onClick={() => { setMultiSelect(false); clearSelection() }} className="text-xs underline opacity-80 hover:opacity-100">Cancel</button>
            </div>
          )}

          {/* STUDENT LIST */}
          <div className="flex-1 overflow-y-auto bg-white">
            {loadingStudents ? (
              <div className="p-4 space-y-2">{[...Array(6)].map((_, i) => <div key={i} className="h-16 bg-gray-100 rounded-xl animate-pulse" />)}</div>
            ) : studentsError ? (
              <div className="flex flex-col items-center justify-center h-full py-12 text-gray-400">
                <div className="w-12 h-12 bg-red-50 rounded-xl flex items-center justify-center mb-3">
                  <span className="text-red-500 text-xl">âš </span>
                </div>
                <p className="text-sm font-medium text-gray-500">Failed to load students</p>
                <button onClick={() => refetchStudents()} className="mt-3 text-xs text-halqa-600 hover:text-halqa-700 underline">Try again</button>
              </div>
            ) : students.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full py-16 text-gray-400">
                <CheckCircle2 className="w-12 h-12 text-gray-200 mb-3" />
                <p className="text-sm font-medium text-gray-500">No students found</p>
                {(localSearch || levelFilter) && <p className="text-xs mt-1">Try clearing the filters</p>}
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {students.map((student: any, idx: number) => (
                  <StudentRow key={student.id} student={student} index={idx}
                    isSelected={selectedStudents.has(student.id)}
                    onSelect={() => { if (!multiSelect) setMultiSelect(true); toggleSelect(student.id) }}
                    onLongPress={() => handleLongPress(student.id)}
                    debouncedSync={debouncedSync} classId={classId} date={date} />
                ))}
              </div>
            )}
          </div>

          {/* BOTTOM ACTION BAR */}
          <div className="bg-white border-t border-gray-200 flex-shrink-0 safe-bottom">
            <div className="flex items-center justify-around h-16 px-2">
              {/* Save All button */}
              <button
                onClick={handleSaveAll}
                disabled={isBulkSaving || students.length === 0}
                className="flex flex-col items-center gap-1 px-3 py-2 rounded-xl bg-halqa-700 text-white hover:bg-halqa-800 disabled:opacity-50 transition-colors">
                {isBulkSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Check className="w-5 h-5" />}
                <span className="text-[10px] font-semibold">{isBulkSaving ? 'Saving...' : 'Save All'}</span>
              </button>
              <Link href="/attendance/qr-checkin">
                <button className="flex flex-col items-center gap-1 px-3 py-2 rounded-xl hover:bg-gray-100 text-gray-600 transition-colors">
                  <QrCode className="w-5 h-5" /><span className="text-[10px] font-medium">QR Scan</span>
                </button>
              </Link>
              <button onClick={() => setShowClearConfirm(true)}
                className="flex flex-col items-center gap-1 px-3 py-2 rounded-xl hover:bg-red-50 text-gray-600 hover:text-red-600 transition-colors">
                <Trash2 className="w-5 h-5" /><span className="text-[10px] font-medium">Clear All</span>
              </button>
              <button onClick={() => { setMultiSelect(!multiSelect); if (multiSelect) clearSelection(); else selectAll(studentIds) }}
                className={cn('flex flex-col items-center gap-1 px-3 py-2 rounded-xl transition-colors', multiSelect ? 'bg-halqa-100 text-halqa-700' : 'hover:bg-gray-100 text-gray-600')}>
                <CheckSquare className="w-5 h-5" /><span className="text-[10px] font-medium">Select All</span>
              </button>
              <div className="relative">
                <button onClick={() => setShowMoreMenu(!showMoreMenu)}
                  className="flex flex-col items-center gap-1 px-3 py-2 rounded-xl hover:bg-gray-100 text-gray-600 transition-colors">
                  <MoreHorizontal className="w-5 h-5" /><span className="text-[10px] font-medium">More</span>
                </button>
                {showMoreMenu && (
                  <div className="absolute bottom-full right-0 mb-2 bg-white rounded-xl shadow-xl border border-gray-100 w-52 overflow-hidden z-50">
                    <div className="p-1">
                      {[
                        { label: 'Mark All Present', status: 'PRESENT' as AttendanceStatus, color: 'text-green-600' },
                        { label: 'Mark All Absent', status: 'ABSENT' as AttendanceStatus, color: 'text-red-600' },
                        { label: 'Mark All Late', status: 'LATE' as AttendanceStatus, color: 'text-yellow-600' },
                        { label: 'Mark All Excused', status: 'EXCUSED' as AttendanceStatus, color: 'text-blue-600' },
                      ].map(item => (
                        <button key={item.status} onClick={() => { markAll(item.status, studentIds); setShowMoreMenu(false); toast({ title: 'All students marked as ' + item.label.split(' ').pop() }) }}
                          className={cn('w-full text-left px-3 py-2.5 text-sm rounded-lg hover:bg-gray-50 font-medium', item.color)}>
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {!classId && (
        <div className="flex-1 flex flex-col items-center justify-center text-gray-400 p-8">
          <CheckCircle2 className="w-16 h-16 text-gray-200 mb-4" />
          <p className="text-base font-semibold text-gray-500">Select a class above</p>
          <p className="text-sm mt-1">to start marking attendance</p>
        </div>
      )}

      {offlineQueue.length > 0 && (
        <div className="fixed top-20 right-4 bg-orange-500 text-white text-xs px-3 py-1.5 rounded-full shadow-lg z-50 flex items-center gap-1.5">
          <WifiOff className="w-3 h-3" />{offlineQueue.length} pending sync
        </div>
      )}

      <ConfirmDialog
        open={showClearConfirm}
        title="Clear Attendance"
        message="Clear all attendance for this session? This will reset all statuses."
        confirmLabel="Clear All"
        variant="warning"
        onConfirm={() => { clearAll(studentIds); toast({ title: 'Attendance cleared' }); setShowClearConfirm(false) }}
        onCancel={() => setShowClearConfirm(false)}
      />
    </div>
  )
}
