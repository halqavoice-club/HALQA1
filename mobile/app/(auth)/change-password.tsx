/**
 * HALQA Mobile — Force Change Password Screen
 *
 * Shown when mustChangePassword = true (admin-created accounts).
 * User cannot navigate elsewhere until they set a new password.
 * Calls PUT /auth/change-password, then clears flag and navigates to feed.
 */
import KeyboardAvoidingView from '@/components/KeyboardAvoidingView';
import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, Platform, ScrollView, Alert} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { showMessage } from 'react-native-flash-message';
import { useAuthStore } from '@/store/auth.store';
import api from '@/lib/api';

const REQUIREMENTS = [
  { label: 'At least 8 characters',  test: (p: string) => p.length >= 8 },
  { label: 'At least one uppercase', test: (p: string) => /[A-Z]/.test(p) },
  { label: 'At least one number',    test: (p: string) => /[0-9]/.test(p) },
];

export default function ChangePasswordScreen() {
  const router  = useRouter();
  const { user, logout } = useAuthStore();

  const [current,   setCurrent]   = useState('');
  const [newPwd,    setNewPwd]    = useState('');
  const [confirm,   setConfirm]   = useState('');
  const [showCur,   setShowCur]   = useState(false);
  const [showNew,   setShowNew]   = useState(false);
  const [loading,   setLoading]   = useState(false);
  const [success,   setSuccess]   = useState(false);

  const allMet       = REQUIREMENTS.every(r => r.test(newPwd));
  const passwordsMatch = newPwd === confirm && confirm.length > 0;
  const canSubmit    = allMet && passwordsMatch && current.length > 0 && !loading;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setLoading(true);
    try {
      await api.put('/auth/change-password', {
        currentPassword: current,
        newPassword:     newPwd,
      });
      useAuthStore.setState({ mustChangePassword: false });
      setSuccess(true);
      showMessage({ message: '✅ Password updated!', type: 'success', duration: 2000 });
      setTimeout(() => router.replace('/(tabs)/feed' as any), 1500);
    } catch (err: any) {
      showMessage({
        message: err?.response?.data?.message || 'Failed to change password',
        type: 'danger',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    Alert.alert('Sign Out', 'You must set a new password before using the app. Sign out anyway?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out', style: 'destructive',
        onPress: async () => {
          await logout();
          router.replace('/(auth)/login' as any);
        },
      },
    ]);
  };

  if (success) {
    return (
      <View style={[s.container, s.center]}>
        <Text style={{ fontSize: 64, marginBottom: 16 }}>🎉</Text>
        <Text style={s.successTitle}>Password Updated!</Text>
        <Text style={s.successSub}>Redirecting you to the app…</Text>
        <ActivityIndicator color="#4f46e5" style={{ marginTop: 20 }} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={s.container} contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">

        {/* Header */}
        <View style={s.header}>
          <View style={s.shieldCircle}>
            <Ionicons name="shield-checkmark" size={36} color="#f97316" />
          </View>
          <Text style={s.title}>Set Your Password</Text>
          <Text style={s.subtitle}>
            Welcome{user?.firstName ? `, ${user.firstName}` : ''}! Your account was created by an admin.
            Please set a personal password before continuing.
          </Text>
        </View>

        {/* Current password */}
        <Text style={s.label}>Temporary Password</Text>
        <View style={s.inputWrap}>
          <Ionicons name="lock-closed-outline" size={18} color="#9ca3af" style={s.inputIcon} />
          <TextInput
            style={s.inputField}
            value={current}
            onChangeText={setCurrent}
            placeholder="Enter the temporary password"
            placeholderTextColor="#9ca3af"
            secureTextEntry={!showCur}
          />
          <TouchableOpacity onPress={() => setShowCur(v => !v)} style={s.eyeBtn}>
            <Ionicons name={showCur ? 'eye-off-outline' : 'eye-outline'} size={18} color="#9ca3af" />
          </TouchableOpacity>
        </View>

        {/* New password */}
        <Text style={s.label}>New Password</Text>
        <View style={s.inputWrap}>
          <Ionicons name="lock-closed-outline" size={18} color="#9ca3af" style={s.inputIcon} />
          <TextInput
            style={s.inputField}
            value={newPwd}
            onChangeText={setNewPwd}
            placeholder="Choose a strong password"
            placeholderTextColor="#9ca3af"
            secureTextEntry={!showNew}
          />
          <TouchableOpacity onPress={() => setShowNew(v => !v)} style={s.eyeBtn}>
            <Ionicons name={showNew ? 'eye-off-outline' : 'eye-outline'} size={18} color="#9ca3af" />
          </TouchableOpacity>
        </View>

        {/* Password requirements */}
        {newPwd.length > 0 && (
          <View style={s.reqList}>
            {REQUIREMENTS.map(req => (
              <View key={req.label} style={s.reqRow}>
                <Ionicons
                  name={req.test(newPwd) ? 'checkmark-circle' : 'ellipse-outline'}
                  size={14}
                  color={req.test(newPwd) ? '#22c55e' : '#d1d5db'}
                />
                <Text style={[s.reqText, req.test(newPwd) && { color: '#16a34a' }]}>
                  {req.label}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Confirm password */}
        <Text style={s.label}>Confirm New Password</Text>
        <View style={[
          s.inputWrap,
          confirm.length > 0 && (passwordsMatch ? s.inputWrapOk : s.inputWrapErr),
        ]}>
          <Ionicons name="lock-closed-outline" size={18} color="#9ca3af" style={s.inputIcon} />
          <TextInput
            style={s.inputField}
            value={confirm}
            onChangeText={setConfirm}
            placeholder="Re-enter new password"
            placeholderTextColor="#9ca3af"
            secureTextEntry={!showNew}
            returnKeyType="done"
            onSubmitEditing={handleSubmit}
          />
        </View>
        {confirm.length > 0 && !passwordsMatch && (
          <Text style={s.errorText}>Passwords do not match</Text>
        )}

        {/* Submit */}
        <TouchableOpacity
          style={[s.btn, !canSubmit && { opacity: 0.5 }]}
          onPress={handleSubmit}
          disabled={!canSubmit}
        >
          {loading
            ? <ActivityIndicator color="#fff" />
            : (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="shield-checkmark-outline" size={18} color="#fff" />
                <Text style={s.btnText}>Set Password & Continue</Text>
              </View>
            )
          }
        </TouchableOpacity>

        {/* Sign out link */}
        <TouchableOpacity onPress={handleLogout} style={s.signOutBtn}>
          <Text style={s.signOutText}>Sign out instead</Text>
        </TouchableOpacity>

      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container:    { flex: 1, backgroundColor: '#f9fafb' },
  scroll:       { padding: 24, paddingTop: 48 },
  center:       { justifyContent: 'center', alignItems: 'center' },
  header:       { alignItems: 'center', marginBottom: 32 },
  shieldCircle: { width: 72, height: 72, borderRadius: 36, backgroundColor: '#fff7ed', justifyContent: 'center', alignItems: 'center', marginBottom: 16 },
  title:        { fontSize: 24, fontWeight: '900', color: '#111827', textAlign: 'center', marginBottom: 8 },
  subtitle:     { fontSize: 14, color: '#6b7280', textAlign: 'center', lineHeight: 20 },
  label:        { fontSize: 14, fontWeight: '600', color: '#374151', marginBottom: 6, marginTop: 16 },
  inputWrap:    { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 12 },
  inputWrapOk:  { borderColor: '#22c55e', backgroundColor: '#f0fdf4' },
  inputWrapErr: { borderColor: '#ef4444' },
  inputIcon:    { marginLeft: 14 },
  inputField:   { flex: 1, paddingHorizontal: 12, paddingVertical: 14, fontSize: 15, color: '#111827' },
  eyeBtn:       { padding: 12 },
  reqList:      { marginTop: 8, gap: 4, paddingLeft: 4 },
  reqRow:       { flexDirection: 'row', alignItems: 'center', gap: 6 },
  reqText:      { fontSize: 12, color: '#9ca3af' },
  errorText:    { fontSize: 12, color: '#ef4444', marginTop: 4, paddingLeft: 4 },
  btn:          { backgroundColor: '#4f46e5', borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 28 },
  btnText:      { color: '#fff', fontSize: 16, fontWeight: '800' },
  signOutBtn:   { alignItems: 'center', marginTop: 16, paddingVertical: 8 },
  signOutText:  { fontSize: 13, color: '#9ca3af' },
  successTitle: { fontSize: 26, fontWeight: '900', color: '#111827' },
  successSub:   { fontSize: 15, color: '#6b7280', marginTop: 8 },
});





