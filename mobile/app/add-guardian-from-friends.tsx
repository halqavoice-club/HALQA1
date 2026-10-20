/**
 * HALQA Mobile — Add Guardian from Friends
 * Route: /add-guardian-from-friends
 *
 * Allows a School Admin to add a new guardian by searching their
 * social friends. Same pattern as add-student/add-teacher from friends.
 *
 * Flow:
 *   Step 1 — Search social friends → Select friend
 *   Step 2 → Choose Relationship → Tap "Add as Guardian"
 *           → POST /guardians { linkedUserId, relationship }
 *
 * No new User record is created — the existing HALQA account is linked.
 */

import KeyboardAvoidingView from '@/components/KeyboardAvoidingView';
import React, { useState, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  FlatList, Image, ActivityIndicator, ScrollView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { showMessage } from 'react-native-flash-message';
import api from '@/lib/api';
import { getAvatarUrl, getAvatarInitials, avatarColor } from '@/lib/avatar';

const RELATIONSHIPS = ['parent', 'guardian', 'grandparent', 'uncle', 'aunt', 'sibling', 'other'];

type Friend = {
  id: string;
  firstName: string;
  lastName: string;
  email?: string;
  avatarUrl?: string | null;
};

// ── Step bar ──────────────────────────────────────────────────────────────────
function StepBar({ step }: { step: 1 | 2 }) {
  return (
    <View style={st.stepBar}>
      <View style={[st.step, step >= 1 && st.stepActive]}>
        <Text style={[st.stepNum, step >= 1 && st.stepNumActive]}>1</Text>
        <Text style={[st.stepLabel, step >= 1 && st.stepLabelActive]}>Select Friend</Text>
      </View>
      <View style={st.stepLine} />
      <View style={[st.step, step >= 2 && st.stepActive]}>
        <Text style={[st.stepNum, step >= 2 && st.stepNumActive]}>2</Text>
        <Text style={[st.stepLabel, step >= 2 && st.stepLabelActive]}>Guardian Details</Text>
      </View>
    </View>
  );
}

// ── Step 1 — Select friend ────────────────────────────────────────────────────
function SelectFriendStep({ onSelect }: { onSelect: (f: Friend) => void }) {
  const [query, setQuery] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debouncedQuery, setDebouncedQuery] = useState('');

  const handleChange = (text: string) => {
    setQuery(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedQuery(text), 300);
  };

  const { data: friends = [], isLoading } = useQuery<Friend[]>({
    queryKey: ['admin-friends-search', debouncedQuery],
    queryFn: () =>
      api.get('/social/friends', { params: { search: debouncedQuery.trim() || undefined, limit: 30 } })
        .then(r => r.data.data ?? []),
    staleTime: 30_000,
  });

  return (
    <View style={{ flex: 1 }}>
      <View style={s1.searchRow}>
        <Ionicons name="search-outline" size={18} color="#9ca3af" />
        <TextInput
          style={s1.searchInput}
          value={query}
          onChangeText={handleChange}
          placeholder="Search friends by name…"
          placeholderTextColor="#9ca3af"
          autoCapitalize="none"
          autoCorrect={false}
          allowFontScaling={false}
        />
        {query.length > 0 && (
          <TouchableOpacity onPress={() => { setQuery(''); setDebouncedQuery(''); }}>
            <Ionicons name="close-circle" size={18} color="#9ca3af" />
          </TouchableOpacity>
        )}
      </View>

      {isLoading ? (
        <ActivityIndicator size="large" color="#4f46e5" style={{ marginTop: 40 }} />
      ) : friends.length === 0 ? (
        <View style={s1.empty}>
          <Ionicons name="people-outline" size={52} color="#d1d5db" />
          <Text style={s1.emptyTitle}>
            {debouncedQuery.length >= 2 ? `No friends found for "${debouncedQuery}"` : 'Search your friends'}
          </Text>
          <Text style={s1.emptySub}>Only social friends can be added as guardians this way.</Text>
        </View>
      ) : (
        <FlatList
          data={friends}
          keyExtractor={f => f.id}
          contentContainerStyle={{ padding: 12, gap: 8 }}
          renderItem={({ item: f }) => {
            const src      = f.avatarUrl ? getAvatarUrl(f.avatarUrl) : null;
            const initials = getAvatarInitials(f.firstName, f.lastName);
            const bg       = avatarColor(`${f.firstName}${f.lastName}`);
            return (
              <TouchableOpacity style={s1.friendRow} onPress={() => onSelect(f)} activeOpacity={0.7}>
                <View style={[s1.avatar, { backgroundColor: bg + '22' }]}>
                  {src ? <Image source={{ uri: src }} style={s1.avatarImg} />
                       : <Text style={[s1.avatarInit, { color: bg }]}>{initials}</Text>}
                </View>
                <View style={s1.info}>
                  <Text style={s1.name}>{f.firstName} {f.lastName}</Text>
                  {f.email ? <Text style={s1.email} numberOfLines={1}>{f.email}</Text> : null}
                </View>
                <View style={s1.friendBadge}>
                  <Ionicons name="people" size={11} color="#10b981" />
                  <Text style={s1.friendBadgeTxt}>Friend</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#d1d5db" />
              </TouchableOpacity>
            );
          }}
        />
      )}
    </View>
  );
}

