/**
 * HALQA Mobile — Guardian Detail Screen
 * Route: /guardians/:id
 *
 * Shows guardian profile, linked students, and allows:
 *   - SCHOOL_ADMIN: Edit relationship, Delete guardian
 */

import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { showMessage } from 'react-native-flash-message';
import api from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { useSchoolStore } from '@/store/school.store';

const RELATIONSHIPS = ['parent', 'guardian', 'grandparent', 'uncle', 'aunt', 'sibling', 'other'];

export default function GuardianDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router  = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const activeMembership = useSchoolStore(s => s.getActiveMembership());
  const effectiveRole = activeMembership?.role ?? user?.role;
  const canEdit = effectiveRole === 'SCHOOL_ADMIN';

  const [showRelPicker, setShowRelPicker] = useState(false);

  const { data: guardian, isLoading, isError } = useQuery({
    queryKey: ['guardian', id],
    queryFn: () => api.get(`/guardians/${id}`).then(r => r.data.data),
    enabled: !!id,
  });

  // ── Update relationship ───────────────────────────────────────────────────
  const updateMutation = useMutation({
    mutationFn: (relationship: string) => api.put(`/guardians/${id}`, { relationship }),
    onSuccess: () => {
      showMessage({ message: 'Relationship updated', type: 'success' });
      queryClient.invalidateQueries({ queryKey: ['guardian', id] });
      queryClient.invalidateQueries({ queryKey: ['guardians'] });
      setShowRelPicker(false);
    },
    onError: (e: any) => {
      showMessage({ message: e?.response?.data?.message || 'Update failed', type: 'danger' });
    },
  });

  // ── Delete guardian ───────────────────────────────────────────────────────
  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/guardians/${id}`),
    onSuccess: () => {
      showMessage({ message: 'Guardian removed', type: 'success' });
      queryClient.invalidateQueries({ queryKey: ['guardians'] });
      router.back();
    },
    onError: (e: any) => {
      showMessage({ message: e?.response?.data?.message || 'Delete failed', type: 'danger' });
    },
  });

  function promptDelete() {
    Alert.alert(
      'Remove Guardian',
      `Remove ${guardian?.user?.firstName} ${guardian?.user?.lastName} as a guardian? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => deleteMutation.mutate() },
      ]
    );
  }

  if (isLoading) {
    return (
      <SafeAreaView style={s.container}>
        <Stack.Screen options={{ title: 'Guardian', headerTintColor: '#ea580c' }} />
        <ActivityIndicator size="large" color="#ea580c" style={{ marginTop: 40 }} />
      </SafeAreaView>
    );
  }

  if (isError || !guardian) {
    return (
      <SafeAreaView style={s.container}>
        <Stack.Screen options={{ title: 'Guardian', headerTintColor: '#ea580c' }} />
        <View style={s.emptyWrap}>
          <Text style={s.emptyText}>Guardian not found</Text>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
            <Text style={s.backBtnText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const students = guardian.students || [];
  const initials = `${guardian.user?.firstName?.[0] ?? ''}${guardian.user?.lastName?.[0] ?? ''}`.toUpperCase();

  return (
    <>
      <Stack.Screen options={{
        title: `${guardian.user?.firstName} ${guardian.user?.lastName}`,
        headerTintColor: '#ea580c',
        headerStyle: { backgroundColor: '#fff' },
        headerTitleStyle: { color: '#111827', fontWeight: '700' },
        headerRight: canEdit ? () => (
          <TouchableOpacity onPress={promptDelete} style={{ padding: 8 }} disabled={deleteMutation.isPending}>
            {deleteMutation.isPending
              ? <ActivityIndicator size="small" color="#ef4444" />
              : <Ionicons name="trash-outline" size={20} color="#ef4444" />
            }
          </TouchableOpacity>
        ) : undefined,
      }} />

      <SafeAreaView style={s.container} edges={['bottom']}>
        <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

          {/* Profile card */}
          <View style={s.profileCard}>
            <View style={s.avatarBox}>
              <Text style={s.avatarText}>{initials}</Text>
            </View>
            <View style={s.profileInfo}>
              <Text style={s.name}>{guardian.user?.firstName} {guardian.user?.lastName}</Text>
              {guardian.user?.email && (
                <View style={s.infoRow}>
                  <Ionicons name="mail-outline" size={13} color="#9ca3af" />
                  <Text style={s.infoText} numberOfLines={1}>{guardian.user.email}</Text>
                </View>
              )}
              {guardian.user?.phone && (
                <View style={s.infoRow}>
                  <Ionicons name="call-outline" size={13} color="#9ca3af" />
                  <Text style={s.infoText}>{guardian.user.phone}</Text>
                </View>
              )}
            </View>
            <View style={s.statBox}>
              <Text style={s.statNum}>{students.length}</Text>
              <Text style={s.statLabel}>Children</Text>
            </View>
          </View>

          {/* Relationship — editable by admin */}
          <View style={s.section}>
            <Text style={s.sectionTitle}>Relationship</Text>
            {canEdit ? (
              <TouchableOpacity style={s.relBtn} onPress={() => setShowRelPicker(v => !v)}>
                <Text style={s.relBtnText}>{guardian.relationship?.charAt(0).toUpperCase() + guardian.relationship?.slice(1)}</Text>
                <Ionicons name="chevron-down" size={16} color="#ea580c" />
              </TouchableOpacity>
            ) : (
              <View style={s.relDisplay}>
                <Text style={s.relDisplayText}>{guardian.relationship?.charAt(0).toUpperCase() + guardian.relationship?.slice(1)}</Text>
              </View>
            )}

            {/* Relationship picker */}
            {showRelPicker && canEdit && (
              <View style={s.relPicker}>
                {RELATIONSHIPS.map(r => (
                  <TouchableOpacity
                    key={r}
                    style={[s.relOption, guardian.relationship === r && s.relOptionActive]}
                    onPress={() => updateMutation.mutate(r)}
                    disabled={updateMutation.isPending}
                  >
                    <Text style={[s.relOptionText, guardian.relationship === r && s.relOptionTextActive]}>
                      {r.charAt(0).toUpperCase() + r.slice(1)}
                    </Text>
                    {guardian.relationship === r && <Ionicons name="checkmark" size={14} color="#ea580c" />}
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>

          {/* Linked students */}
          <View style={s.section}>
            <Text style={s.sectionTitle}>Linked Students ({students.length})</Text>
            {students.length === 0 ? (
              <Text style={s.emptyText}>No students linked</Text>
            ) : (
              students.map((gs: any) => {
                const student = gs.student;
                const si = `${student?.user?.firstName?.[0] ?? ''}${student?.user?.lastName?.[0] ?? ''}`.toUpperCase();
                return (
                  <TouchableOpacity
                    key={student?.id}
                    style={s.studentRow}
                    onPress={() => router.push({ pathname: '/students/[id]', params: { id: student?.id } } as any)}
                    activeOpacity={0.7}
                  >
                    <View style={s.studentAvatar}>
                      <Text style={s.studentAvatarText}>{si}</Text>
                    </View>
                    <View style={s.studentInfo}>
                      <Text style={s.studentName}>{student?.user?.firstName} {student?.user?.lastName}</Text>
                      <Text style={s.studentId}>{student?.studentId}</Text>
                      {student?.enrollments?.length > 0 && (
                        <Text style={s.studentClass} numberOfLines={1}>
                          {student.enrollments.map((e: any) => e.class?.name).join(', ')}
                        </Text>
                      )}
                    </View>
                    <View style={s.studentRight}>
                      {gs.isPrimary && (
                        <View style={s.primaryBadge}><Text style={s.primaryBadgeText}>Primary</Text></View>
                      )}
                      <Ionicons name="chevron-forward" size={16} color="#d1d5db" />
                    </View>
                  </TouchableOpacity>
                );
              })
            )}
          </View>

          {/* Delete button */}
          {canEdit && (
            <TouchableOpacity
              style={[s.deleteBtn, deleteMutation.isPending && s.deleteBtnDisabled]}
              onPress={promptDelete}
              disabled={deleteMutation.isPending}
              activeOpacity={0.8}
            >
              {deleteMutation.isPending
                ? <ActivityIndicator color="#ef4444" size="small" />
                : <><Ionicons name="trash-outline" size={16} color="#ef4444" /><Text style={s.deleteBtnText}>Remove Guardian from School</Text></>
              }
            </TouchableOpacity>
          )}
        </ScrollView>
      </SafeAreaView>
    </>
  );
}

const s = StyleSheet.create({
  container:           { flex: 1, backgroundColor: '#f8fafc' },
  scroll:              { padding: 16, paddingBottom: 40, gap: 12 },

  // Profile card
  profileCard:         { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: '#fff', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#f1f5f9' },
  avatarBox:           { width: 56, height: 56, borderRadius: 28, backgroundColor: '#ffedd5', justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  avatarText:          { fontSize: 20, fontWeight: '900', color: '#ea580c' },
  profileInfo:         { flex: 1, minWidth: 0, gap: 3 },
  name:                { fontSize: 16, fontWeight: '800', color: '#111827' },
  infoRow:             { flexDirection: 'row', alignItems: 'center', gap: 5 },
  infoText:            { fontSize: 12, color: '#6b7280', flex: 1 },
  statBox:             { alignItems: 'center', backgroundColor: '#fff7ed', borderRadius: 12, paddingVertical: 8, paddingHorizontal: 12, flexShrink: 0 },
  statNum:             { fontSize: 20, fontWeight: '800', color: '#ea580c' },
  statLabel:           { fontSize: 10, color: '#fb923c', marginTop: 2 },

  // Section
  section:             { backgroundColor: '#fff', borderRadius: 16, padding: 16, gap: 8, borderWidth: 1, borderColor: '#f1f5f9' },
  sectionTitle:        { fontSize: 13, fontWeight: '700', color: '#374151', marginBottom: 4 },

  // Relationship
  relBtn:              { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#fff7ed', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: '#fed7aa' },
  relBtnText:          { fontSize: 14, fontWeight: '600', color: '#ea580c' },
  relDisplay:          { backgroundColor: '#f9fafb', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 },
  relDisplayText:      { fontSize: 14, color: '#374151', fontWeight: '500' },
  relPicker:           { borderRadius: 12, borderWidth: 1, borderColor: '#e5e7eb', overflow: 'hidden', marginTop: 4 },
  relOption:           { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 11, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  relOptionActive:     { backgroundColor: '#fff7ed' },
  relOptionText:       { fontSize: 14, color: '#374151', fontWeight: '500', textTransform: 'capitalize' },
  relOptionTextActive: { color: '#ea580c', fontWeight: '700' },

  // Students
  studentRow:          { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#f3f4f6' },
  studentAvatar:       { width: 38, height: 38, borderRadius: 19, backgroundColor: '#eef2ff', justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  studentAvatarText:   { fontSize: 13, fontWeight: '800', color: '#4f46e5' },
  studentInfo:         { flex: 1, minWidth: 0, gap: 2 },
  studentName:         { fontSize: 14, fontWeight: '700', color: '#111827' },
  studentId:           { fontSize: 11, color: '#9ca3af' },
  studentClass:        { fontSize: 11, color: '#6b7280' },
  studentRight:        { flexDirection: 'row', alignItems: 'center', gap: 6 },
  primaryBadge:        { backgroundColor: '#eef2ff', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 20 },
  primaryBadgeText:    { fontSize: 10, color: '#4f46e5', fontWeight: '700' },

  // Delete
  deleteBtn:           { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 13, borderRadius: 12, borderWidth: 1.5, borderColor: '#fecaca', backgroundColor: '#fff5f5', marginTop: 4 },
  deleteBtnDisabled:   { opacity: 0.5 },
  deleteBtnText:       { fontSize: 14, fontWeight: '700', color: '#ef4444' },

  // Empty/error
  emptyWrap:           { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyText:           { fontSize: 14, color: '#9ca3af', textAlign: 'center' },
  backBtn:             { marginTop: 12, paddingHorizontal: 20, paddingVertical: 10, backgroundColor: '#f3f4f6', borderRadius: 10 },
  backBtnText:         { color: '#4f46e5', fontWeight: '600' },
});
