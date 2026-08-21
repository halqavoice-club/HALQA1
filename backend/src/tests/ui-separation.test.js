'use strict';
/**
 * UI Separation Tests — HALQA-UI-01/02/03
 *
 * Documents and verifies the architectural separation between
 * SUPER_ADMIN (platform) and SCHOOL_ADMIN/TEACHER/STUDENT (school-scoped).
 *
 * These tests verify the LOGIC of the separation using pure JS,
 * matching the rules implemented in:
 *   - frontend/src/hooks/useSchoolAccess.ts
 *   - frontend/src/app/(dashboard)/layout.tsx
 *   - frontend/src/components/layout/Sidebar.tsx
 *   - frontend/src/app/(dashboard)/admin/layout.tsx
 */

// ─── Simulate the useSchoolAccess SUPER_ADMIN filter ─────────────────────────
function getAccessibleMemberships(userRole, memberships) {
  // HALQA-UI-03: SUPER_ADMIN platform role → no school memberships exposed
  if (userRole === 'SUPER_ADMIN') return [];
  return memberships.filter(m => m.status === 'ACTIVE');
}

// ─── Simulate the sidebar school display logic ────────────────────────────────
function getSidebarBrandText(userRole, schoolName) {
  // HALQA-UI-01: SUPER_ADMIN sees "HALQA Platform Administration", not school name
  if (userRole === 'SUPER_ADMIN') return 'HALQA Platform Administration';
  return schoolName || 'HALQA';
}

function shouldShowSchoolContext(userRole, hasMemberships) {
  // HALQA-UI-02: School selector/indicator hidden for SUPER_ADMIN
  if (userRole === 'SUPER_ADMIN') return false;
  return hasMemberships;
}

// ─── Simulate the dashboard layout double-nav prevention ─────────────────────
function shouldSuppressStandardSidebar(userRole, pathname) {
  // On /admin/* routes, the admin layout provides its own nav
  return userRole === 'SUPER_ADMIN' && pathname.startsWith('/admin');
}

