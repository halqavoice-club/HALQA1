/**
 * HALQA Mobile — Forgot Password Flow
 *
 * Step 1: Enter email → backend sends 6-digit OTP
 * Step 2: Enter OTP + new password → backend resets password
 * Step 3: Redirect to login with success message
 */
import { useState, useRef, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { showMessage } from 'react-native-flash-message';
import api from '@/lib/api';

type Step = 'email' | 'otp' | 'done';

export default function ForgotPasswordScreen() {
  const router = useRouter();

  const [step,        setStep]        = useState<Step>('email');
  const [email,       setEmail]       = useState('');
  const [otp,         setOtp]         = useState(['', '', '', '', '', '']);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPass, setConfirmPass] = useState('');
  const [showPass,    setShowPass]    = useState(false);
  const [loading,     setLoading]     = useState(false);
  const [countdown,   setCountdown]   = useState(0);
  const inputs = useRef<(TextInput | null)[]>([]);

  useEffect(() => {
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  const otpString = otp.join('');

  // ── Step 1: Send OTP ──────────────────────────────────────────────────────
  const handleSendOtp = async () => {
    if (!email.trim()) { showMessage({ message: 'Enter your email', type: 'warning' }); return; }
    setLoading(true);
    try {
      await api.post('/auth/forgot-password', { email: email.trim() });
      setStep('otp');
      setCountdown(60);
      showMessage({ message: `Code sent to ${email.trim()}`, type: 'success', duration: 3000 });
      setTimeout(() => inputs.current[0]?.focus(), 400);
    } catch (err: any) {
      showMessage({ message: err?.response?.data?.message || 'Failed to send code', type: 'danger' });
    } finally { setLoading(false); }
  };

  // ── OTP digit input ────────────────────────────────────────────────────────
  const handleOtpChange = (value: string, index: number) => {
    const digit = value.replace(/\D/g, '').slice(-1);
    const newOtp = [...otp];
    newOtp[index] = digit;
    setOtp(newOtp);
    if (digit && index < 5) inputs.current[index + 1]?.focus();
  };

  const handleKeyPress = (e: any, index: number) => {
    if (e.nativeEvent.key === 'Backspace' && !otp[index] && index > 0) {
      inputs.current[index - 1]?.focus();
    }
  };

  // ── Resend OTP ─────────────────────────────────────────────────────────────
  const handleResend = async () => {
    if (countdown > 0) return;
    setLoading(true);
    try {
      await api.post('/auth/forgot-password', { email: email.trim() });
      setOtp(['', '', '', '', '', '']);
      setCountdown(60);
      showMessage({ message: 'New code sent', type: 'success' });
    } catch { showMessage({ message: 'Failed to resend', type: 'danger' }); }
    finally { setLoading(false); }
  };

  // ── Step 2: Reset password ─────────────────────────────────────────────────
  const handleReset = async () => {
    if (otpString.length !== 6) { showMessage({ message: 'Enter the 6-digit code', type: 'warning' }); return; }
    if (newPassword.length < 8) { showMessage({ message: 'Password must be at least 8 characters', type: 'warning' }); return; }
    if (newPassword !== confirmPass) { showMessage({ message: 'Passwords do not match', type: 'warning' }); return; }

    setLoading(true);
    try {
      await api.post('/auth/reset-password', {
        email:       email.trim(),
        otp:         otpString,
        newPassword: newPassword,
      });
      setStep('done');
    } catch (err: any) {
      showMessage({ message: err?.response?.data?.message || 'Reset failed. Check your code.', type: 'danger' });
      setOtp(['', '', '', '', '', '']);
      inputs.current[0]?.focus();
    } finally { setLoading(false); }
  };

  // ── Done ───────────────────────────────────────────────────────────────────
  if (step === 'done') {
    return (
      <View style={[styles.container, styles.center]}>
        <Text style={styles.doneEmoji}>🎉</Text>
        <Text style={styles.doneTitle}>Password Reset!</Text>
        <Text style={styles.doneSub}>Your password has been updated. Sign in with your new password.</Text>
        <TouchableOpacity style={[styles.btn, { marginTop: 28 }]} onPress={() => router.replace({
          pathname: '/(auth)/login',
          params: { email }
        } as any)}>
          <Text style={styles.btnText}>Go to Login</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={styles.container} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

        {/* Back */}
        <TouchableOpacity style={styles.back} onPress={() => step === 'otp' ? setStep('email') : router.back()}>
          <Ionicons name="arrow-back" size={22} color="#4f46e5" />
          <Text style={styles.backText}>{step === 'otp' ? 'Back' : 'Login'}</Text>
        </TouchableOpacity>

        {step === 'email' ? (
          <>
            <Text style={styles.title}>Forgot Password?</Text>
            <Text style={styles.subtitle}>Enter your email and we'll send you a 6-digit reset code.</Text>

            <Text style={styles.label}>Email Address</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="your@email.com"
              placeholderTextColor="#9ca3af"
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              returnKeyType="done"
              onSubmitEditing={handleSendOtp}
            />

            <TouchableOpacity style={[styles.btn, loading && { opacity: 0.6 }]} onPress={handleSendOtp} disabled={loading}>
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Send Reset Code</Text>}
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={styles.title}>Enter Reset Code</Text>
            <Text style={styles.subtitle}>
              We sent a 6-digit code to{'\n'}
              <Text style={{ fontWeight: '700', color: '#4f46e5' }}>{email}</Text>
            </Text>

            {/* OTP boxes */}
            <View style={styles.otpRow}>
              {otp.map((digit, i) => (
                <TextInput
                  key={i}
                  ref={ref => { inputs.current[i] = ref; }}
                  style={[styles.otpBox, digit && styles.otpBoxFilled]}
                  value={digit}
                  onChangeText={v => handleOtpChange(v, i)}
                  onKeyPress={e => handleKeyPress(e, i)}
                  keyboardType="number-pad"
                  maxLength={1}
                  selectTextOnFocus
                  textAlign="center"
                />
              ))}
            </View>

            {/* Resend */}
            <TouchableOpacity onPress={handleResend} disabled={countdown > 0} style={{ alignSelf: 'center', marginBottom: 20 }}>
              <Text style={[styles.resendText, countdown > 0 && { color: '#94a3b8' }]}>
                {countdown > 0 ? `Resend code in ${countdown}s` : 'Resend code'}
              </Text>
            </TouchableOpacity>

            {/* New password */}
            <Text style={styles.label}>New Password</Text>
            <View style={styles.passwordWrap}>
              <TextInput
                style={[styles.input, { flex: 1, borderWidth: 0, marginBottom: 0 }]}
                value={newPassword}
                onChangeText={setNewPassword}
                placeholder="At least 8 characters"
                placeholderTextColor="#9ca3af"
                secureTextEntry={!showPass}
              />
              <TouchableOpacity onPress={() => setShowPass(s => !s)} style={{ padding: 8 }}>
                <Text style={{ fontSize: 18 }}>{showPass ? '🙈' : '👁️'}</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.label}>Confirm New Password</Text>
            <TextInput
              style={styles.input}
              value={confirmPass}
              onChangeText={setConfirmPass}
              placeholder="Repeat your password"
              placeholderTextColor="#9ca3af"
              secureTextEntry={!showPass}
              returnKeyType="done"
              onSubmitEditing={handleReset}
            />

            <TouchableOpacity
              style={[styles.btn, (loading || otpString.length < 6 || !newPassword) && { opacity: 0.6 }]}
              onPress={handleReset}
              disabled={loading || otpString.length < 6 || !newPassword}
            >
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Reset Password</Text>}
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: '#f9fafb' },
  scroll:       { padding: 24, paddingTop: 52 },
  center:       { justifyContent: 'center', alignItems: 'center', padding: 32 },
  back:         { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 28 },
  backText:     { color: '#4f46e5', fontSize: 16, fontWeight: '600' },
  title:        { fontSize: 26, fontWeight: '900', color: '#111827', marginBottom: 8 },
  subtitle:     { fontSize: 15, color: '#6b7280', lineHeight: 22, marginBottom: 24 },
  label:        { fontSize: 14, fontWeight: '600', color: '#374151', marginBottom: 6, marginTop: 4 },
  input:        { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, fontSize: 16, color: '#111827', marginBottom: 14 },
  passwordWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 12, marginBottom: 14, paddingRight: 10 },
  btn:          { backgroundColor: '#4f46e5', borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  btnText:      { color: '#fff', fontSize: 16, fontWeight: '800' },
  otpRow:       { flexDirection: 'row', gap: 10, justifyContent: 'center', marginBottom: 16 },
  otpBox:       { width: 46, height: 56, borderRadius: 12, borderWidth: 2, borderColor: '#e2e8f0', backgroundColor: '#fff', fontSize: 22, fontWeight: '800', color: '#111827', textAlign: 'center' },
  otpBoxFilled: { borderColor: '#4f46e5', backgroundColor: '#f0f0ff' },
  resendText:   { color: '#4f46e5', fontWeight: '600', fontSize: 14, marginBottom: 4 },
  doneEmoji:    { fontSize: 64, marginBottom: 16 },
  doneTitle:    { fontSize: 26, fontWeight: '900', color: '#111827', marginBottom: 8 },
  doneSub:      { fontSize: 15, color: '#6b7280', textAlign: 'center', lineHeight: 22 },
});
