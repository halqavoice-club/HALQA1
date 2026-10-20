'use client'

/**
 * useSchoolAccess.ts
 *
 * Frontend authorization hook for the Education domain.
 *
 * CORE RULES:
 *   - Social features are available to ALL authenticated users regardless of school membership.
 *   - Education features require an ACTIVE school membership.
 *   - Education roles are school-scoped: a user's role in School A is independent of School B.
 *   - This hook is NOT a substitute for backend authorization — it only controls UI visibility.
 *     The backend always re-validates school membership and role server-side.
 *
 * Usage:
 *   const { hasSchools, activeSchool, activeRole, canEducation, switchSchool } = useSchoolAccess()
 *
 *   // Check if user can access Education domain at all
 *   if (!hasSchools) → show "Join a School" or "Create a School"
 *
 *   // Check a specific Education permission
 *   if (canEducation('VIEW_GRADES')) → show grades link
 *
 *   // Check role directly
 *   if (activeRole === 'TEACHER') → show teacher-only UI
 */

import { useMemo, useCallback, useEffect } from 'react'
import { useAuthStore, type SchoolMembership } from '@/store/auth.store'
import { useSchoolStore } from '@/store/school.store'

// ─── Education role hierarchy ─────────────────────────────────────────────────
export type EducationRole =
  | 'SUPER_ADMIN'
  | 'SCHOOL_ADMIN'
  | 'TEACHER'
  | 'STUDENT'
  | 'GUARDIAN'

