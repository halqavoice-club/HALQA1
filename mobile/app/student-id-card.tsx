/**
 * HALQA Mobile — Student Identification Card
 *
 * Mobile equivalent of the website's StudentIdCard component.
 * Matches the website design as closely as React Native allows.
 *
 * ── ID CARD SCHOOL OWNERSHIP INVARIANT ──────────────────────────────────────
 * The school name and school logo ALWAYS come from student.school —
 * the school record returned by the backend for THIS student's own enrollment.
 *
 * They NEVER come from:
 *   - The currently logged-in admin's / teacher's / guardian's school
 *   - The active school from Zustand school store
 *   - Any hardcoded string
 *
 * The backend (GET /students/:id) is the authoritative source and
 * always includes { school: { id, name, logoUrl, ... } }.
 *
 * Two entry points:
 *   1. Admins/Teachers: from the student detail via params.studentId
 *   2. Students: viewing their own card via /auth/me
 * ────────────────────────────────────────────────────────────────────────────
 */

import React, { useState } from 'react';
import {
  View, Text, StyleSheet, Image, ScrollView,
  TouchableOpacity, ActivityIndicator, Share, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import api from '@/lib/api';
import { getAvatarUrl } from '@/lib/avatar';
import { useAuthStore } from '@/store/auth.store';
import { useSchoolStore } from '@/store/school.store';

// ── Types ─────────────────────────────────────────────────────────────────────

interface StudentSchool {
  id: string;
  name: string;
  logoUrl?: string | null;
  address?: string | null;
  phone?: string | null;
}

interface StudentData {
  id: string;
  studentId: string;
  qrCode: string | null;
  gradeLevel?: string | null;
  // ID-CARD: school comes from student's own enrollment — NOT from any role context
  school?: StudentSchool | null;
  user: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    avatarUrl?: string | null;
    dateOfBirth?: string | null;
    gender?: string | null;
    phone?: string | null;
  };
  enrollments?: { class: { id: string; name: string } }[];
}

