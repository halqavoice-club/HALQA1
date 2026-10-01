/**
 * HALQA Mobile — Join School Screen
 * Route: /schools/join
 *
 * Step 1: Search schools by name
 * Step 2: Select role (Student / Teacher / Guardian)
 * Step 3: Send join request (PENDING until admin approves)
 *
 * Social platform access is completely unaffected by joining a school.
 * Endpoints: GET /schools/search, POST /school-memberships/join
 */
import KeyboardAvoidingView from '@/components/KeyboardAvoidingView';
import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet,
  ActivityIndicator, ScrollView, Platform, Image} from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { showMessage } from 'react-native-flash-message';
import api from '@/lib/api';

type SchoolResult = {
  id: string;
  name: string;
  slug: string;
  type: string;
  city: string | null;
  country: string;
  logoUrl: string | null;
};

type Role = 'STUDENT' | 'TEACHER' | 'GUARDIAN';

const ROLE_OPTIONS: { value: Role; label: string; icon: any; description: string }[] = [
  { value: 'STUDENT',  label: 'Student',          icon: 'school-outline',   description: 'Enroll as a student — requires admin approval' },
  { value: 'TEACHER',  label: 'Teacher',           icon: 'person-outline',   description: 'Join as a teacher — requires admin approval' },
  { value: 'GUARDIAN', label: 'Guardian / Parent', icon: 'people-outline',   description: 'Monitor a student as their guardian' },
];

