import { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Modal,
  KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { showMessage } from 'react-native-flash-message';
import * as SecureStore from 'expo-secure-store';
import { useAuthStore } from '@/store/auth.store';
import { initSocket } from '@/lib/socket';
import { getAccessToken, getBaseURL, applyURLOverride, API_URL_OVERRIDE_KEY } from '@/lib/api';

export default function LoginScreen() {
  const router = useRouter();
  const { login } = useAuthStore();
  const params = useLocalSearchParams<{ verified?: string; email?: string }>();

  const [email,        setEmail]        = useState(params.email || '');
  const [password,     setPassword]     = useState('');
  const [loading,      setLoading]      = useState(false);
  const [showPass,     setShowPass]     = useState(false);
  const [showUrlModal, setShowUrlModal] = useState(false);
  const [urlInput,     setUrlInput]     = useState('');

  // Show success banner when coming from email verification
  useEffect(() => {
    if (params.verified === '1') {
      showMessage({
        message: '✅ Email verified!',
        description: 'Your account is active. Please sign in.',
        type: 'success',
        duration: 4000,
      });
    }
  }, [params.verified]);

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) {
      showMessage({ message: 'Please enter email and password', type: 'warning' });
      return;
    }
    setLoading(true);
    try {
      await login(email.trim(), password);
      const token = getAccessToken();
      if (token) initSocket(token);
      router.replace('/(tabs)/feed');
    } catch (err: any) {
      let msg = 'Login failed. Check your credentials.';
      if (err?.response?.data?.message) {
        msg = err.response.data.message;
        // Guide unverified users to the OTP screen
        if (msg.toLowerCase().includes('verify your email') || msg.toLowerCase().includes('pending')) {
          showMessage({
            message: 'Email not verified',
            description: 'Check your inbox for the verification code.',
            type: 'warning',
            duration: 6000,
          });
          router.push({ pathname: '/(auth)/verify-email', params: { email: email.trim() } } as any);
          setLoading(false);
          return;
        }
      } else if (err?.code === 'ECONNABORTED') {
        msg = `Timeout. Server: ${getBaseURL().replace('/api/v1', '')}`;
      } else if (err?.code === 'ERR_NETWORK' || err?.message?.includes('Network Error')) {
        const serverUrl = getBaseURL().replace('/api/v1', '');
        msg = `Cannot reach server.\nURL: ${serverUrl}\n\nMake sure:\n1. Backend is running\n2. Phone & PC on same WiFi`;
      } else if (err?.message) {
        msg = err.message;
      }
      showMessage({ message: msg, type: 'danger', duration: 8000 });
    } finally {
      setLoading(false);
    }
  };

  const handleChangeUrl = async () => {
    setUrlInput(getBaseURL().replace('/api/v1', ''));
    setShowUrlModal(true);
  };

  const handleSaveUrl = async () => {
    const url = urlInput.trim().replace(/\/$/, '');
    if (!url) return;
    try {
      await SecureStore.setItemAsync(API_URL_OVERRIDE_KEY, url);
      applyURLOverride(url);
      setShowUrlModal(false);
      showMessage({ message: `Server: ${url}`, type: 'success', duration: 4000 });
    } catch (e) {
      showMessage({ message: 'Failed to save URL', type: 'danger' });
    }
  };

  return (
    <>
      {/* URL Change Modal — works on both iOS and Android */}
      <Modal visible={showUrlModal} transparent animationType="fade" onRequestClose={() => setShowUrlModal(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowUrlModal(false)}>
          <TouchableOpacity style={styles.modalBox} activeOpacity={1}>
            <Text allowFontScaling={false} style={styles.modalTitle}>Change Server URL</Text>
            <Text allowFontScaling={false} style={styles.modalHint}>Enter your PC's IP (e.g. http://192.168.x.x:5000)</Text>
            <TextInput
              style={styles.modalInput}
              value={urlInput}
              onChangeText={setUrlInput}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              placeholder="http://192.168.x.x:5000"
              placeholderTextColor="#9ca3af"
              selectTextOnFocus
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setShowUrlModal(false)}>
                <Text allowFontScaling={false} style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalSave} onPress={handleSaveUrl}>
                <Text allowFontScaling={false} style={styles.modalSaveText}>Save</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {/* Logo */}
          <View style={styles.logoArea}>
            <View style={styles.logoCircle}>
              <Text allowFontScaling={false} style={styles.logoText}>H</Text>
            </View>
            <Text allowFontScaling={false} style={styles.appName}>HALQA</Text>
            <Text allowFontScaling={false} style={styles.tagline}>Social Platform v1.0.11</Text>
            <TouchableOpacity onLongPress={handleChangeUrl} delayLongPress={1500}>
              <Text allowFontScaling={false} style={styles.serverInfo}>
                Server: {getBaseURL().replace('/api/v1', '')}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Form */}
          <View style={styles.form}>
            <Text allowFontScaling={false} style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="your@email.com"
              placeholderTextColor="#9ca3af"
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
            />

            <Text allowFontScaling={false} style={styles.label}>Password</Text>
            <View style={styles.passwordWrap}>
              <TextInput
                style={[styles.input, { marginBottom: 0, flex: 1, borderWidth: 0 }]}
                value={password}
                onChangeText={setPassword}
                placeholder="••••••••"
                placeholderTextColor="#9ca3af"
                secureTextEntry={!showPass}
                autoComplete="password"
                returnKeyType="done"
                onSubmitEditing={handleLogin}
              />
              <TouchableOpacity onPress={() => setShowPass(s => !s)} style={styles.eyeBtn}>
                <Text style={{ fontSize: 18 }}>{showPass ? '🙈' : '👁️'}</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={[styles.btn, loading && styles.btnDisabled]}
              onPress={handleLogin}
              disabled={loading}
            >
              {loading
                ? <ActivityIndicator color="#fff" />
                : <Text allowFontScaling={false} style={styles.btnText}>Sign In</Text>
              }
            </TouchableOpacity>

            <TouchableOpacity onPress={() => router.push('/(auth)/forgot-password')}>
              <Text allowFontScaling={false} style={styles.link}>Forgot password?</Text>
            </TouchableOpacity>

            <View style={styles.registerRow}>
              <Text allowFontScaling={false} style={styles.registerText}>Don't have an account? </Text>
              <TouchableOpacity onPress={() => router.push('/(auth)/register')}>
                <Text allowFontScaling={false} style={styles.registerLink}>Sign Up</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: '#f9fafb' },
  scroll:       { flexGrow: 1, justifyContent: 'center', padding: 24 },
  logoArea:     { alignItems: 'center', marginBottom: 40 },
  logoCircle:   { width: 72, height: 72, borderRadius: 36, backgroundColor: '#4f46e5', justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
  logoText:     { color: '#fff', fontSize: 32, fontWeight: '900' },
  appName:      { fontSize: 28, fontWeight: '900', color: '#111827' },
  tagline:      { fontSize: 14, color: '#6b7280', marginTop: 4 },
  serverInfo:   { fontSize: 10, color: '#9ca3af', marginTop: 6, textAlign: 'center' },
  form:         { gap: 12 },
  label:        { fontSize: 14, fontWeight: '600', color: '#374151', marginBottom: 4 },
  input: {
    backgroundColor: '#fff', borderWidth: 1, borderColor: '#e5e7eb',
    borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14,
    fontSize: 16, color: '#111827', marginBottom: 4,
  },
  passwordWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff', borderWidth: 1, borderColor: '#e5e7eb',
    borderRadius: 12, marginBottom: 4, paddingRight: 12,
  },
  eyeBtn: { padding: 6 },
  btn:          { backgroundColor: '#4f46e5', borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  btnDisabled:  { opacity: 0.6 },
  btnText:      { color: '#fff', fontSize: 16, fontWeight: '700' },
  link:         { textAlign: 'center', color: '#4f46e5', fontSize: 14, marginTop: 16 },
  registerRow:  { flexDirection: 'row', justifyContent: 'center', marginTop: 20 },
  registerText: { color: '#6b7280', fontSize: 14 },
  registerLink: { color: '#4f46e5', fontWeight: '700', fontSize: 14 },
  // Modal styles
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  modalBox:     { backgroundColor: '#fff', borderRadius: 16, padding: 24, width: '100%', maxWidth: 380 },
  modalTitle:   { fontSize: 18, fontWeight: '700', color: '#111827', marginBottom: 6 },
  modalHint:    { fontSize: 13, color: '#6b7280', marginBottom: 16 },
  modalInput:   { borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: '#111827', marginBottom: 16, backgroundColor: '#f9fafb' },
  modalButtons: { flexDirection: 'row', gap: 12, justifyContent: 'flex-end' },
  modalCancel:  { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: '#e5e7eb' },
  modalCancelText: { color: '#6b7280', fontWeight: '600' },
  modalSave:    { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, backgroundColor: '#4f46e5' },
  modalSaveText:{ color: '#fff', fontWeight: '700' },
});
