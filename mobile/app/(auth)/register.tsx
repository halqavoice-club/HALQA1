/**
 * HALQA Mobile — Register Screen
 */
import KeyboardAvoidingView from '@/components/KeyboardAvoidingView';
import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  Platform, ScrollView, ActivityIndicator} from 'react-native';
import { useRouter, Link } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { showMessage } from 'react-native-flash-message';
import { useAuthStore } from '@/store/auth.store';
import api from '@/lib/api';

export default function RegisterScreen() {
  const router = useRouter();
  const { login } = useAuthStore();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleRegister = async () => {
    if (!firstName.trim() || !lastName.trim() || !email.trim() || !password) {
      showMessage({ message: 'Please fill in all fields', type: 'warning' });
      return;
    }
    if (password !== confirmPassword) {
      showMessage({ message: 'Passwords do not match', type: 'warning' });
      return;
    }
    if (password.length < 8) {
      showMessage({ message: 'Password must be at least 8 characters', type: 'warning' });
      return;
    }

    setLoading(true);
    try {
      await api.post('/auth/register', { firstName, lastName, email, password });
      // After registration, account is PENDING — must verify email via OTP
      // Navigate to OTP verification screen
      router.push({ pathname: '/(auth)/verify-email', params: { email: email.trim() } } as any);
      showMessage({ message: `Verification code sent to ${email.trim()}`, type: 'success', duration: 4000 });
    } catch (err: any) {
      const msg = err?.response?.data?.message ?? 'Registration failed. Please try again.';
      showMessage({ message: msg, type: 'danger' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* Logo */}
        <View style={styles.logoWrap}>
          <View style={styles.logo}>
            <Text style={styles.logoText}>H</Text>
          </View>
          <Text style={styles.appName}>HALQA</Text>
          <Text style={styles.tagline}>Join the community</Text>
        </View>

        {/* Form */}
        <View style={styles.form}>
          <View style={styles.nameRow}>
            <View style={[styles.inputWrap, { flex: 1 }]}>
              <Ionicons name="person-outline" size={18} color="#9ca3af" style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="First name"
                value={firstName}
                onChangeText={setFirstName}
                autoCapitalize="words"
                returnKeyType="next"
              />
            </View>
            <View style={[styles.inputWrap, { flex: 1 }]}>
              <TextInput
                style={[styles.input, { paddingLeft: 12 }]}
                placeholder="Last name"
                value={lastName}
                onChangeText={setLastName}
                autoCapitalize="words"
                returnKeyType="next"
              />
            </View>
          </View>

          <View style={styles.inputWrap}>
            <Ionicons name="mail-outline" size={18} color="#9ca3af" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Email address"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              returnKeyType="next"
            />
          </View>

          <View style={styles.inputWrap}>
            <Ionicons name="lock-closed-outline" size={18} color="#9ca3af" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Password (8+ characters)"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPass}
              returnKeyType="next"
            />
            <TouchableOpacity onPress={() => setShowPass(s => !s)} style={styles.eyeBtn}>
              <Ionicons name={showPass ? 'eye-off-outline' : 'eye-outline'} size={18} color="#9ca3af" />
            </TouchableOpacity>
          </View>

          <View style={styles.inputWrap}>
            <Ionicons name="lock-closed-outline" size={18} color="#9ca3af" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Confirm password"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry={!showPass}
              returnKeyType="done"
              onSubmitEditing={handleRegister}
            />
          </View>

          <TouchableOpacity
            style={[styles.submitBtn, loading && { opacity: 0.7 }]}
            onPress={handleRegister}
            disabled={loading}
          >
            {loading
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.submitBtnText}>Create Account</Text>
            }
          </TouchableOpacity>
        </View>

        {/* Login link */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>Already have an account? </Text>
          <Link href="/(auth)/login" asChild>
            <TouchableOpacity>
              <Text style={styles.loginLink}>Sign In</Text>
            </TouchableOpacity>
          </Link>
        </View>

        <Text style={styles.terms}>
          By creating an account you agree to our Terms of Service and Privacy Policy.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 24, paddingTop: 48 },
  logoWrap: { alignItems: 'center', marginBottom: 32 },
  logo: { width: 64, height: 64, borderRadius: 16, backgroundColor: '#4f46e5', alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  logoText: { color: '#fff', fontSize: 28, fontWeight: '900' },
  appName: { fontSize: 26, fontWeight: '900', color: '#111827', letterSpacing: 1 },
  tagline: { color: '#9ca3af', fontSize: 14, marginTop: 4 },
  form: { gap: 12, marginBottom: 24 },
  nameRow: { flexDirection: 'row', gap: 10 },
  inputWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f9fafb', borderRadius: 12, borderWidth: 1.5, borderColor: '#e5e7eb', paddingHorizontal: 14, height: 52 },
  inputIcon: { marginRight: 8 },
  input: { flex: 1, fontSize: 15, color: '#111827' },
  eyeBtn: { padding: 4 },
  submitBtn: { backgroundColor: '#4f46e5', height: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  submitBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  footer: { flexDirection: 'row', justifyContent: 'center', marginBottom: 16 },
  footerText: { color: '#6b7280', fontSize: 14 },
  loginLink: { color: '#4f46e5', fontWeight: '700', fontSize: 14 },
  terms: { textAlign: 'center', color: '#9ca3af', fontSize: 12, lineHeight: 18 },
});