const s1 = StyleSheet.create({
  searchRow:      { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#fff', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, marginHorizontal: 12, marginTop: 12, borderWidth: 1, borderColor: '#e5e7eb' },
  searchInput:    { flex: 1, fontSize: 15, color: '#111827' },
  friendRow:      { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderRadius: 14, padding: 12, borderWidth: 1, borderColor: '#f1f5f9' },
  avatar:         { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center', overflow: 'hidden', flexShrink: 0 },
  avatarImg:      { width: 44, height: 44, borderRadius: 22 },
  avatarInit:     { fontSize: 16, fontWeight: '800' },
  info:           { flex: 1, minWidth: 0 },
  name:           { fontSize: 14, fontWeight: '700', color: '#111827' },
  email:          { fontSize: 11, color: '#9ca3af', marginTop: 2 },
  friendBadge:    { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#f0fdf4', borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3, flexShrink: 0 },
  friendBadgeTxt: { fontSize: 10, color: '#10b981', fontWeight: '700' },
  empty:          { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 8 },
  emptyTitle:     { fontSize: 16, fontWeight: '700', color: '#374151', textAlign: 'center' },
  emptySub:       { fontSize: 13, color: '#9ca3af', textAlign: 'center', lineHeight: 18 },
});

// ── Step 2 — Guardian details ─────────────────────────────────────────────────
function GuardianDetailsStep({ friend, onBack, onSuccess }: { friend: Friend; onBack: () => void; onSuccess: () => void }) {
  const queryClient = useQueryClient();
  const [relationship, setRelationship] = useState('parent');

  const createMutation = useMutation({
    mutationFn: () =>
      api.post('/guardians', {
        linkedUserId: friend.id,
        firstName:    friend.firstName,
        lastName:     friend.lastName,
        email:        friend.email || undefined,
        relationship,
      }),
    onSuccess: () => {
      showMessage({ message: '✅ Guardian added successfully!', type: 'success', duration: 3000 });
      queryClient.invalidateQueries({ queryKey: ['guardians'] });
      onSuccess();
    },
    onError: (e: any) => {
      showMessage({ message: e?.response?.data?.message || 'Failed to add guardian', type: 'danger' });
    },
  });

  const bg      = avatarColor(`${friend.firstName}${friend.lastName}`);
  const initials = getAvatarInitials(friend.firstName, friend.lastName);
  const src      = friend.avatarUrl ? getAvatarUrl(friend.avatarUrl) : null;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }} keyboardShouldPersistTaps="handled">

        {/* Friend banner */}
        <View style={s2.friendBanner}>
          <View style={[s2.bannerAvatar, { backgroundColor: bg + '22' }]}>
            {src ? <Image source={{ uri: src }} style={s2.bannerAvatarImg} />
                 : <Text style={[s2.bannerAvatarInit, { color: bg }]}>{initials}</Text>}
          </View>
          <View style={s2.bannerInfo}>
            <Text style={s2.bannerName}>{friend.firstName} {friend.lastName}</Text>
            {friend.email
              ? <Text style={s2.bannerEmail}>{friend.email}</Text>
              : <Text style={s2.bannerEmailMissing}>⚠️ No email on file</Text>}
          </View>
          <TouchableOpacity onPress={onBack} style={s2.changeFriendBtn}>
            <Text style={s2.changeFriendTxt}>Change</Text>
          </TouchableOpacity>
        </View>

        {/* Info */}
        <View style={s2.infoBox}>
          <Ionicons name="information-circle-outline" size={16} color="#4f46e5" />
          <Text style={s2.infoTxt}>
            Name and email come from your friend&apos;s HALQA profile. Only the relationship can be set by you.
          </Text>
        </View>

        {/* Relationship picker */}
        <View style={s2.field}>
          <Text style={s2.label}>Relationship to Student</Text>
          <View style={s2.chipRow}>
            {RELATIONSHIPS.map(r => (
              <TouchableOpacity
                key={r}
                style={[s2.chip, relationship === r && s2.chipActive]}
                onPress={() => setRelationship(r)}
              >
                <Text style={[s2.chipTxt, relationship === r && s2.chipTxtActive]}>
                  {r.charAt(0).toUpperCase() + r.slice(1)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Existing account note */}
        <View style={[s2.infoBox, { backgroundColor: '#f0fdf4' }]}>
          <Ionicons name="checkmark-circle-outline" size={16} color="#10b981" />
          <Text style={[s2.infoTxt, { color: '#166534' }]}>
            This person already has a HALQA account. They will be linked to your school as a Guardian — no new account or password is created.
          </Text>
        </View>

        {/* Submit */}
        <TouchableOpacity
          style={[s2.submitBtn, createMutation.isPending && s2.submitBtnDisabled]}
          onPress={() => createMutation.mutate()}
          disabled={createMutation.isPending}
          activeOpacity={0.8}
        >
          {createMutation.isPending
            ? <ActivityIndicator color="#fff" size="small" />
            : <><Ionicons name="person-add-outline" size={18} color="#fff" /><Text style={s2.submitTxt}>Add as Guardian</Text></>
          }
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s2 = StyleSheet.create({
  friendBanner:      { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#eef2ff', borderRadius: 16, padding: 14, borderWidth: 1, borderColor: '#c7d2fe' },
  bannerAvatar:      { width: 48, height: 48, borderRadius: 24, justifyContent: 'center', alignItems: 'center', overflow: 'hidden', flexShrink: 0 },
  bannerAvatarImg:   { width: 48, height: 48, borderRadius: 24 },
  bannerAvatarInit:  { fontSize: 18, fontWeight: '900' },
  bannerInfo:        { flex: 1, minWidth: 0 },
  bannerName:        { fontSize: 15, fontWeight: '800', color: '#1e1b4b' },
  bannerEmail:       { fontSize: 12, color: '#4f46e5', marginTop: 2 },
  bannerEmailMissing:{ fontSize: 11, color: '#f59e0b', marginTop: 2 },
  changeFriendBtn:   { paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: '#c7d2fe', flexShrink: 0 },
  changeFriendTxt:   { fontSize: 12, color: '#4f46e5', fontWeight: '600' },
  infoBox:           { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: '#eff6ff', borderRadius: 12, padding: 12 },
  infoTxt:           { flex: 1, fontSize: 12, color: '#1d4ed8', lineHeight: 17 },
  field:             { gap: 8 },
  label:             { fontSize: 13, fontWeight: '700', color: '#374151' },
  chipRow:           { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip:              { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: '#f3f4f6', borderWidth: 1, borderColor: 'transparent' },
  chipActive:        { backgroundColor: '#eef2ff', borderColor: '#4f46e5' },
  chipTxt:           { fontSize: 13, fontWeight: '600', color: '#6b7280' },
  chipTxtActive:     { color: '#4f46e5' },
  submitBtn:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: '#4f46e5', borderRadius: 14, paddingVertical: 15, marginTop: 4 },
  submitBtnDisabled: { backgroundColor: '#c7d2fe' },
  submitTxt:         { color: '#fff', fontSize: 15, fontWeight: '800' },
});

// ── Main screen ───────────────────────────────────────────────────────────────
export default function AddGuardianFromFriendsScreen() {
  const router = useRouter();
  const [step,           setStep]           = useState<1 | 2>(1);
  const [selectedFriend, setSelectedFriend] = useState<Friend | null>(null);

  const handleSelectFriend = useCallback((f: Friend) => { setSelectedFriend(f); setStep(2); }, []);
  const handleBack = useCallback(() => {
    if (step === 2) { setStep(1); setSelectedFriend(null); } else { router.back(); }
  }, [step, router]);
  const handleSuccess = useCallback(() => { router.back(); }, [router]);

  return (
    <>
      <Stack.Screen options={{
        headerShown: true,
        title: 'Add Guardian from Friends',
        headerTintColor: '#4f46e5',
        headerStyle: { backgroundColor: '#fff' },
        headerTitleStyle: { color: '#111827', fontWeight: '800', fontSize: 15 },
        headerLeft: () => (
          <TouchableOpacity onPress={handleBack} style={{ padding: 4 }}>
            <Ionicons name="arrow-back" size={22} color="#4f46e5" />
          </TouchableOpacity>
        ),
      }} />
      <SafeAreaView style={sc.container} edges={['bottom']}>
        <StepBar step={step} />
        {step === 1
          ? <SelectFriendStep onSelect={handleSelectFriend} />
          : selectedFriend
            ? <GuardianDetailsStep friend={selectedFriend} onBack={handleBack} onSuccess={handleSuccess} />
            : null
        }
      </SafeAreaView>
    </>
  );
}

const st = StyleSheet.create({
  stepBar:         { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  step:            { flex: 1, alignItems: 'center', gap: 4 },
  stepActive:      {},
  stepNum:         { width: 24, height: 24, borderRadius: 12, backgroundColor: '#e2e8f0', textAlign: 'center', lineHeight: 24, fontSize: 12, fontWeight: '800', color: '#9ca3af', overflow: 'hidden' },
  stepNumActive:   { backgroundColor: '#4f46e5', color: '#fff' },
  stepLabel:       { fontSize: 11, color: '#9ca3af', fontWeight: '600' },
  stepLabelActive: { color: '#4f46e5' },
  stepLine:        { width: 40, height: 2, backgroundColor: '#e2e8f0', marginHorizontal: 6 },
});

const sc = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
});
