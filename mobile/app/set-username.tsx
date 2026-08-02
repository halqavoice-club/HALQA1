/**
 * HALQA Mobile — Set Username Screen
 */
import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, ActivityIndicator } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useAuthStore } from '@/store/auth.store';
import { showMessage } from 'react-native-flash-message';
import api from '@/lib/api';

export default function SetUsernameScreen() {
  const router  = useRouter();
  const { user, updateUser } = useAuthStore();
  const [username, setUsername] = useState(user?.username || '');
  const [saving, setSaving]     = useState(false);
  const [error,  setError]      = useState('');

  const validate = (val: string) => {
    if (!val) return 'Username is required';
    if (val.length < 3)  return 'Minimum 3 characters';
    if (val.length > 30) return 'Maximum 30 characters';
    if (!/^[a-z0-9_]+$/.test(val)) return 'Only lowercase letters, numbers, and underscores';
    return '';
  };

  const handleChange = (val: string) => {
    const cleaned = val.toLowerCase().replace(/[^a-z0-9_]/g, '');
    setUsername(cleaned);
    setError(validate(cleaned));
  };

  const handleSave = async () => {
    const err = validate(username);
    if (err) { setError(err); return; }
    setSaving(true);
    try {
      const res = await api.put('/users/username', { username });
      updateUser({ ...user!, username: res.data.data.username });
      showMessage({ message: `@${username} is yours!`, type: 'success' });
      router.back();
    } catch (e: any) {
      const msg = e?.response?.data?.message || 'Failed to set username';
      setError(msg);
      showMessage({ message: msg, type: 'danger' });
    } finally { setSaving(false); }
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Set Username', headerShown: true, headerTintColor: '#4f46e5' }} />
      <SafeAreaView style={styles.container}>
        <View style={styles.content}>
          <Text style={styles.title}>Choose your @handle</Text>
          <Text style={styles.subtitle}>
            Your username lets others mention you in posts and comments.{'\n'}
            3–30 characters · letters, numbers, underscores only.
          </Text>

          <View style={styles.inputRow}>
            <Text style={styles.at}>@</Text>
            <TextInput
              style={[styles.input, error ? styles.inputError : null]}
              value={username}
              onChangeText={handleChange}
              placeholder="your_username"
              placeholderTextColor="#94a3b8"
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={30}
              autoFocus
            />
          </View>

          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          {username && !error ? (
            <Text style={styles.preview}>Your handle: @{username}</Text>
          ) : null}

          <TouchableOpacity
            style={[styles.btn, (!!error || !username || saving) && styles.btnDisabled]}
            onPress={handleSave}
            disabled={!!error || !username || saving}
          >
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Save Username</Text>}
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  container:  { flex: 1, backgroundColor: '#f8fafc' },
  content:    { flex: 1, padding: 24 },
  title:      { fontSize: 24, fontWeight: '800', color: '#1e293b', marginBottom: 8 },
  subtitle:   { fontSize: 14, color: '#64748b', lineHeight: 20, marginBottom: 28 },
  inputRow:   { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 14, borderWidth: 1.5, borderColor: '#e2e8f0', paddingLeft: 14, overflow: 'hidden' },
  at:         { fontSize: 18, fontWeight: '700', color: '#6366f1', marginRight: 2 },
  input:      { flex: 1, fontSize: 18, color: '#1e293b', padding: 14 },
  inputError: { borderColor: '#ef4444' },
  errorText:  { color: '#ef4444', fontSize: 13, marginTop: 8 },
  preview:    { color: '#6366f1', fontSize: 14, fontWeight: '600', marginTop: 8 },
  btn:        { backgroundColor: '#6366f1', borderRadius: 14, padding: 16, alignItems: 'center', marginTop: 24 },
  btnDisabled:{ opacity: 0.5 },
  btnText:    { color: '#fff', fontSize: 16, fontWeight: '800' },
});
