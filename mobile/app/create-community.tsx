/**
 * HALQA Mobile — Create Community Screen
 */
import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  SafeAreaView, ScrollView, ActivityIndicator, KeyboardAvoidingView, Platform
} from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { showMessage } from 'react-native-flash-message';
import api from '@/lib/api';

const PRIVACY_OPTIONS = [
  { value: 'PUBLIC',      label: 'Public',      icon: '🌍', desc: 'Anyone can join and see posts' },
  { value: 'PRIVATE',     label: 'Private',     icon: '🔒', desc: 'Members only — posts hidden from non-members' },
  { value: 'INVITE_ONLY', label: 'Invite Only', icon: '✉️', desc: 'Members must be invited by an admin' },
];

const CATEGORIES = ['education','religion','technology','sports','arts','health','other'];

export default function CreateCommunityScreen() {
  const router = useRouter();
  const [name,        setName]        = useState('');
  const [description, setDescription] = useState('');
  const [privacy,     setPrivacy]     = useState('PUBLIC');
  const [category,    setCategory]    = useState('');
  const [rules,       setRules]       = useState('');
  const [loading,     setLoading]     = useState(false);

  const handleCreate = async () => {
    if (!name.trim()) { showMessage({ message: 'Community name is required', type: 'warning' }); return; }
    setLoading(true);
    try {
      const res = await api.post('/communities', {
        name:        name.trim(),
        description: description.trim() || undefined,
        privacy,
        category:    category || undefined,
        rules:       rules.trim() || undefined,
      });
      const community = res.data.data;
      showMessage({ message: 'Community created!', type: 'success' });
      router.replace({ pathname: '/community/[slug]', params: { slug: community.slug } } as any);
    } catch (err: any) {
      showMessage({ message: err?.response?.data?.message || 'Failed to create community', type: 'danger' });
    } finally { setLoading(false); }
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Create Community', headerShown: true, headerTintColor: '#4f46e5' }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <SafeAreaView style={styles.container}>
          <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

            <Text style={styles.label}>Name *</Text>
            <TextInput style={styles.input} value={name} onChangeText={setName}
              placeholder="Community name" placeholderTextColor="#94a3b8" maxLength={120} />

            <Text style={styles.label}>Description</Text>
            <TextInput style={[styles.input, styles.inputMulti]} value={description}
              onChangeText={setDescription} placeholder="What is this community about?"
              placeholderTextColor="#94a3b8" multiline numberOfLines={3} maxLength={2000} />

            <Text style={styles.label}>Category</Text>
            <View style={styles.chipRow}>
              {CATEGORIES.map(c => (
                <TouchableOpacity key={c} style={[styles.chip, category === c && styles.chipActive]} onPress={() => setCategory(c === category ? '' : c)}>
                  <Text style={[styles.chipText, category === c && { color: '#6366f1' }]}>{c}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.label}>Privacy</Text>
            {PRIVACY_OPTIONS.map(opt => (
              <TouchableOpacity key={opt.value}
                style={[styles.privacyOpt, privacy === opt.value && styles.privacyOptActive]}
                onPress={() => setPrivacy(opt.value)}>
                <Text style={styles.privacyIcon}>{opt.icon}</Text>
                <View style={styles.privacyInfo}>
                  <Text style={[styles.privacyLabel, privacy === opt.value && { color: '#6366f1' }]}>{opt.label}</Text>
                  <Text style={styles.privacyDesc}>{opt.desc}</Text>
                </View>
                {privacy === opt.value && <View style={styles.check}><Text style={styles.checkText}>✓</Text></View>}
              </TouchableOpacity>
            ))}

            <Text style={styles.label}>Community Rules (optional)</Text>
            <TextInput style={[styles.input, styles.inputMulti]} value={rules}
              onChangeText={setRules} placeholder="Rules members must follow..."
              placeholderTextColor="#94a3b8" multiline numberOfLines={4} maxLength={5000} />

            <TouchableOpacity style={[styles.createBtn, loading && { opacity: 0.7 }]}
              onPress={handleCreate} disabled={loading}>
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.createBtnText}>🏘️  Create Community</Text>}
            </TouchableOpacity>

          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  container:        { flex: 1, backgroundColor: '#f8fafc' },
  scroll:           { padding: 16, paddingBottom: 40 },
  label:            { fontSize: 13, fontWeight: '700', color: '#475569', marginBottom: 8, marginTop: 16, textTransform: 'uppercase', letterSpacing: 0.5 },
  input:            { backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0', padding: 14, fontSize: 15, color: '#1e293b' },
  inputMulti:       { height: 96, textAlignVertical: 'top' },
  chipRow:          { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip:             { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#e2e8f0' },
  chipActive:       { borderColor: '#6366f1', backgroundColor: '#e0e7ff' },
  chipText:         { fontSize: 13, fontWeight: '600', color: '#64748b', textTransform: 'capitalize' },
  privacyOpt:       { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1.5, borderColor: '#e2e8f0', gap: 12 },
  privacyOptActive: { borderColor: '#6366f1', backgroundColor: '#f5f3ff' },
  privacyIcon:      { fontSize: 22 },
  privacyInfo:      { flex: 1 },
  privacyLabel:     { fontSize: 14, fontWeight: '700', color: '#1e293b' },
  privacyDesc:      { fontSize: 12, color: '#94a3b8', marginTop: 2 },
  check:            { width: 22, height: 22, borderRadius: 11, backgroundColor: '#6366f1', alignItems: 'center', justifyContent: 'center' },
  checkText:        { color: '#fff', fontWeight: '900', fontSize: 12 },
  createBtn:        { backgroundColor: '#6366f1', borderRadius: 14, padding: 16, alignItems: 'center', marginTop: 24 },
  createBtnText:    { color: '#fff', fontSize: 16, fontWeight: '800' },
});
