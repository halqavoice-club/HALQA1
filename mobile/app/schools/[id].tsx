/**
 * HALQA Mobile — School Settings
 * Route: /schools/[id]
 *
 * Allows SCHOOL_ADMIN to:
 *   • Edit school name, type, description, contact info
 *   • Upload / change the school logo
 *   • Toggle school active status
 *   • Delete the school (SUPER_ADMIN only)
 *
 * Read-only view for other members.
 */
import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, ActivityIndicator, Image, Alert, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { showMessage } from 'react-native-flash-message';
import api from '@/lib/api';
import { useSchoolStore } from '@/store/school.store';
import { useAuthStore } from '@/store/auth.store';

const SCHOOL_TYPES = ['school', 'academy', 'college', 'daycare', 'camp', 'sports'];

interface SchoolData {
  id: string;
  name: string;
  slug: string;
  type: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  description: string | null;
  isActive: boolean;
  logoUrl: string | null;
}

interface Stats { students: number; teachers: number; classes: number; guardians: number }

export default function SchoolSettingsScreen() {
  const { id }        = useLocalSearchParams<{ id: string }>();
  const router        = useRouter();
  const qc            = useQueryClient();
  const user          = useAuthStore(s => s.user);
  const schoolStore   = useSchoolStore();

  // Access check
  const myMembership  = schoolStore.memberships.find(m => m.schoolId === id);
  const isSuperAdmin  = user?.role === 'SUPER_ADMIN';
  const isAdmin       = myMembership?.role === 'SCHOOL_ADMIN' || user?.role === 'SCHOOL_ADMIN';
  const canEdit       = isSuperAdmin || isAdmin;
  const canDelete     = isSuperAdmin;

  const [form, setForm] = useState<Partial<SchoolData>>({});
  const [isDirty, setDirty] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);
  const [showTypeMenu, setShowTypeMenu] = useState(false);

  const { data: school, isLoading } = useQuery({
    queryKey: ['school', id],
    queryFn: () => api.get(`/schools/${id}`).then(r => r.data.data as SchoolData),
    enabled: !!id,
  });

  const { data: stats } = useQuery({
    queryKey: ['school-stats', id],
    queryFn: () => api.get(`/schools/${id}/stats`).then(r => r.data.data as Stats),
    enabled: !!id,
  });

  useEffect(() => {
    if (school) setForm(school);
  }, [school]);

  const updateMutation = useMutation({
    mutationFn: (data: Partial<SchoolData>) => api.patch(`/schools/${id}`, data),
    onSuccess: () => {
      showMessage({ message: '✅ School updated', type: 'success' });
      setDirty(false);
      qc.invalidateQueries({ queryKey: ['school', id] });
    },
    onError: (e: any) => showMessage({ message: e?.response?.data?.message || 'Update failed', type: 'danger' }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/schools/${id}`),
    onSuccess: () => {
      showMessage({ message: 'School deleted', type: 'success' });
      router.replace('/schools' as any);
    },
    onError: (e: any) => showMessage({ message: e?.response?.data?.message || 'Delete failed', type: 'danger' }),
  });

  async function handleLogoUpload() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      showMessage({ message: 'Gallery permission required', type: 'warning' });
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.[0]) return;

    setLogoUploading(true);
    try {
      const asset = result.assets[0];
      const filename = asset.uri.split('/').pop() || 'logo.jpg';
      const match = /\.(\w+)$/.exec(filename);
      const type = match ? `image/${match[1]}` : 'image/jpeg';

      const formData = new FormData();
      formData.append('logo', { uri: asset.uri, name: filename, type } as any);

      await api.post(`/schools/${id}/logo`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      showMessage({ message: '✅ Logo updated', type: 'success' });
      qc.invalidateQueries({ queryKey: ['school', id] });
    } catch (e: any) {
      showMessage({ message: e?.response?.data?.message || 'Logo upload failed', type: 'danger' });
    } finally {
      setLogoUploading(false);
    }
  }

  function setField<K extends keyof SchoolData>(key: K, value: SchoolData[K]) {
    setForm(f => ({ ...f, [key]: value }));
    setDirty(true);
  }

  function confirmDelete() {
    Alert.alert(
      'Delete School',
      `Delete "${school?.name}"? This will deactivate the school for all members. This action cannot be easily undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => deleteMutation.mutate() },
      ]
    );
  }

  if (isLoading) {
    return (
      <SafeAreaView style={s.container}>
        <ActivityIndicator size="large" color="#4f46e5" style={{ marginTop: 60 }} />
      </SafeAreaView>
    );
  }

  if (!school) {
    return (
      <SafeAreaView style={s.container}>
        <Stack.Screen options={{ title: 'School Settings' }} />
        <View style={s.emptyWrap}>
          <Text style={s.emptyTitle}>School not found</Text>
          <TouchableOpacity style={s.backBtn} onPress={() => router.back()}>
            <Text style={s.backBtnText}>← Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const logoUrl = school.logoUrl
    ? (school.logoUrl.startsWith('http') ? school.logoUrl : `${api.defaults.baseURL?.replace('/api/v1', '')}${school.logoUrl}`)
    : null;

  return (
    <SafeAreaView style={s.container} edges={['bottom']}>
      <Stack.Screen options={{ title: school.name, headerBackTitle: 'My Schools' }} />
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">

        {/* Logo section */}
        <View style={s.logoSection}>
          <View style={s.logoWrap}>
            {logoUrl ? (
              <Image source={{ uri: logoUrl }} style={s.logo} resizeMode="contain" />
            ) : (
              <Ionicons name="school-outline" size={40} color="#4f46e5" />
            )}
            {canEdit && (
              <TouchableOpacity
                style={s.logoEditBtn}
                onPress={handleLogoUpload}
                disabled={logoUploading}
              >
                {logoUploading
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Ionicons name="camera" size={16} color="#fff" />
                }
              </TouchableOpacity>
            )}
          </View>
          <View style={s.schoolMeta}>
            <Text style={s.schoolName}>{school.name}</Text>
            <View style={s.statusRow}>
              <View style={[s.statusDot, { backgroundColor: school.isActive ? '#10b981' : '#9ca3af' }]} />
              <Text style={s.statusText}>{school.isActive ? 'Active' : 'Inactive'}</Text>
              {myMembership && (
                <View style={s.rolePill}>
                  <Text style={s.rolePillText}>{myMembership.role.replace(/_/g, ' ')}</Text>
                </View>
              )}
            </View>
          </View>
        </View>

        {/* Stats row */}
        {stats && (
          <View style={s.statsRow}>
            {[
              { label: 'Students',  value: stats.students,  icon: 'school-outline'  as any, color: '#4f46e5' },
              { label: 'Teachers',  value: stats.teachers,  icon: 'person-outline'  as any, color: '#10b981' },
              { label: 'Classes',   value: stats.classes,   icon: 'book-outline'    as any, color: '#f59e0b' },
              { label: 'Guardians', value: stats.guardians, icon: 'people-outline'  as any, color: '#8b5cf6' },
            ].map(stat => (
              <View key={stat.label} style={s.statCard}>
                <Ionicons name={stat.icon} size={18} color={stat.color} />
                <Text style={[s.statValue, { color: stat.color }]}>{stat.value}</Text>
                <Text style={s.statLabel}>{stat.label}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Edit form */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>School Information</Text>

          <Text style={s.label}>School Name</Text>
          <TextInput
            style={[s.input, !canEdit && s.inputDisabled]}
            value={form.name ?? ''}
            onChangeText={v => setField('name', v)}
            editable={canEdit}
            placeholder="School name"
            placeholderTextColor="#9ca3af"
          />

          <Text style={s.label}>Type</Text>
          <TouchableOpacity
            style={[s.input, s.picker, !canEdit && s.inputDisabled]}
            onPress={() => canEdit && setShowTypeMenu(v => !v)}
          >
            <Text style={s.pickerText}>{form.type || 'school'}</Text>
            {canEdit && <Ionicons name="chevron-down" size={16} color="#6b7280" />}
          </TouchableOpacity>
          {showTypeMenu && (
            <View style={s.typeMenu}>
              {SCHOOL_TYPES.map(t => (
                <TouchableOpacity
                  key={t}
                  style={[s.typeMenuItem, form.type === t && s.typeMenuItemActive]}
                  onPress={() => { setField('type', t); setShowTypeMenu(false); }}
                >
                  <Text style={[s.typeMenuItemText, form.type === t && { color: '#4f46e5', fontWeight: '700' }]}>
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          <Text style={s.label}>Description</Text>
          <TextInput
            style={[s.input, s.textarea, !canEdit && s.inputDisabled]}
            value={form.description ?? ''}
            onChangeText={v => setField('description', v)}
            editable={canEdit}
            placeholder="About your school…"
            placeholderTextColor="#9ca3af"
            multiline
            numberOfLines={3}
            textAlignVertical="top"
          />

          <Text style={s.label}>Email</Text>
          <TextInput
            style={[s.input, !canEdit && s.inputDisabled]}
            value={form.email ?? ''}
            onChangeText={v => setField('email', v)}
            editable={canEdit}
            keyboardType="email-address"
            autoCapitalize="none"
            placeholder="school@example.com"
            placeholderTextColor="#9ca3af"
          />

          <Text style={s.label}>Phone</Text>
          <TextInput
            style={[s.input, !canEdit && s.inputDisabled]}
            value={form.phone ?? ''}
            onChangeText={v => setField('phone', v)}
            editable={canEdit}
            keyboardType="phone-pad"
            placeholder="+1 555 000 0000"
            placeholderTextColor="#9ca3af"
          />

          <Text style={s.label}>City</Text>
          <TextInput
            style={[s.input, !canEdit && s.inputDisabled]}
            value={form.city ?? ''}
            onChangeText={v => setField('city', v)}
            editable={canEdit}
            placeholder="City"
            placeholderTextColor="#9ca3af"
          />

          <Text style={s.label}>Country</Text>
          <TextInput
            style={[s.input, !canEdit && s.inputDisabled]}
            value={form.country ?? ''}
            onChangeText={v => setField('country', v)}
            editable={canEdit}
            placeholder="US"
            placeholderTextColor="#9ca3af"
            autoCapitalize="characters"
            maxLength={2}
          />

          {isDirty && canEdit && (
            <TouchableOpacity
              style={[s.saveBtn, updateMutation.isPending && { opacity: 0.6 }]}
              onPress={() => updateMutation.mutate(form)}
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending
                ? <ActivityIndicator color="#fff" size="small" />
                : <>
                    <Ionicons name="save-outline" size={16} color="#fff" />
                    <Text style={s.saveBtnText}>Save Changes</Text>
                  </>
              }
            </TouchableOpacity>
          )}

          {!canEdit && (
            <Text style={s.readonlyNote}>Only the school admin can edit these details.</Text>
          )}
        </View>

        {/* Members management — admin only */}
        {isAdmin && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Members</Text>
            <TouchableOpacity
              style={s.navRow}
              onPress={() => router.push('/schools/members' as any)}
            >
              <Ionicons name="people-outline" size={20} color="#4f46e5" />
              <View style={{ flex: 1 }}>
                <Text style={s.navRowTitle}>Manage Members</Text>
                <Text style={s.navRowSub}>Approve requests, invite, change roles</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color="#d1d5db" />
            </TouchableOpacity>
          </View>
        )}

        {/* Status toggle — admin only */}
        {canEdit && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>School Status</Text>            <View style={s.toggleRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.toggleLabel}>School Active</Text>
                <Text style={s.toggleSub}>When inactive, school members lose access</Text>
              </View>
              <TouchableOpacity
                style={[s.toggle, school.isActive && s.toggleOn]}
                onPress={() => updateMutation.mutate({ isActive: !school.isActive })}
              >
                <View style={[s.toggleKnob, school.isActive && s.toggleKnobOn]} />
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Danger zone — SUPER_ADMIN only */}
        {canDelete && (
          <View style={[s.section, s.dangerSection]}>
            <Text style={[s.sectionTitle, { color: '#dc2626' }]}>Danger Zone</Text>
            <Text style={s.dangerText}>
              Deleting the school deactivates it for all members. All data is preserved.
            </Text>
            <TouchableOpacity
              style={[s.deleteBtn, deleteMutation.isPending && { opacity: 0.6 }]}
              onPress={confirmDelete}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending
                ? <ActivityIndicator color="#fff" size="small" />
                : <>
                    <Ionicons name="trash-outline" size={16} color="#fff" />
                    <Text style={s.deleteBtnText}>Delete School</Text>
                  </>
              }
            </TouchableOpacity>
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container:      { flex: 1, backgroundColor: '#f8fafc' },
  scroll:         { padding: 16 },

  // Logo
  logoSection:    { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 20, backgroundColor: '#fff', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#f1f5f9' },
  logoWrap:       { width: 72, height: 72, borderRadius: 18, backgroundColor: '#eef2ff', justifyContent: 'center', alignItems: 'center', overflow: 'hidden', position: 'relative' },
  logo:           { width: 72, height: 72, borderRadius: 18 },
  logoEditBtn:    { position: 'absolute', bottom: -2, right: -2, width: 26, height: 26, borderRadius: 13, backgroundColor: '#4f46e5', justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#fff' },
  schoolMeta:     { flex: 1 },
  schoolName:     { fontSize: 17, fontWeight: '800', color: '#111827', marginBottom: 4 },
  statusRow:      { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusDot:      { width: 7, height: 7, borderRadius: 4 },
  statusText:     { fontSize: 12, color: '#6b7280' },
  rolePill:       { backgroundColor: '#eef2ff', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 10 },
  rolePillText:   { fontSize: 10, color: '#4f46e5', fontWeight: '700', textTransform: 'capitalize' },

  // Stats
  statsRow:       { flexDirection: 'row', gap: 8, marginBottom: 16 },
  statCard:       { flex: 1, backgroundColor: '#fff', borderRadius: 12, padding: 10, alignItems: 'center', gap: 3, borderWidth: 1, borderColor: '#f1f5f9' },
  statValue:      { fontSize: 18, fontWeight: '800' },
  statLabel:      { fontSize: 9, color: '#9ca3af', fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.3 },

  // Form
  section:        { backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: '#f1f5f9' },
  sectionTitle:   { fontSize: 13, fontWeight: '700', color: '#374151', marginBottom: 14, textTransform: 'uppercase', letterSpacing: 0.5 },
  label:          { fontSize: 12, fontWeight: '600', color: '#6b7280', marginBottom: 5, marginTop: 10 },
  input:          { borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 14, color: '#111827', backgroundColor: '#f9fafb' },
  inputDisabled:  { opacity: 0.6 },
  textarea:       { height: 72, textAlignVertical: 'top' },
  picker:         { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pickerText:     { fontSize: 14, color: '#111827', textTransform: 'capitalize' },
  typeMenu:       { borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 10, overflow: 'hidden', marginTop: 2 },
  typeMenuItem:   { paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  typeMenuItemActive: { backgroundColor: '#eef2ff' },
  typeMenuItemText: { fontSize: 14, color: '#374151', textTransform: 'capitalize' },
  saveBtn:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#4f46e5', borderRadius: 12, paddingVertical: 13, marginTop: 18 },
  saveBtnText:    { color: '#fff', fontWeight: '700', fontSize: 14 },
  readonlyNote:   { fontSize: 12, color: '#9ca3af', textAlign: 'center', marginTop: 12, fontStyle: 'italic' },

  // Nav row
  navRow:         { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
  navRowTitle:    { fontSize: 14, fontWeight: '600', color: '#111827' },
  navRowSub:      { fontSize: 12, color: '#9ca3af', marginTop: 1 },

  // Toggle
  toggleRow:      { flexDirection: 'row', alignItems: 'center', gap: 12 },
  toggleLabel:    { fontSize: 14, fontWeight: '600', color: '#111827' },
  toggleSub:      { fontSize: 12, color: '#9ca3af', marginTop: 2 },
  toggle:         { width: 44, height: 26, borderRadius: 13, backgroundColor: '#e5e7eb', justifyContent: 'center', padding: 2 },
  toggleOn:       { backgroundColor: '#4f46e5' },
  toggleKnob:     { width: 22, height: 22, borderRadius: 11, backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 3, elevation: 2 },
  toggleKnobOn:   { alignSelf: 'flex-end' },

  // Danger
  dangerSection:  { borderColor: '#fee2e2', borderWidth: 1.5 },
  dangerText:     { fontSize: 12, color: '#9ca3af', marginBottom: 12 },
  deleteBtn:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#dc2626', borderRadius: 12, paddingVertical: 13 },
  deleteBtnText:  { color: '#fff', fontWeight: '700', fontSize: 14 },

  // Empty
  emptyWrap:      { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  emptyTitle:     { fontSize: 18, color: '#6b7280', marginBottom: 16 },
  backBtn:        { paddingHorizontal: 20, paddingVertical: 10, backgroundColor: '#f1f5f9', borderRadius: 10 },
  backBtnText:    { color: '#4f46e5', fontWeight: '600', fontSize: 14 },
});
