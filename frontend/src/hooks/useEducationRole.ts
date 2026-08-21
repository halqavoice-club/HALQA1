'use client'

/**
 * useEducationRole.ts
 *
 * Resolves the current user's effective Education role by checking BOTH:
 *   1. User.role (legacy global role — set for pre-migration users)
 *   2. SchoolMembership.role (new architecture — set for all MEMBER users in a school)
 *
 * This is necessary because:
 *   - Old accounts: User.role = SCHOOL_ADMIN / TEACHER / STUDENT
 *   - New accounts: User.role = MEMBER, education role in SchoolMembership
 *
 * Every component that gates UI on education role MUST use this hook
 * instead of reading user.role directly.
 *
 * Usage:
 *   const { isAdmin, isTeacher, isStudent, isGuardian, effectiveRole } = useEducationRole()
 *   if (isAdmin) → show admin-only buttons
 */

import { useAuthStore } from '@/store/auth.store'
import { useSchoolAccess } from '@/hooks/useSchoolAccess'

export function useEducationRole() {
  const { user } = useAuthStore()
  const { activeRole } = useSchoolAccess()

  const userRole = user?.role || ''

  // Platform-level role — always authoritative
  const isSuperAdminPlatform = userRole === 'SUPER_ADMIN'

  // Effective school role: prefer SchoolMembership (new arch) over User.role (legacy)
  // For MEMBER users: activeRole is their school role
  // For legacy users: userRole contains their school role directly
  const schoolRole = activeRole || userRole

  // ARCHITECTURE FIX (HALQA-ARCH-04):
  // SUPER_ADMIN is a PLATFORM-MANAGEMENT role. They are NOT automatically a school admin.
  // Treating isSuperAdminPlatform as school isAdmin causes the UI to show admin controls
  // (manage students, edit classes, etc.) to platform admins who have no school membership,
  // while the backend would correctly reject those operations with 403.
  //
  // Correct rule: school-level admin access requires an actual SCHOOL_ADMIN or SUPER_ADMIN
  // SchoolMembership, not just the platform role.
  //
  // If a platform admin also manages a school, they should have a SchoolMembership with
  // role SCHOOL_ADMIN in that specific school. That membership will grant isAdmin correctly.
  const isAdmin    = schoolRole === 'SUPER_ADMIN' ||
                     schoolRole === 'SCHOOL_ADMIN'

  const isTeacher  = isAdmin ||
                     schoolRole === 'TEACHER'

  const isStudent  = schoolRole === 'STUDENT'

  const isGuardian = schoolRole === 'GUARDIAN'

  // The effective role string (for conditional rendering)
  const effectiveRole = isSuperAdminPlatform ? 'SUPER_ADMIN' : (schoolRole || 'MEMBER')

  return {
    effectiveRole,
    isSuperAdminPlatform,  // HALQA platform admin — has global access
    isAdmin,               // SCHOOL_ADMIN or SUPER_ADMIN
    isTeacher,             // TEACHER, SCHOOL_ADMIN, or SUPER_ADMIN
    isStudent,             // STUDENT only
    isGuardian,            // GUARDIAN only
    isEducationUser: isAdmin || isTeacher || isStudent || isGuardian,
  }
}