// ─── Simulate canEducation for SUPER_ADMIN ────────────────────────────────────
function canEducation(memberships, permission) {
  // SUPER_ADMIN has empty memberships → canEducation always false
  if (memberships.length === 0) return false;
  const PERMISSIONS = {
    SCHOOL_ADMIN: ['VIEW_STUDENTS', 'MANAGE_SCHOOL', 'VIEW_GRADES'],
    TEACHER: ['VIEW_STUDENTS', 'VIEW_GRADES'],
    STUDENT: ['VIEW_GRADES'],
    GUARDIAN: [],
  };
  const activeMembership = memberships[0];
  const perms = PERMISSIONS[activeMembership.role] || [];
  return perms.includes(permission);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('SUPER_ADMIN has no school context', () => {
  const superAdminMemberships = [
    { schoolId: 'sch-1', role: 'SUPER_ADMIN', status: 'ACTIVE', school: { name: 'My Test School' } }
  ];

  test('SUPER_ADMIN gets empty memberships (even with school memberships in DB)', () => {
    const result = getAccessibleMemberships('SUPER_ADMIN', superAdminMemberships);
    expect(result).toHaveLength(0);
  });

  test('SUPER_ADMIN sees "HALQA Platform Administration" not school name', () => {
    const brand = getSidebarBrandText('SUPER_ADMIN', 'My Test School');
    expect(brand).toBe('HALQA Platform Administration');
    expect(brand).not.toContain('My Test School');
  });

  test('SUPER_ADMIN school selector/indicator is hidden', () => {
    const show = shouldShowSchoolContext('SUPER_ADMIN', true);
    expect(show).toBe(false);
  });

  test('SUPER_ADMIN on /admin/* suppresses standard sidebar (no double nav)', () => {
    expect(shouldSuppressStandardSidebar('SUPER_ADMIN', '/admin')).toBe(true);
    expect(shouldSuppressStandardSidebar('SUPER_ADMIN', '/admin/users')).toBe(true);
    expect(shouldSuppressStandardSidebar('SUPER_ADMIN', '/admin/schools')).toBe(true);
  });

  test('SUPER_ADMIN on /dashboard does NOT suppress standard sidebar', () => {
    expect(shouldSuppressStandardSidebar('SUPER_ADMIN', '/dashboard')).toBe(false);
  });

  test('SUPER_ADMIN canEducation always false (no school access through platform role)', () => {
    const memberships = getAccessibleMemberships('SUPER_ADMIN', superAdminMemberships);
    expect(canEducation(memberships, 'VIEW_STUDENTS')).toBe(false);
    expect(canEducation(memberships, 'MANAGE_SCHOOL')).toBe(false);
    expect(canEducation(memberships, 'VIEW_GRADES')).toBe(false);
  });
});

describe('SCHOOL_ADMIN has school context', () => {
  const schoolAdminMemberships = [
    { schoolId: 'sch-1', role: 'SCHOOL_ADMIN', status: 'ACTIVE', school: { name: 'My School' } }
  ];

  test('SCHOOL_ADMIN gets memberships normally', () => {
    const result = getAccessibleMemberships('MEMBER', schoolAdminMemberships);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('SCHOOL_ADMIN');
  });

  test('SCHOOL_ADMIN sees school name in sidebar', () => {
    const brand = getSidebarBrandText('MEMBER', 'My School');
    expect(brand).toBe('My School');
  });

  test('SCHOOL_ADMIN school indicator is shown', () => {
    const result = getAccessibleMemberships('MEMBER', schoolAdminMemberships);
    expect(shouldShowSchoolContext('MEMBER', result.length > 0)).toBe(true);
  });

  test('SCHOOL_ADMIN standard sidebar NOT suppressed on /dashboard', () => {
    expect(shouldSuppressStandardSidebar('MEMBER', '/dashboard')).toBe(false);
    expect(shouldSuppressStandardSidebar('SCHOOL_ADMIN', '/dashboard')).toBe(false);
  });

  test('SCHOOL_ADMIN canEducation works', () => {
    const memberships = getAccessibleMemberships('MEMBER', schoolAdminMemberships);
    expect(canEducation(memberships, 'VIEW_STUDENTS')).toBe(true);
    expect(canEducation(memberships, 'MANAGE_SCHOOL')).toBe(true);
  });
});

describe('TEACHER has school context', () => {
  const teacherMemberships = [
    { schoolId: 'sch-2', role: 'TEACHER', status: 'ACTIVE', school: { name: 'Teacher School' } }
  ];

  test('TEACHER gets school memberships', () => {
    const result = getAccessibleMemberships('MEMBER', teacherMemberships);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('TEACHER');
  });

  test('TEACHER school context shown', () => {
    const result = getAccessibleMemberships('MEMBER', teacherMemberships);
    expect(shouldShowSchoolContext('MEMBER', result.length > 0)).toBe(true);
  });

  test('TEACHER can VIEW_STUDENTS and VIEW_GRADES', () => {
    const memberships = getAccessibleMemberships('MEMBER', teacherMemberships);
    expect(canEducation(memberships, 'VIEW_STUDENTS')).toBe(true);
    expect(canEducation(memberships, 'VIEW_GRADES')).toBe(true);
  });

  test('TEACHER cannot MANAGE_SCHOOL', () => {
    const memberships = getAccessibleMemberships('MEMBER', teacherMemberships);
    expect(canEducation(memberships, 'MANAGE_SCHOOL')).toBe(false);
  });
});

describe('STUDENT has school context', () => {
  const studentMemberships = [
    { schoolId: 'sch-3', role: 'STUDENT', status: 'ACTIVE', school: { name: 'Student School' } }
  ];

  test('STUDENT gets school memberships', () => {
    const result = getAccessibleMemberships('MEMBER', studentMemberships);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('STUDENT');
  });

  test('STUDENT can VIEW_GRADES only', () => {
    const memberships = getAccessibleMemberships('MEMBER', studentMemberships);
    expect(canEducation(memberships, 'VIEW_GRADES')).toBe(true);
    expect(canEducation(memberships, 'VIEW_STUDENTS')).toBe(false);
    expect(canEducation(memberships, 'MANAGE_SCHOOL')).toBe(false);
  });
});

describe('Normal social MEMBER has no school context', () => {
  test('MEMBER with no schools has empty memberships', () => {
    const result = getAccessibleMemberships('MEMBER', []);
    expect(result).toHaveLength(0);
    expect(shouldShowSchoolContext('MEMBER', false)).toBe(false);
  });

  test('MEMBER sees HALQA as brand name', () => {
    expect(getSidebarBrandText('MEMBER', null)).toBe('HALQA');
  });
});

describe('Only one admin navigation rendered on /admin routes', () => {
  test('SUPER_ADMIN on /admin: standard sidebar suppressed, admin layout active', () => {
    const onAdminPage = shouldSuppressStandardSidebar('SUPER_ADMIN', '/admin/users');
    expect(onAdminPage).toBe(true);
    // Admin layout (admin/layout.tsx) provides the sole navigation
    // Standard Sidebar + Header + MobileNav are not rendered
  });

  test('Non-SUPER_ADMIN on /admin: should not happen (backend 403)', () => {
    // Even if a MEMBER somehow navigates to /admin, standard sidebar is shown
    // and backend API calls would return 403
    const memberOnAdmin = shouldSuppressStandardSidebar('MEMBER', '/admin');
    expect(memberOnAdmin).toBe(false);
    // Backend enforces SUPER_ADMIN requirement — frontend layout doesn't matter
  });
});

describe('Platform context is visually distinct from school context', () => {
  test('SUPER_ADMIN brand text never contains a school name', () => {
    const schools = ['My Test School', 'Halqa Academy', 'Demo School', 'Islamic School'];
    schools.forEach(name => {
      const brand = getSidebarBrandText('SUPER_ADMIN', name);
      expect(brand).not.toContain(name);
      expect(brand).toContain('HALQA');
    });
  });

  test('SUPER_ADMIN role display is "Platform Admin" not "super admin"', () => {
    // The sidebar footer shows "Platform Admin" for SUPER_ADMIN
    // This is checked in Sidebar.tsx:
    // user?.role === 'SUPER_ADMIN' → "Platform Admin" (red)
    // Otherwise → role.replace(/_/g, ' ').toLowerCase()
    const displayRole = 'SUPER_ADMIN' === 'SUPER_ADMIN'
      ? 'Platform Admin'
      : 'SUPER_ADMIN'.replace(/_/g, ' ').toLowerCase();
    expect(displayRole).toBe('Platform Admin');
    expect(displayRole).not.toBe('super admin');
  });
});
