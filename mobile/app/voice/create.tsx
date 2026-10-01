/**
 * HALQA Mobile — Create Voice Room Screen
 */
import KeyboardAvoidingView from '@/components/KeyboardAvoidingView';
import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  SafeAreaView, ScrollView, ActivityIndicator, Platform} from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { showMessage } from 'react-native-flash-message';
import api from '@/lib/api';

const EMOJIS = ['🎙️', '🎵', '🎤', '💬', '📻', '🔊', '🌟', '🎭', '🏆', '💡', '🌍', '❤️'];
const PRIVACY_OPTIONS = [
  { value: 'PUBLIC',       label: 'Public',       icon: '🌍', desc: 'Anyone can join' },
  { value: 'PRIVATE',      label: 'Private',      icon: '🔒', desc: 'Only invited users' },
  { value: 'INVITE_ONLY',  label: 'Invite Only',  icon: '✉️',  desc: 'Share a link to invite' },
];

export default function CreateVoiceRoomScreen() {
  const router = useRouter();
  const [title,       setTitle]      = useState('');
  const [topic,       setTopic]      = useState('');
  const [description, setDescription] = useState('');
  const [emoji,       setEmoji]      = useState('🎙️');
  const [privacy,     setPrivacy]    = useState('PUBLIC');
  const [loading,     setLoading]    = useState(false);

  const handleCreate = async () => {
    if (!title.trim()) {
      showMessage({ message: 'Room title is required', type: 'warning' });
      return;
    }
    setLoading(true);
    try {
      const res = await api.post('/voice', {
        title: title.trim(),
        topic: topic.trim() || undefined,
        description: description.trim() || undefined,
        coverEmoji: emoji,
        privacy,
      });
      const room = res.data.data;
      showMessage({ message: 'Room created!', type: 'success' });
      router.replace({ pathname: '/voice/[id]', params: { id: room.id } } as any);
    } catch (err: any) {
      showMessage({
        message: err?.response?.data?.message || 'Failed to create room',
        type: 'danger'
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Create Voice Room', headerShown: true, headerTintColor: '#4f46e5' }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <SafeAreaView style={styles.container}>
          <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

            {/* Emoji picker */}
            <Text style={styles.label}>Room Emoji</Text>
            <View style={styles.emojiGrid}>
              {EMOJIS.map(e => (
                <TouchableOpacity
                  key={e}
                  style={[styles.emojiBtn, emoji === e && styles.emojiBtnActive]}
                  onPress={() => setEmoji(e)}
                >
                  <Text style={styles.emojiText}>{e}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Title */}
            <Text style={styles.label}>Room Title *</Text>
            <TextInput
              style={styles.input}
              value={title}
              onChangeText={setTitle}
              placeholder="What's your room about?"
              placeholderTextColor="#94a3b8"
              maxLength={80}
            />

            {/* Topic */}
            <Text style={styles.label}>Topic (optional)</Text>
            <TextInput
              style={styles.input}
              value={topic}
              onChangeText={setTopic}
              placeholder="e.g. Quran recitation, Tech talk…"
              placeholderTextColor="#94a3b8"
              maxLength={100}
            />

            {/* Description */}
            <Text style={styles.label}>Description (optional)</Text>
            <TextInput
              style={[styles.input, styles.inputMulti]}
              value={description}
              onChangeText={setDescription}
              placeholder="Describe your room…"
              placeholderTextColor="#94a3b8"
              multiline
              numberOfLines={3}
              maxLength={300}
            />

            {/* Privacy */}
            <Text style={styles.label}>Privacy</Text>
            {PRIVACY_OPTIONS.map(opt => (
              <TouchableOpacity
                key={opt.value}
                style={[styles.privacyOpt, privacy === opt.value && styles.privacyOptActive]}
                onPress={() => setPrivacy(opt.value)}
              >
                <Text style={styles.privacyIcon}>{opt.icon}</Text>
                <View style={styles.privacyInfo}>
                  <Text style={[styles.privacyLabel, privacy === opt.value && { color: '#6366f1' }]}>{opt.label}</Text>
                  <Text style={styles.privacyDesc}>{opt.desc}</Text>
                </View>
                {privacy === opt.value && (
                  <View style={styles.privacyCheck}>
                    <Text style={styles.privacyCheckText}>✓</Text>
                  </View>
                )}
              </TouchableOpacity>
            ))}

            {/* Create button */}
            <TouchableOpacity
              style={[styles.createBtn, loading && styles.createBtnDisabled]}
              onPress={handleCreate}
              disabled={loading}
            >
              {loading
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.createBtnText}>🎙️  Go Live Now</Text>
              }
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
  emojiGrid:        { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
  emojiBtn:         { width: 48, height: 48, borderRadius: 12, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: '#e2e8f0' },
  emojiBtnActive:   { borderColor: '#6366f1', backgroundColor: '#e0e7ff' },
  emojiText:        { fontSize: 24 },
  input:            { backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0', padding: 14, fontSize: 15, color: '#1e293b' },
  inputMulti:       { height: 88, textAlignVertical: 'top' },
  privacyOpt:       { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1.5, borderColor: '#e2e8f0', gap: 12 },
  privacyOptActive: { borderColor: '#6366f1', backgroundColor: '#f5f3ff' },
  privacyIcon:      { fontSize: 22 },
  privacyInfo:      { flex: 1 },
  privacyLabel:     { fontSize: 14, fontWeight: '700', color: '#1e293b' },
  privacyDesc:      { fontSize: 12, color: '#94a3b8', marginTop: 2 },
  privacyCheck:     { width: 22, height: 22, borderRadius: 11, backgroundColor: '#6366f1', alignItems: 'center', justifyContent: 'center' },
  privacyCheckText: { color: '#fff', fontWeight: '900', fontSize: 12 },
  createBtn:        { backgroundColor: '#6366f1', borderRadius: 14, padding: 16, alignItems: 'center', marginTop: 24 },
  createBtnDisabled:{ opacity: 0.7 },
  createBtnText:    { color: '#fff', fontSize: 16, fontWeight: '800' },
});




