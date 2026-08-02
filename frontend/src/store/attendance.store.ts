'use client'

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

export type AttendanceStatus = 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED' | 'LEFT_EARLY'

export interface AttendanceRecord {
  studentId: string
  classId: string
  date: string
  status: AttendanceStatus
  synced: boolean
  updatedAt: number
}

export interface SavingState {
  studentId: string
  status: 'saving' | 'saved' | 'error'
}

interface AttendanceState {
  // Current session
  classId: string
  date: string
  attendance: Record<string, AttendanceStatus>  // studentId → status
  selectedStudents: Set<string>
  savingStates: Record<string, SavingState['status']>

  // Offline queue
  offlineQueue: AttendanceRecord[]

  // Actions
  setClass: (classId: string) => void
  setDate: (date: string) => void
  setStatus: (studentId: string, status: AttendanceStatus) => void
  cycleStatus: (studentId: string) => void
  markAll: (status: AttendanceStatus, studentIds: string[]) => void
  clearAll: (studentIds: string[]) => void
  toggleSelect: (studentId: string) => void
  selectAll: (studentIds: string[]) => void
  clearSelection: () => void
  applyToSelected: (status: AttendanceStatus) => void
  setSavingState: (studentId: string, state: SavingState['status']) => void
  loadExisting: (records: Array<{ studentId: string; status: string }>) => void
  addToOfflineQueue: (record: AttendanceRecord) => void
  removeFromOfflineQueue: (studentId: string, classId: string, date: string) => void
  clearOfflineQueue: () => void
}

const STATUS_CYCLE: AttendanceStatus[] = ['PRESENT', 'ABSENT', 'LATE', 'EXCUSED', 'LEFT_EARLY']

export const useAttendanceStore = create<AttendanceState>()(
  persist(
    (set, get) => ({
      classId: '',
      date: new Date().toISOString().split('T')[0],
      attendance: {},
      selectedStudents: new Set<string>(),
      savingStates: {},
      offlineQueue: [],

      setClass: (classId) => set({ classId, attendance: {}, selectedStudents: new Set() }),

      setDate: (date) => set({ date, attendance: {}, selectedStudents: new Set() }),

      setStatus: (studentId, status) =>
        set(state => ({
          attendance: { ...state.attendance, [studentId]: status }
        })),

      cycleStatus: (studentId) =>
        set(state => {
          const current = state.attendance[studentId] || 'PRESENT'
          const idx = STATUS_CYCLE.indexOf(current)
          const next = STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length]
          return { attendance: { ...state.attendance, [studentId]: next } }
        }),

      markAll: (status, studentIds) =>
        set(state => {
          const updated = { ...state.attendance }
          studentIds.forEach(id => { updated[id] = status })
          return { attendance: updated }
        }),

      clearAll: (studentIds) =>
        set(state => {
          const updated = { ...state.attendance }
          studentIds.forEach(id => { delete updated[id] })
          return { attendance: updated }
        }),

      toggleSelect: (studentId) =>
        set(state => {
          const next = new Set(Array.from(state.selectedStudents))
          if (next.has(studentId)) next.delete(studentId)
          else next.add(studentId)
          return { selectedStudents: next }
        }),

      selectAll: (studentIds) =>
        set({ selectedStudents: new Set(studentIds) }),

      clearSelection: () =>
        set({ selectedStudents: new Set() }),

      applyToSelected: (status) =>
        set(state => {
          const updated = { ...state.attendance }
          Array.from(state.selectedStudents).forEach(id => { updated[id] = status })
          return { attendance: updated, selectedStudents: new Set() }
        }),

      setSavingState: (studentId, savingStatus) =>
        set(state => ({
          savingStates: { ...state.savingStates, [studentId]: savingStatus }
        })),

      loadExisting: (records) =>
        set(state => {
          const updated = { ...state.attendance }
          records.forEach(r => { updated[r.studentId] = r.status as AttendanceStatus })
          return { attendance: updated }
        }),

      addToOfflineQueue: (record) =>
        set(state => {
          const filtered = state.offlineQueue.filter(
            r => !(r.studentId === record.studentId && r.classId === record.classId && r.date === record.date)
          )
          return { offlineQueue: [...filtered, record] }
        }),

      removeFromOfflineQueue: (studentId, classId, date) =>
        set(state => ({
          offlineQueue: state.offlineQueue.filter(
            r => !(r.studentId === studentId && r.classId === classId && r.date === date)
          )
        })),

      clearOfflineQueue: () => set({ offlineQueue: [] })
    }),
    {
      name: 'halqa-attendance',
      storage: createJSONStorage(() => {
        if (typeof window === 'undefined') return { getItem: () => null, setItem: () => {}, removeItem: () => {} }
        return localStorage
      }),
      partialize: (state) => ({
        offlineQueue: state.offlineQueue
      }),
      skipHydration: true
    }
  )
)