// ── QR image URL ──────────────────────────────────────────────────────────────
function qrImageUrl(value: string, size = 160): string {
  if (!value) return '';
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(value)}&bgcolor=ffffff&color=1e3a8a`;
}

// ── Card component (matches website design) ───────────────────────────────────
function IdCard({ student }: { student: StudentData }) {
  const [logoError, setLogoError] = useState(false);

  // ID-CARD: school branding comes ONLY from student.school
  const school = student.school;
  const schoolName  = school?.name ?? '(School not available)';
  const schoolLogo  = (!logoError && school?.logoUrl) ? getAvatarUrl(school.logoUrl) : null;

  // Student info
  const fullName   = `${student.user.firstName} ${student.user.lastName}`;
  const initials   = `${student.user.firstName[0] ?? ''}${student.user.lastName[0] ?? ''}`.toUpperCase();
  const avatarSrc  = student.user.avatarUrl ? getAvatarUrl(student.user.avatarUrl) : null;
  const classes    = student.enrollments?.map(e => e.class.name).join(', ') || '—';
  const qrValue    = student.qrCode || student.studentId;
  const qrSrc      = qrImageUrl(qrValue, 120);
  const issuedDate = format(new Date(), 'MMM yyyy');
  const dob        = student.user.dateOfBirth
    ? format(new Date(student.user.dateOfBirth), 'MMM d, yyyy')
    : null;

  return (
    <View style={card.wrapper}>
      {/* ── Header band ─────────────────────────────────────────────────────
          Matches website: dark halqa-800 background, school name left,
          school logo right. NEVER hardcoded — always from student.school.
      ──────────────────────────────────────────────────────────────────── */}
      <View style={card.header}>
        <View style={card.headerText}>
          <Text style={card.schoolName} numberOfLines={2}>{schoolName}</Text>
          <Text style={card.headerSub}>Student Identification Card</Text>
        </View>
        <View style={card.logoBox}>
          {schoolLogo ? (
            <Image
              source={{ uri: schoolLogo }}
              style={card.logoImg}
              resizeMode="contain"
              onError={() => setLogoError(true)}
            />
          ) : (
            // Neutral fallback — generic school icon, never another school's logo
            <Ionicons name="school-outline" size={20} color="rgba(255,255,255,0.8)" />
          )}
        </View>
      </View>

      {/* ── Card body ────────────────────────────────────────────────────────
          Matches website layout: avatar left, info center, QR right
      ──────────────────────────────────────────────────────────────────── */}
      <View style={card.body}>
        {/* Student avatar */}
        <View style={card.avatarCol}>
          {avatarSrc ? (
            <Image source={{ uri: avatarSrc }} style={card.avatar} resizeMode="cover" />
          ) : (
            <View style={card.avatarFallback}>
              <Text style={card.avatarInitials}>{initials}</Text>
            </View>
          )}
        </View>

        {/* Student info */}
        <View style={card.infoCol}>
          <Text style={card.studentName} numberOfLines={2}>{fullName}</Text>
          <Text style={card.studentIdText}>{student.studentId}</Text>
          <View style={card.fieldList}>
            <Text style={card.fieldRow} numberOfLines={2}>📚 {classes}</Text>
            {student.gradeLevel ? (
              <Text style={card.fieldRow}>🎓 {student.gradeLevel}</Text>
            ) : null}
            {dob ? (
              <Text style={card.fieldRow}>📅 {dob}</Text>
            ) : null}
          </View>
        </View>

        {/* QR code */}
        <View style={card.qrCol}>
          {qrValue ? (
            <>
              <Image source={{ uri: qrSrc }} style={card.qrImg} />
              <Text style={card.qrCode} numberOfLines={1}>{qrValue}</Text>
            </>
          ) : (
            <View style={card.qrPlaceholder}>
              <Ionicons name="qr-code-outline" size={28} color="#9ca3af" />
              <Text style={card.qrNone}>No QR</Text>
            </View>
          )}
        </View>
      </View>

      {/* ── Footer band ──────────────────────────────────────────────────────
          Matches website: light halqa-50, issued date left, scan hint right
      ──────────────────────────────────────────────────────────────────── */}
      <View style={card.footer}>
        <Text style={card.footerLeft}>Issued: {issuedDate}</Text>
        <Text style={card.footerRight}>Scan QR for attendance</Text>
      </View>
    </View>
  );
}

// ── Card StyleSheet ───────────────────────────────────────────────────────────
const CARD_BORDER = '#3730a3'; // halqa-700 equivalent
const HEADER_BG   = '#1e1b4b'; // halqa-800 equivalent
const HEADER_SUB  = '#a5b4fc'; // halqa-300 equivalent
const HALQA_700   = '#4338ca'; // main accent
const FOOTER_BG   = '#eef2ff'; // halqa-50

const card = StyleSheet.create({
  wrapper:        {
    borderWidth: 2, borderColor: CARD_BORDER, borderRadius: 14, overflow: 'hidden',
    // 85.6mm × 54mm credit-card aspect ratio: 1.586
    // On mobile we let the card be full-width and fix height proportionally
  },

  // Header
  header:         { backgroundColor: HEADER_BG, paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerText:     { flex: 1, marginRight: 8 },
  schoolName:     { color: '#fff', fontWeight: '800', fontSize: 13, lineHeight: 17 },
  headerSub:      { color: HEADER_SUB, fontSize: 10, marginTop: 2 },
  logoBox:        { width: 34, height: 34, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 8, justifyContent: 'center', alignItems: 'center', overflow: 'hidden', flexShrink: 0 },
  logoImg:        { width: 30, height: 30, borderRadius: 6 },

  // Body
  body:           { backgroundColor: '#fff', paddingHorizontal: 12, paddingVertical: 10, flexDirection: 'row', gap: 10 },

  // Avatar column
  avatarCol:      { flexShrink: 0 },
  avatar:         { width: 64, height: 64, borderRadius: 10, borderWidth: 2, borderColor: '#c7d2fe' },
  avatarFallback: { width: 64, height: 64, borderRadius: 10, backgroundColor: '#e0e7ff', borderWidth: 2, borderColor: '#c7d2fe', justifyContent: 'center', alignItems: 'center' },
  avatarInitials: { color: HALQA_700, fontWeight: '900', fontSize: 20 },

  // Info column
  infoCol:        { flex: 1, minWidth: 0 },
  studentName:    { fontWeight: '800', color: '#111827', fontSize: 14, lineHeight: 18 },
  studentIdText:  { color: HALQA_700, fontWeight: '700', fontSize: 11, marginTop: 2 },
  fieldList:      { marginTop: 5, gap: 2 },
  fieldRow:       { color: '#6b7280', fontSize: 10, lineHeight: 14 },

  // QR column
  qrCol:          { flexShrink: 0, alignItems: 'center', gap: 2 },
  qrImg:          { width: 62, height: 62, borderRadius: 4, borderWidth: 1, borderColor: '#e5e7eb' },
  qrCode:         { color: '#9ca3af', fontSize: 7, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', width: 62, textAlign: 'center' },
  qrPlaceholder:  { width: 62, height: 62, borderRadius: 4, backgroundColor: '#f3f4f6', justifyContent: 'center', alignItems: 'center', gap: 2 },
  qrNone:         { fontSize: 9, color: '#9ca3af' },

  // Footer
  footer:         { backgroundColor: FOOTER_BG, borderTopWidth: 1, borderTopColor: '#e0e7ff', paddingHorizontal: 14, paddingVertical: 6, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  footerLeft:     { color: HALQA_700, fontSize: 10 },
  footerRight:    { color: '#818cf8', fontSize: 10 },
});

// ── Loading skeleton ──────────────────────────────────────────────────────────
function LoadingSkeleton() {
  return (
    <View style={{ padding: 20, gap: 12 }}>
      <View style={{ height: 56, backgroundColor: '#e2e8f0', borderRadius: 10 }} />
      <View style={{ height: 110, backgroundColor: '#e2e8f0', borderRadius: 10 }} />
      <View style={{ height: 28, backgroundColor: '#e2e8f0', borderRadius: 10 }} />
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────
export default function StudentIdCardScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ studentId?: string }>();
  const { user } = useAuthStore();
  const activeMembership = useSchoolStore(s => s.getActiveMembership());
  const effectiveRole = activeMembership?.role ?? user?.role;
  const isStudent = effectiveRole === 'STUDENT';

  // If no studentId param, the student is viewing their own card.
  // We derive the student record from /auth/me → profile.student
  // If a studentId is provided (admin/teacher opening a student's card),
  // we fetch GET /students/:id which includes { school: { id, name, logoUrl } }.
  const targetStudentId = params.studentId;

  // ── Own card (student) ────────────────────────────────────────────────────
  const ownQuery = useQuery({
    queryKey: ['my-profile-id-card'],
    queryFn: async (): Promise<StudentData> => {
      const res = await api.get('/auth/me');
      const me = res.data.data;
      if (!me?.student) throw new Error('Student record not found');
      // Fetch full student record to get student.school (authoritative)
      const studentRes = await api.get(`/students/${me.student.id}`);
      return studentRes.data.data;
    },
    enabled: isStudent && !targetStudentId,
    staleTime: 5 * 60_000,
  });

  // ── Other student card (admin/teacher/guardian) ───────────────────────────
  const otherQuery = useQuery({
    queryKey: ['student-id-card', targetStudentId],
    queryFn: async (): Promise<StudentData> => {
      const res = await api.get(`/students/${targetStudentId}`);
      return res.data.data;
    },
    enabled: !!targetStudentId,
    staleTime: 5 * 60_000,
  });

  const query = targetStudentId ? otherQuery : ownQuery;
  const { data: student, isLoading, isError, error } = query;

  const handleShare = async () => {
    if (!student) return;
    try {
      await Share.share({
        message: `Student ID: ${student.studentId}\nName: ${student.user.firstName} ${student.user.lastName}\nQR: ${student.qrCode || student.studentId}`,
        title: 'Student ID Card',
      });
    } catch {}
  };

  const pageTitle = isStudent && !targetStudentId ? 'My ID Card' : 'Student ID Card';

  return (
    <>
      <Stack.Screen options={{
        headerShown: true,
        title: pageTitle,
        headerTintColor: '#4f46e5',
        headerStyle: { backgroundColor: '#fff' },
        headerTitleStyle: { color: '#111827', fontWeight: '800' },
        headerLeft: () => (
          <TouchableOpacity onPress={() => router.back()} style={{ padding: 4 }}>
            <Ionicons name="arrow-back" size={22} color="#4f46e5" />
          </TouchableOpacity>
        ),
        headerRight: student ? () => (
          <TouchableOpacity onPress={handleShare} style={{ padding: 4 }}>
            <Ionicons name="share-outline" size={22} color="#4f46e5" />
          </TouchableOpacity>
        ) : undefined,
      }} />

      <SafeAreaView style={s.container} edges={['bottom']}>
        {isLoading ? (
          <LoadingSkeleton />
        ) : isError ? (
          <View style={s.errorWrap}>
            <Ionicons name="alert-circle-outline" size={48} color="#ef4444" />
            <Text style={s.errorTitle}>Could not load ID card</Text>
            <Text style={s.errorSub}>
              {(error as any)?.response?.data?.message || 'Please try again.'}
            </Text>
            <TouchableOpacity style={s.retryBtn} onPress={() => query.refetch()}>
              <Text style={s.retryTxt}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : !student ? (
          <View style={s.errorWrap}>
            <Ionicons name="person-outline" size={48} color="#9ca3af" />
            <Text style={s.errorTitle}>Student not found</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
            {/* Subtitle — matches website modal subtitle */}
            <Text style={s.subtitle}>Student Identification Card</Text>

            {/* ── The ID Card ──────────────────────────────────────────────── */}
            <View style={s.cardContainer}>
              <IdCard student={student} />
            </View>

            {/* School details panel — extra info below card */}
            {student.school && (
              <View style={s.schoolPanel}>
                <View style={s.schoolPanelRow}>
                  <Ionicons name="school-outline" size={16} color="#4f46e5" style={{ marginRight: 6 }} />
                  <Text style={s.schoolPanelName}>{student.school.name}</Text>
                </View>
                {student.school.address ? (
                  <Text style={s.schoolPanelDetail}>📍 {student.school.address}</Text>
                ) : null}
                {student.school.phone ? (
                  <Text style={s.schoolPanelDetail}>📞 {student.school.phone}</Text>
                ) : null}
              </View>
            )}

            {/* Share hint */}
            <View style={s.hint}>
              <Ionicons name="information-circle-outline" size={14} color="#6b7280" />
              <Text style={s.hintText}>
                Tap the share icon to send this card, or show it directly to your teacher.
              </Text>
            </View>

            {/* QR attendance section — matches website footer message */}
            <View style={s.attendanceCard}>
              <Ionicons name="qr-code-outline" size={20} color="#4f46e5" />
              <View style={{ flex: 1 }}>
                <Text style={s.attendanceTitle}>QR Attendance</Text>
                <Text style={s.attendanceBody}>
                  Show your ID card's QR code to your teacher to mark attendance automatically.
                </Text>
              </View>
            </View>
          </ScrollView>
        )}
      </SafeAreaView>
    </>
  );
}

// ── Screen StyleSheet ─────────────────────────────────────────────────────────
const s = StyleSheet.create({
  container:      { flex: 1, backgroundColor: '#f8fafc' },
  scroll:         { padding: 16, gap: 14, paddingBottom: 32 },
  subtitle:       { fontSize: 13, fontWeight: '600', color: '#6b7280', textAlign: 'center', marginBottom: 2 },

  cardContainer:  {
    // Soft shadow matching website card shadow
    shadowColor: '#000', shadowOpacity: 0.10, shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 }, elevation: 6, borderRadius: 14,
  },

  // School panel
  schoolPanel:    { backgroundColor: '#fff', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#e0e7ff', gap: 6 },
  schoolPanelRow: { flexDirection: 'row', alignItems: 'center' },
  schoolPanelName:{ fontSize: 14, fontWeight: '700', color: '#1e1b4b', flex: 1 },
  schoolPanelDetail: { fontSize: 12, color: '#6b7280', paddingLeft: 22 },

  // Hint
  hint:           { flexDirection: 'row', alignItems: 'flex-start', gap: 6, paddingHorizontal: 4 },
  hintText:       { fontSize: 11, color: '#9ca3af', flex: 1, lineHeight: 16 },

  // Attendance card
  attendanceCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: '#eef2ff', borderRadius: 14, padding: 12 },
  attendanceTitle:{ fontSize: 13, fontWeight: '700', color: '#312e81' },
  attendanceBody: { fontSize: 11, color: '#4338ca', marginTop: 2, lineHeight: 16 },

  // Error / loading
  errorWrap:      { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 10 },
  errorTitle:     { fontSize: 17, fontWeight: '700', color: '#374151', textAlign: 'center' },
  errorSub:       { fontSize: 13, color: '#9ca3af', textAlign: 'center', lineHeight: 18 },
  retryBtn:       { marginTop: 8, backgroundColor: '#4f46e5', borderRadius: 12, paddingHorizontal: 24, paddingVertical: 10 },
  retryTxt:       { color: '#fff', fontWeight: '700', fontSize: 14 },
});