export default function JoinSchoolScreen() {
  const router = useRouter();

  const [query,     setQuery]     = useState('');
  const [results,   setResults]   = useState<SchoolResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected,  setSelected]  = useState<SchoolResult | null>(null);
  const [role,      setRole]      = useState<Role>('STUDENT');
  const [joining,   setJoining]   = useState(false);
  const [success,   setSuccess]   = useState(false);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setSearching(true);
    setResults([]);
    try {
      const res = await api.get('/schools/search', { params: { search: query.trim(), limit: 10 } });
      setResults(res.data.data ?? []);
    } catch (err: any) {
      showMessage({ message: err?.response?.data?.message ?? 'Search failed', type: 'danger' });
    } finally {
      setSearching(false);
    }
  };

  const handleJoin = async () => {
    if (!selected) return;
    setJoining(true);
    try {
      await api.post('/school-memberships/join', { schoolId: selected.id, role });
      setSuccess(true);
      showMessage({ message: `Join request sent to ${selected.name}!`, type: 'success', duration: 3000 });
      setTimeout(() => router.back(), 2000);
    } catch (err: any) {
      showMessage({ message: err?.response?.data?.message ?? 'Failed to join school', type: 'danger' });
    } finally {
      setJoining(false);
    }
  };

  if (success) {
    return (
      <SafeAreaView style={[s.container, s.center]}>
        <Text style={{ fontSize: 64, marginBottom: 16 }}>✅</Text>
        <Text style={s.successTitle}>Request Sent!</Text>
        <Text style={s.successSub}>
          Your join request for{'\n'}
          <Text style={{ fontWeight: '700', color: '#2563eb' }}>{selected?.name}</Text>
          {'\n'}is pending admin approval.
        </Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.container} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Join a School', headerBackTitle: 'Back' }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">

          {/* Info banner */}
          <View style={s.infoBanner}>
            <Ionicons name="information-circle-outline" size={18} color="#2563eb" />
            <Text style={s.infoText}>
              Joining a school adds Education features. Your Social access (feed, voice, communities) is unaffected.
            </Text>
          </View>

          {!selected ? (
            <>
              {/* Search */}
              <Text style={s.sectionTitle}>Search for a School</Text>
              <View style={s.searchRow}>
                <View style={s.searchInput}>
                  <Ionicons name="search-outline" size={16} color="#9ca3af" />
                  <TextInput
                    style={s.searchField}
                    value={query}
                    onChangeText={setQuery}
                    placeholder="School name or slug…"
                    placeholderTextColor="#9ca3af"
                    returnKeyType="search"
                    onSubmitEditing={handleSearch}
                    autoCapitalize="none"
                  />
                  {query.length > 0 && (
                    <TouchableOpacity onPress={() => { setQuery(''); setResults([]); }}>
                      <Ionicons name="close-circle" size={16} color="#9ca3af" />
                    </TouchableOpacity>
                  )}
                </View>
                <TouchableOpacity
                  style={[s.searchBtn, (!query.trim() || searching) && { opacity: 0.5 }]}
                  onPress={handleSearch}
                  disabled={!query.trim() || searching}
                >
                  {searching
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={s.searchBtnText}>Search</Text>
                  }
                </TouchableOpacity>
              </View>

              {/* Results */}
              {results.length > 0 && (
                <View style={s.results}>
                  {results.map(school => (
                    <TouchableOpacity
                      key={school.id}
                      style={s.schoolCard}
                      onPress={() => setSelected(school)}
                      activeOpacity={0.7}
                    >
                      <View style={s.schoolIcon}>
                        {school.logoUrl
                          ? <Image source={{ uri: school.logoUrl }} style={{ width: 32, height: 32, borderRadius: 6 }} resizeMode="contain" />
                          : <Ionicons name="school-outline" size={20} color="#6b7280" />
                        }
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={s.schoolName} numberOfLines={1}>{school.name}</Text>
                        <Text style={s.schoolMeta} numberOfLines={1}>
                          {school.type} · {school.city ? `${school.city}, ` : ''}{school.country}
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={18} color="#d1d5db" />
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              {results.length === 0 && query && !searching && (
                <View style={s.emptyWrap}>
                  <Ionicons name="search-outline" size={36} color="#d1d5db" />
                  <Text style={s.emptyText}>No schools found for "{query}"</Text>
                </View>
              )}

              {/* Create school link */}
              <TouchableOpacity style={s.createLink} onPress={() => router.push('/schools/create' as any)}>
                <Ionicons name="add-circle-outline" size={16} color="#4f46e5" />
                <Text style={s.createLinkText}>Don't see your school? Create one</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              {/* Selected school */}
              <View style={s.selectedCard}>
                <View style={s.schoolIcon}>
                  {selected.logoUrl
                    ? <Image source={{ uri: selected.logoUrl }} style={{ width: 32, height: 32, borderRadius: 6 }} resizeMode="contain" />
                    : <Ionicons name="school-outline" size={20} color="#2563eb" />
                  }
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.selectedName}>{selected.name}</Text>
                  <Text style={s.selectedMeta}>{selected.type}</Text>
                </View>
                <TouchableOpacity onPress={() => setSelected(null)} style={s.changeBtn}>
                  <Text style={s.changeBtnText}>Change</Text>
                </TouchableOpacity>
              </View>

              {/* Role selection */}
              <Text style={s.sectionTitle}>How are you joining?</Text>
              <View style={s.roleList}>
                {ROLE_OPTIONS.map(opt => (
                  <TouchableOpacity
                    key={opt.value}
                    style={[s.roleCard, role === opt.value && s.roleCardActive]}
                    onPress={() => setRole(opt.value)}
                    activeOpacity={0.7}
                  >
                    <View style={[s.roleIcon, role === opt.value && s.roleIconActive]}>
                      <Ionicons name={opt.icon} size={20} color={role === opt.value ? '#2563eb' : '#6b7280'} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[s.roleLabel, role === opt.value && { color: '#1e40af' }]}>{opt.label}</Text>
                      <Text style={s.roleDesc}>{opt.description}</Text>
                    </View>
                    <View style={[s.radioOuter, role === opt.value && s.radioOuterActive]}>
                      {role === opt.value && <View style={s.radioInner} />}
                    </View>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Actions */}
              <View style={s.actions}>
                <TouchableOpacity style={s.cancelBtn} onPress={() => setSelected(null)}>
                  <Text style={s.cancelBtnText}>Back</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.joinBtn, joining && { opacity: 0.6 }]}
                  onPress={handleJoin}
                  disabled={joining}
                >
                  {joining
                    ? <ActivityIndicator color="#fff" size="small" />
                    : (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Ionicons name="send-outline" size={16} color="#fff" />
                        <Text style={s.joinBtnText}>Send Join Request</Text>
                      </View>
                    )
                  }
                </TouchableOpacity>
              </View>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container:      { flex: 1, backgroundColor: '#f8fafc' },
  center:         { justifyContent: 'center', alignItems: 'center', padding: 32 },
  scroll:         { padding: 16, gap: 12 },
  infoBanner:     { flexDirection: 'row', gap: 8, backgroundColor: '#eff6ff', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#bfdbfe', alignItems: 'flex-start' },
  infoText:       { flex: 1, fontSize: 13, color: '#1d4ed8', lineHeight: 18 },
  sectionTitle:   { fontSize: 15, fontWeight: '700', color: '#111827', marginTop: 8 },
  searchRow:      { flexDirection: 'row', gap: 8 },
  searchInput:    { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 12, paddingHorizontal: 12 },
  searchField:    { flex: 1, paddingVertical: 12, fontSize: 15, color: '#111827' },
  searchBtn:      { backgroundColor: '#2563eb', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12, justifyContent: 'center' },
  searchBtnText:  { color: '#fff', fontWeight: '700', fontSize: 14 },
  results:        { gap: 6 },
  schoolCard:     { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#e5e7eb' },
  schoolIcon:     { width: 40, height: 40, borderRadius: 10, backgroundColor: '#f1f5f9', justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  schoolName:     { fontSize: 14, fontWeight: '700', color: '#111827' },
  schoolMeta:     { fontSize: 12, color: '#6b7280', marginTop: 2, textTransform: 'capitalize' },
  emptyWrap:      { alignItems: 'center', paddingVertical: 32, gap: 8 },
  emptyText:      { fontSize: 14, color: '#9ca3af' },
  createLink:     { flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'center', paddingVertical: 12 },
  createLinkText: { color: '#4f46e5', fontSize: 14, fontWeight: '600' },
  selectedCard:   { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#eff6ff', borderRadius: 14, padding: 14, borderWidth: 1.5, borderColor: '#bfdbfe' },
  selectedName:   { fontSize: 14, fontWeight: '700', color: '#1e3a8a' },
  selectedMeta:   { fontSize: 12, color: '#3b82f6', textTransform: 'capitalize', marginTop: 2 },
  changeBtn:      { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: '#dbeafe' },
  changeBtnText:  { fontSize: 12, color: '#1d4ed8', fontWeight: '600' },
  roleList:       { gap: 8 },
  roleCard:       { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderRadius: 14, padding: 14, borderWidth: 2, borderColor: '#e5e7eb' },
  roleCardActive: { borderColor: '#2563eb', backgroundColor: '#eff6ff' },
  roleIcon:       { width: 36, height: 36, borderRadius: 10, backgroundColor: '#f1f5f9', justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  roleIconActive: { backgroundColor: '#dbeafe' },
  roleLabel:      { fontSize: 14, fontWeight: '700', color: '#111827' },
  roleDesc:       { fontSize: 12, color: '#6b7280', marginTop: 2, lineHeight: 16 },
  radioOuter:     { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: '#d1d5db', justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  radioOuterActive: { borderColor: '#2563eb' },
  radioInner:     { width: 10, height: 10, borderRadius: 5, backgroundColor: '#2563eb' },
  actions:        { flexDirection: 'row', gap: 10, marginTop: 8 },
  cancelBtn:      { flex: 1, paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: '#e5e7eb', alignItems: 'center', backgroundColor: '#fff' },
  cancelBtnText:  { fontSize: 14, fontWeight: '600', color: '#6b7280' },
  joinBtn:        { flex: 2, paddingVertical: 14, borderRadius: 12, backgroundColor: '#2563eb', alignItems: 'center' },
  joinBtnText:    { color: '#fff', fontSize: 14, fontWeight: '800' },
  successTitle:   { fontSize: 26, fontWeight: '900', color: '#111827', textAlign: 'center' },
  successSub:     { fontSize: 15, color: '#6b7280', textAlign: 'center', lineHeight: 22, marginTop: 8 },
});