// ─── Education permissions per role ──────────────────────────────────────────
// Maps school roles to the Education permissions they grant.
// These mirror the backend permission checks — if you add a permission here,
// add the corresponding check in the backend controller too.
const EDUCATION_PERMISSIONS: Record<EducationRole, string[]> = {
  SUPER_ADMIN: ['*'], // all permissions

  SCHOOL_ADMIN: [
    'VIEW_SCHOOL', 'MANAGE_SCHOOL',
    'VIEW_STUDENTS', 'MANAGE_STUDENTS',
    'VIEW_TEACHERS', 'MANAGE_TEACHERS',
    'VIEW_GUARDIANS', 'MANAGE_GUARDIANS',
    'VIEW_CLASSES', 'MANAGE_CLASSES',
    'VIEW_ATTENDANCE', 'MANAGE_ATTENDANCE',
    'VIEW_GRADES', 'MANAGE_GRADES',
    'VIEW_BEHAVIOR', 'MANAGE_BEHAVIOR',
    'VIEW_FEES', 'MANAGE_FEES',
    'VIEW_TERMS', 'MANAGE_TERMS',
    'VIEW_REPORTS', 'MANAGE_REPORTS',
    'VIEW_LIBRARY', 'MANAGE_LIBRARY',
    'VIEW_ANNOUNCEMENTS', 'MANAGE_ANNOUNCEMENTS',
    'VIEW_CALENDAR', 'MANAGE_CALENDAR',
    'VIEW_SCHEDULE', 'MANAGE_SCHEDULE',
    'VIEW_ANALYTICS',
    'VIEW_ASSIGNMENTS', 'MANAGE_ASSIGNMENTS',
    'VIEW_EXAMS', 'MANAGE_EXAMS',
    'VIEW_LEADERBOARD',
    'MANAGE_IMPORT',
    'VIEW_AUDIT',
    'MANAGE_SETTINGS',
    'VIEW_LIVE_CLASSES', 'MANAGE_LIVE_CLASSES',
    'VIEW_AUDIO_LESSONS', 'MANAGE_AUDIO_LESSONS',
  ],

  TEACHER: [
    'VIEW_SCHOOL',
    'VIEW_STUDENTS',
    'VIEW_CLASSES', 'MANAGE_CLASSES',
    'VIEW_ATTENDANCE', 'MANAGE_ATTENDANCE',
    'VIEW_GRADES', 'MANAGE_GRADES',
    'VIEW_BEHAVIOR', 'MANAGE_BEHAVIOR',
    'VIEW_REPORTS',
    'VIEW_LIBRARY',
    'VIEW_ANNOUNCEMENTS', 'MANAGE_ANNOUNCEMENTS',
    'VIEW_CALENDAR',
    'VIEW_SCHEDULE', 'MANAGE_SCHEDULE',
    'VIEW_ASSIGNMENTS', 'MANAGE_ASSIGNMENTS',
    'VIEW_EXAMS', 'MANAGE_EXAMS',
    'VIEW_LEADERBOARD',
    'VIEW_LIVE_CLASSES', 'MANAGE_LIVE_CLASSES',
    'VIEW_AUDIO_LESSONS', 'MANAGE_AUDIO_LESSONS',
    'MANAGE_SETTINGS',
  ],

  STUDENT: [
    'VIEW_SCHOOL',
    'VIEW_ATTENDANCE',
    'VIEW_GRADES',
    'VIEW_BEHAVIOR',
    'VIEW_LIBRARY',
    'VIEW_ANNOUNCEMENTS',
    'VIEW_CALENDAR',
    'VIEW_ASSIGNMENTS',
    'VIEW_EXAMS',
    'VIEW_LEADERBOARD',
    'VIEW_LIVE_CLASSES',
    'VIEW_AUDIO_LESSONS',
  ],

  GUARDIAN: [
    'VIEW_SCHOOL',
    'VIEW_ATTENDANCE',
    'VIEW_GRADES',
    'VIEW_ANNOUNCEMENTS',
    'VIEW_CALENDAR',
    'VIEW_LEADERBOARD',
    'VIEW_LIVE_CLASSES',
  ],
}

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function useSchoolAccess() {
  const { user } = useAuthStore()
  const { activeSchoolId, setActiveSchoolId } = useSchoolStore()

  // FIX (HALQA-UI-03): SUPER_ADMIN is a platform-management role.
  // They must NOT automatically operate inside a school context purely from
  // their global role. The school context is determined by their actual
  // SchoolMembership records (if they have been explicitly invited into a school).
  // ARCH-01: isSuperAdminPlatform is kept only for the stale-context cleanup effect.
  const isSuperAdminPlatform = user?.role === 'SUPER_ADMIN'

  // Clear stale school context if SUPER_ADMIN has no school memberships
  const clearActiveSchool = useSchoolStore(s => s.clearActiveSchool)
  useEffect(() => {
    const activeMemberships = user?.schoolMemberships?.filter(m => m.status === 'ACTIVE') ?? []
    if (isSuperAdminPlatform && activeSchoolId && activeMemberships.length === 0) {
      clearActiveSchool()
    }
  }, [isSuperAdminPlatform, activeSchoolId, clearActiveSchool, user?.schoolMemberships])

  // All active school memberships from the user profile
  const memberships: SchoolMembership[] = useMemo(
    () => {
      // ARCH-01: SUPER_ADMIN is a platform administrator.
      // They operate within a school ONLY via an explicit SCHOOL_ADMIN membership.
      // We DO show their school memberships (so they can manage schools they've been
      // explicitly invited into), but activeRole will reflect the membership role
      // (e.g. SCHOOL_ADMIN), not their global SUPER_ADMIN platform role.
      // This ensures SUPER_ADMIN never sees school tools purely by platform role.
      return user?.schoolMemberships?.filter(m => m.status === 'ACTIVE') ?? []
    },
    [user?.schoolMemberships]
  )

  // Whether the user belongs to any school
  const hasSchools = memberships.length > 0

  // The currently active membership (determined by activeSchoolId or first school)
  const activeMembership: SchoolMembership | null = useMemo(() => {
    if (!hasSchools) return null
    if (activeSchoolId) {
      return memberships.find(m => m.schoolId === activeSchoolId) ?? memberships[0]
    }
    return memberships[0]
  }, [memberships, activeSchoolId, hasSchools])

  const activeSchool = activeMembership?.school ?? null
  const activeRole = activeMembership?.role as EducationRole | null ?? null

  // Switch to a different school context
  const switchSchool = useCallback((schoolId: string) => {
    const exists = memberships.find(m => m.schoolId === schoolId)
    if (exists) setActiveSchoolId(schoolId)
  }, [memberships, setActiveSchoolId])

  /**
   * Check if the user can perform an Education action in the active school.
   * Uses the active school membership role.
   *
   * @param permission - The permission to check (e.g. 'VIEW_GRADES')
   * @param schoolId   - Optional: check against a specific school (defaults to active)
   */
  const canEducation = useCallback((permission: string, schoolId?: string): boolean => {
    const targetId = schoolId ?? activeSchoolId ?? memberships[0]?.schoolId
    if (!targetId) return false

    const membership = memberships.find(m => m.schoolId === targetId)
    if (!membership || membership.status !== 'ACTIVE') return false

    const role = membership.role as EducationRole
    const permissions = EDUCATION_PERMISSIONS[role]
    if (!permissions) return false

    return permissions.includes('*') || permissions.includes(permission)
  }, [memberships, activeSchoolId])

  /**
   * Check if the user has a specific school role in the active (or specified) school.
   */
  const hasSchoolRole = useCallback((role: EducationRole | EducationRole[], schoolId?: string): boolean => {
    const targetId = schoolId ?? activeSchoolId ?? memberships[0]?.schoolId
    if (!targetId) return false

    const membership = memberships.find(m => m.schoolId === targetId)
    if (!membership || membership.status !== 'ACTIVE') return false

    const roles = Array.isArray(role) ? role : [role]
    return roles.includes(membership.role as EducationRole)
  }, [memberships, activeSchoolId])

  /**
   * Check if the user can access a given school (has an active membership).
   */
  const canAccessSchool = useCallback((schoolId: string): boolean => {
    return memberships.some(m => m.schoolId === schoolId && m.status === 'ACTIVE')
  }, [memberships])

  return {
    // State
    memberships,
    hasSchools,
    activeMembership,
    activeSchool,
    activeSchoolId: activeMembership?.schoolId ?? null,
    activeRole,

    // Actions
    switchSchool,

    // Authorization helpers
    canEducation,
    hasSchoolRole,
    canAccessSchool,
  }
}
