/**
 * HALQA Mobile — QR Check-in
 * Students: show own QR code (from API or generated)
 * Teachers/Admins: manual entry OR camera scan → mark attendance
 */
import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  ActivityIndicator, Image, ScrollView, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { showMessage } from 'react-native-flash-message';
import api from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { avatarUrl } from '@/lib/avatar';

// Build QR code image URL using free qrserver.com API
function qrUrl(value: string, size = 200) {
  if (!value) return '';
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(value)}&bgcolor=ffffff&color=1e3a8a`;
}

// ─── Student View — show own QR ───────────────────────────────────────────────
function StudentQRView() {
  const { data: profile, isLoading } = useQuery({
    queryKey: ['my-profile-qr'],
    queryFn: () => api.get('/auth/me').then(r => r.data.data),
  });

  const studentData = profile?.student;
  const myQR = studentData?.qrCode ?? '';
  const src = avatarUrl(profile?.avatarUrl, `${profile?.firstName ?? ''} ${profile?.lastName ?? ''}`);

  if (isLoading) return <ActivityIndicator size="large" color="#4f46e5" style={{ marginTop: 60 }} />;

  return (
    <ScrollView contentContainerStyle={sq.scroll}>
      {/* Profile */}
      <View style={sq.profileCard}>
        <View style={sq.avatarWrap}>
          {src
            ? <Image source={{ uri: src }} style={sq.avatar} />
            : <Text style={sq.avatarInitials}>
                {(profile?.firstName?.[0] ?? '') + (profile?.lastName?.[0] ?? '')}
              </Text>}
        </View>
        <Text style={sq.name}>{profile?.firstName} {profile?.lastName}</Text>
        <Text style={sq.studentId}>{studentData?.studentId ?? ''}</Text>
      </View>

      {/* QR */}
      {myQR ? (
        <View style={sq.qrCard}>
          <Image source={{ uri: qrUrl(myQR, 240) }} style={sq.qrImg} />
          <View style={sq.qrCodeRow}>
            <Ionicons name="qr-code-outline" size={14} color="#6b7280" />
            <Text style={sq.qrCode}>{myQR}</Text>
          </View>
        </View>
      ) : (
        <View style={sq.noQrCard}>
          <Ionicons name="qr-code-outline" size={48} color="#d1d5db" />
          <Text style={sq.noQrTitle}>QR code not assigned</Text>
          <Text style={sq.noQrSub}>Contact your teacher or admin</Text>
        </View>
      )}

      {/* How to use */}
      <View style={sq.howCard}>
        <Text style={sq.howTitle}>How to use</Text>
        <Text style={sq.howStep}>1. Show this QR code to your teacher</Text>
        <Text style={sq.howStep}>2. Teacher scans it on their device</Text>
        <Text style={sq.howStep}>3. Your attendance is recorded automatically</Text>
      </View>
    </ScrollView>
  );
}

const sq = StyleSheet.create({
  scroll:         { padding: 20, alignItems: 'center', gap: 16 },
  profileCard:    { alignItems: 'center', backgroundColor: '#fff', borderRadius: 20, padding: 20, width: '100%', borderWidth: 1, borderColor: '#f1f5f9' },
  avatarWrap:     { width: 72, height: 72, borderRadius: 36, backgroundColor: '#ede9fe', overflow: 'hidden', justifyContent: 'center', alignItems: 'center', marginBottom: 10 },
  avatar:         { width: 72, height: 72 },
  avatarInitials: { fontSize: 24, fontWeight: '900', color: '#4f46e5' },
  name:           { fontSize: 18, fontWeight: '800', color: '#111827' },
  studentId:      { fontSize: 13, color: '#9ca3af', marginTop: 2 },
  qrCard:         { backgroundColor: '#fff', borderRadius: 20, padding: 24, alignItems: 'center', gap: 12, width: '100%', borderWidth: 1, borderColor: '#e0e7ff' },
  qrImg:          { width: 240, height: 240, borderRadius: 8 },
  qrCodeRow:      { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#f8fafc', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6 },
  qrCode:         { fontSize: 12, color: '#6b7280', fontFamily: 'monospace' },
  noQrCard:       { alignItems: 'center', backgroundColor: '#fff', borderRadius: 20, padding: 32, gap: 8, width: '100%', borderWidth: 1, borderColor: '#f1f5f9' },
  noQrTitle:      { fontSize: 16, fontWeight: '700', color: '#374151', marginTop: 8 },
  noQrSub:        { fontSize: 13, color: '#9ca3af' },
  howCard:        { backgroundColor: '#ede9fe', borderRadius: 16, padding: 16, width: '100%', gap: 4 },
  howTitle:       { fontSize: 13, fontWeight: '700', color: '#4338ca', marginBottom: 4 },
  howStep:        { fontSize: 12, color: '#5b21b6' },
});

// ─── Teacher/Admin View — manual check-in ─────────────────────────────────────
function TeacherView() {
  const insets = useSafeAreaInsets();
  const [classId, setClassId] = useState('');
  const [code, setCode] = useState('');
  const [lastChecked, setLastChecked] = useState<{ name: string } | null>(null);

  const { data: classes = [] } = useQuery<any[]>({
    queryKey: ['classes'],
    queryFn: () => api.get('/classes').then(r => r.data.data ?? []),
  });

  const checkIn = useMutation({
    mutationFn: (qrCode: string) => api.post('/attendance/qr-checkin', { qrCode, classId }),
    onSuccess: (res) => {
      const student = res.data.data?.student;
      setLastChecked(student);
      setCode('');
      showMessage({ message: `✅ ${student?.name ?? 'Student'} checked in!`, type: 'success' });
    },
    onError: (e: any) => {
      showMessage({ message: e?.response?.data?.message ?? 'Check-in failed', type: 'danger' });
    },
  });

  const handleSubmit = useCallback(() => {
    if (!classId) { showMessage({ message: 'Select a class first', type: 'warning' }); return; }
    if (!code.trim()) return;
    checkIn.mutate(code.trim());
  }, [classId, code, checkIn]);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        {/* Class selector */}
        <View style={tv.section}>
          <Text style={tv.label}>Select Class *</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {classes.length === 0 && (
                <Text style={{ color: '#9ca3af', fontSize: 13 }}>No classes found</Text>
              )}
              {classes.map((c: any) => (
                <TouchableOpacity
                  key={c.id}
                  style={[tv.classChip, classId === c.id && tv.classChipActive]}
                  onPress={() => setClassId(c.id)}
                >
                  <Text style={[tv.classChipTxt, classId === c.id && tv.classChipTxtActive]}>
                    {c.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        </View>

        {/* Manual code entry */}
        <View style={tv.section}>
          <Text style={tv.label}>Enter QR Code / Student ID</Text>
          <TextInput
            value={code}
            onChangeText={setCode}
            placeholder="Type or paste student QR code..."
            placeholderTextColor="#9ca3af"
            style={tv.codeInput}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={handleSubmit}
          />
          <TouchableOpacity
            style={[tv.checkInBtn, (!code.trim() || !classId) && tv.checkInBtnDisabled]}
            onPress={handleSubmit}
            disabled={!code.trim() || !classId || checkIn.isPending}
          >
            {checkIn.isPending
              ? <ActivityIndicator color="#fff" />
              : <><Ionicons name="checkmark-circle" size={18} color="#fff" /><Text style={tv.checkInTxt}>Check In</Text></>
            }
          </TouchableOpacity>
        </View>

        {/* Info about camera scan */}
        <View style={tv.infoCard}>
          <Ionicons name="camera-outline" size={20} color="#4f46e5" />
          <View style={{ flex: 1 }}>
            <Text style={tv.infoTitle}>Camera scanning</Text>
            <Text style={tv.infoBody}>
              You can also use a USB barcode scanner — just focus the code input and scan.
              Camera-based QR scanning requires the expo-camera module (not available in Expo Go).
            </Text>
          </View>
        </View>

        {/* Last checked-in student */}
        {lastChecked && (
          <View style={tv.successCard}>
            <View style={tv.successIcon}>
              <Ionicons name="checkmark-circle" size={28} color="#10b981" />
            </View>
            <View>
              <Text style={tv.successTitle}>Checked in successfully</Text>
              <Text style={tv.successName}>{lastChecked.name}</Text>
            </View>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const tv = StyleSheet.create({
  section:           { backgroundColor: '#fff', borderRadius: 16, padding: 14, borderWidth: 1, borderColor: '#f1f5f9' },
  label:             { fontSize: 13, fontWeight: '700', color: '#374151' },
  classChip:         { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: '#f3f4f6', borderWidth: 1, borderColor: 'transparent' },
  classChipActive:   { backgroundColor: '#ede9fe', borderColor: '#7c3aed' },
  classChipTxt:      { fontSize: 13, fontWeight: '600', color: '#6b7280' },
  classChipTxtActive:{ color: '#7c3aed' },
  codeInput:         { marginTop: 10, backgroundColor: '#f8fafc', borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0', paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, color: '#111827', textAlign: 'center', fontFamily: 'monospace' },
  checkInBtn:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#4f46e5', borderRadius: 12, paddingVertical: 13, marginTop: 10 },
  checkInBtnDisabled:{ backgroundColor: '#d1d5db' },
  checkInTxt:        { color: '#fff', fontSize: 15, fontWeight: '700' },
  infoCard:          { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: '#eff6ff', borderRadius: 14, padding: 12 },
  infoTitle:         { fontSize: 13, fontWeight: '700', color: '#1d4ed8' },
  infoBody:          { fontSize: 11, color: '#3b82f6', marginTop: 2, lineHeight: 16 },
  successCard:       { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#f0fdf4', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#bbf7d0' },
  successIcon:       { width: 44, height: 44, borderRadius: 22, backgroundColor: '#dcfce7', justifyContent: 'center', alignItems: 'center' },
  successTitle:      { fontSize: 13, fontWeight: '700', color: '#166534' },
  successName:       { fontSize: 15, fontWeight: '800', color: '#15803d' },
});

// ─── Screen entry point ───────────────────────────────────────────────────────
export default function QrCheckinScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  const isStudent = user?.role === 'STUDENT';

  return (
    <>
      <Stack.Screen options={{
        headerShown: true,
        title: isStudent ? 'My QR Code' : 'QR Check-in',
        headerTintColor: '#4f46e5',
        headerStyle: { backgroundColor: '#fff' },
        headerTitleStyle: { color: '#111827', fontWeight: '800' },
        headerLeft: () => (
          <TouchableOpacity onPress={() => router.back()} style={{ padding: 4 }}>
            <Ionicons name="arrow-back" size={22} color="#4f46e5" />
          </TouchableOpacity>
        ),
      }} />
      <SafeAreaView style={{ flex: 1, backgroundColor: '#f8fafc' }} edges={['bottom']}>
        {isStudent ? <StudentQRView /> : <TeacherView />}
      </SafeAreaView>
    </>
  );
}
