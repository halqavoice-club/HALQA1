/**
 * HALQA Mobile — Security Settings Screen
 * Route: /security-settings
 *
 * Covers:
 *  - 2FA / TOTP setup and disable
 *  - Active sessions (view & revoke)
 *  - Change password
 *
 * Linked from Settings screen.
 */
import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Modal, ActivityIndicator, Alert, Switch
} from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { showMessage } from 'react-native-flash-message';
import { format } from 'date-fns';
import api from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';

// ─── Change Password Modal ────────────────────────────────────────────────────
function ChangePasswordModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [current,  setCurrent]  = useState('');
  const [newPwd,   setNewPwd]   = useState('');
  const [confirm,  setConfirm]  = useState('');
  const [showPw,   setShowPw]   = useState(false);
  const [loading,  setLoading]  = useState(false);

  const allMet = newPwd.length >= 8 && /[A-Z]/.test(newPwd) && /[0-9]/.test(newPwd);
  const match  = newPwd === confirm && confirm.length > 0;

  const handleSubmit = async () => {
    if (!allMet) { showMessage({ message: 'Password does not meet requirements', type: 'warning' }); return; }
    if (!match)  { showMessage({ message: 'Passwords do not match', type: 'warning' }); return; }
    setLoading(true);
    try {
      await api.put('/auth/change-password', { currentPassword: current, newPassword: newPwd });
      showMessage({ message: '✅ Password changed', type: 'success' });
      setCurrent(''); setNewPwd(''); setConfirm('');
      onClose();
    } catch (err: any) {
      showMessage({ message: err?.response?.data?.message ?? 'Failed to change password', type: 'danger' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
        <View style={m.header}>
          <Text style={m.title}>Change Password</Text>
          <TouchableOpacity onPress={onClose}><Ionicons name="close" size={24} color="#374151" /></TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={m.body} keyboardShouldPersistTaps="handled">
          <Text style={m.label}>Current Password</Text>
          <View style={m.inputWrap}>
            <TextInput style={m.input} value={current} onChangeText={setCurrent}
              secureTextEntry={!showPw} placeholder="Current password" placeholderTextColor="#9ca3af" />
            <TouchableOpacity onPress={() => setShowPw(v => !v)} style={m.eyeBtn}>
              <Ionicons name={showPw ? 'eye-off-outline' : 'eye-outline'} size={18} color="#9ca3af" />
            </TouchableOpacity>
          </View>

          <Text style={m.label}>New Password</Text>
          <View style={m.inputWrap}>
            <TextInput style={m.input} value={newPwd} onChangeText={setNewPwd}
              secureTextEntry={!showPw} placeholder="Min 8 chars, 1 uppercase, 1 number" placeholderTextColor="#9ca3af" />
          </View>
          {newPwd.length > 0 && (
            <View style={m.reqList}>
              {[
                { label: 'At least 8 characters',  ok: newPwd.length >= 8 },
                { label: 'One uppercase letter',    ok: /[A-Z]/.test(newPwd) },
                { label: 'One number',              ok: /[0-9]/.test(newPwd) },
              ].map(r => (
                <View key={r.label} style={m.reqRow}>
                  <Ionicons name={r.ok ? 'checkmark-circle' : 'ellipse-outline'} size={14} color={r.ok ? '#22c55e' : '#d1d5db'} />
                  <Text style={[m.reqText, r.ok && { color: '#16a34a' }]}>{r.label}</Text>
                </View>
              ))}
            </View>
          )}

          <Text style={m.label}>Confirm New Password</Text>
          <View style={[m.inputWrap, confirm.length > 0 && (match ? m.inputOk : m.inputErr)]}>
            <TextInput style={m.input} value={confirm} onChangeText={setConfirm}
              secureTextEntry={!showPw} placeholder="Repeat new password" placeholderTextColor="#9ca3af" />
          </View>

          <TouchableOpacity
            style={[m.btn, (!current || !allMet || !match || loading) && m.btnDisabled]}
            onPress={handleSubmit}
            disabled={!current || !allMet || !match || loading}
          >
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={m.btnText}>Change Password</Text>}
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

// ─── 2FA Setup Modal ──────────────────────────────────────────────────────────
function TOTPSetupModal({ visible, onClose, onDone }: {
  visible: boolean; onClose: () => void; onDone: () => void;
}) {
  const [step,    setStep]    = useState<'init' | 'verify'>('init');
  const [qrUri,   setQrUri]   = useState('');
  const [secret,  setSecret]  = useState('');
  const [code,    setCode]    = useState('');
  const [loading, setLoading] = useState(false);

  const handleInit = async () => {
    setLoading(true);
    try {
      const res = await api.post('/auth/2fa/setup');
      setQrUri(res.data.data?.qrCodeUrl ?? '');
      setSecret(res.data.data?.secret ?? '');
      setStep('verify');
    } catch (err: any) {
      showMessage({ message: err?.response?.data?.message ?? 'Failed to setup 2FA', type: 'danger' });
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async () => {
    if (code.length !== 6) { showMessage({ message: 'Enter the 6-digit code', type: 'warning' }); return; }
    setLoading(true);
    try {
      await api.post('/auth/2fa/enable', { code });
      showMessage({ message: '🔒 2FA enabled!', type: 'success' });
      onDone();
    } catch (err: any) {
      showMessage({ message: err?.response?.data?.message ?? 'Invalid code', type: 'danger' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
        <View style={m.header}>
          <Text style={m.title}>Enable 2FA</Text>
          <TouchableOpacity onPress={onClose}><Ionicons name="close" size={24} color="#374151" /></TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={[m.body, { alignItems: 'center' }]}>
          {step === 'init' ? (
            <>
              <View style={s.shieldWrap}>
                <Ionicons name="shield-checkmark" size={48} color="#4f46e5" />
              </View>
              <Text style={s.setupTitle}>Two-Factor Authentication</Text>
              <Text style={s.setupDesc}>
                Add an extra layer of security. You'll need an authenticator app like{' '}
                <Text style={{ fontWeight: '700' }}>Google Authenticator</Text> or{' '}
                <Text style={{ fontWeight: '700' }}>Authy</Text>.
              </Text>
              <TouchableOpacity style={[m.btn, { width: '100%', marginTop: 24 }]} onPress={handleInit} disabled={loading}>
                {loading ? <ActivityIndicator color="#fff" /> : <Text style={m.btnText}>Get Started</Text>}
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={s.setupDesc}>
                Open your authenticator app and scan this QR code or enter the secret manually.
              </Text>

              {/* QR code display — show the secret as fallback since expo doesn't have qr scanner here */}
              <View style={s.secretBox}>
                <Text style={s.secretLabel}>Manual entry secret:</Text>
                <Text style={s.secretValue} selectable>{secret}</Text>
              </View>

              <Text style={[m.label, { alignSelf: 'flex-start', width: '100%', marginTop: 20 }]}>
                Enter the 6-digit code from your app
              </Text>
              <TextInput
                style={[m.inputWrap, { width: '100%', justifyContent: 'center' }]}
                value={code}
                onChangeText={t => setCode(t.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                placeholderTextColor="#9ca3af"
                keyboardType="number-pad"
                maxLength={6}
                textAlign="center"
              />
              <TouchableOpacity
                style={[m.btn, { width: '100%', marginTop: 16 }, (code.length < 6 || loading) && m.btnDisabled]}
                onPress={handleVerify}
                disabled={code.length < 6 || loading}
              >
                {loading ? <ActivityIndicator color="#fff" /> : <Text style={m.btnText}>Enable 2FA</Text>}
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function SecuritySettingsScreen() {
  const router  = useRouter();
  const { user } = useAuthStore();
  const qc      = useQueryClient();

  const [showChangePw, setShowChangePw] = useState(false);
  const [show2FASetup, setShow2FASetup] = useState(false);

  // Fetch security status (2FA enabled, sessions)
  const { data: security, refetch: refetchSecurity } = useQuery({
    queryKey: ['security-status'],
    queryFn: () => api.get('/auth/security').then(r => r.data.data),
    staleTime: 30_000,
  });

  const { data: sessions, refetch: refetchSessions } = useQuery({
    queryKey: ['active-sessions'],
    queryFn: () => api.get('/auth/sessions').then(r => r.data.data ?? []),
    staleTime: 30_000,
  });

  const disable2FA = useMutation({
    mutationFn: (code: string) => api.post('/auth/2fa/disable', { code }),
    onSuccess: () => {
      showMessage({ message: '2FA disabled', type: 'success' });
      refetchSecurity();
    },
    onError: (err: any) => showMessage({ message: err?.response?.data?.message ?? 'Failed', type: 'danger' }),
  });

  const revokeSession = useMutation({
    mutationFn: (sessionId: string) => api.delete(`/auth/sessions/${sessionId}`),
    onSuccess: () => { showMessage({ message: 'Session revoked', type: 'success' }); refetchSessions(); },
    onError: () => showMessage({ message: 'Failed to revoke session', type: 'danger' }),
  });

  const handle2FAToggle = () => {
    if (security?.twoFactorEnabled) {
      Alert.prompt(
        'Disable 2FA',
        'Enter your current 6-digit code to disable two-factor authentication',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Disable', style: 'destructive', onPress: (code: string | undefined) => {
            if (code) disable2FA.mutate(code);
          }},
        ],
        'plain-text'
      );
    } else {
      setShow2FASetup(true);
    }
  };

  const twoFAEnabled = security?.twoFactorEnabled ?? false;

  return (
    <SafeAreaView style={s.container} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Security', headerBackTitle: 'Settings' }} />
      <ScrollView contentContainerStyle={s.scroll}>

        {/* Password */}
        <Text style={s.sectionTitle}>Password</Text>
        <View style={s.card}>
          <TouchableOpacity style={s.row} onPress={() => setShowChangePw(true)}>
            <View style={[s.rowIcon, { backgroundColor: '#eef2ff' }]}>
              <Ionicons name="lock-closed-outline" size={20} color="#4f46e5" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.rowLabel}>Change Password</Text>
              <Text style={s.rowSub}>Update your login password</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#d1d5db" />
          </TouchableOpacity>
        </View>

        {/* Two-Factor Authentication */}
        <Text style={s.sectionTitle}>Two-Factor Authentication</Text>
        <View style={s.card}>
          <View style={s.row}>
            <View style={[s.rowIcon, { backgroundColor: twoFAEnabled ? '#dcfce7' : '#f3f4f6' }]}>
              <Ionicons name="shield-checkmark-outline" size={20} color={twoFAEnabled ? '#16a34a' : '#6b7280'} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.rowLabel}>Authenticator App</Text>
              <Text style={[s.rowSub, twoFAEnabled && { color: '#16a34a' }]}>
                {twoFAEnabled ? 'Enabled — extra secure' : 'Disabled'}
              </Text>
            </View>
            <Switch
              value={twoFAEnabled}
              onValueChange={handle2FAToggle}
              trackColor={{ false: '#e5e7eb', true: '#4ade80' }}
              thumbColor={twoFAEnabled ? '#16a34a' : '#fff'}
            />
          </View>
        </View>

        {twoFAEnabled && (
          <View style={s.infoBanner}>
            <Ionicons name="checkmark-circle" size={16} color="#16a34a" />
            <Text style={s.infoText}>
              Your account is protected with two-factor authentication. You'll be asked for a code on new logins.
            </Text>
          </View>
        )}

        {/* Active Sessions */}
        <Text style={s.sectionTitle}>Active Sessions</Text>
        <View style={s.card}>
          {(sessions ?? []).length === 0 ? (
            <View style={s.emptyRow}>
              <Text style={s.emptyText}>No other active sessions</Text>
            </View>
          ) : (
            (sessions ?? []).map((session: any) => (
              <View key={session.id} style={s.row}>
                <View style={[s.rowIcon, { backgroundColor: '#f3f4f6' }]}>
                  <Ionicons name={session.deviceType === 'mobile' ? 'phone-portrait-outline' : 'desktop-outline'} size={20} color="#6b7280" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.rowLabel} numberOfLines={1}>{session.device ?? 'Unknown device'}</Text>
                  <Text style={s.rowSub}>{session.ip ?? 'Unknown IP'} · {session.lastActive ? format(new Date(session.lastActive), 'MMM d') : ''}</Text>
                </View>
                <TouchableOpacity
                  style={s.revokeBtn}
                  onPress={() => Alert.alert('Revoke Session?', 'This device will be logged out.', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Revoke', style: 'destructive', onPress: () => revokeSession.mutate(session.id) },
                  ])}
                >
                  <Text style={s.revokeBtnText}>Revoke</Text>
                </TouchableOpacity>
              </View>
            ))
          )}
        </View>

      </ScrollView>

      <ChangePasswordModal visible={showChangePw} onClose={() => setShowChangePw(false)} />
      <TOTPSetupModal visible={show2FASetup} onClose={() => setShow2FASetup(false)} onDone={() => { setShow2FASetup(false); refetchSecurity(); }} />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container:    { flex: 1, backgroundColor: '#f8fafc' },
  scroll:       { padding: 16 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8, marginTop: 16, paddingLeft: 4 },
  card:         { backgroundColor: '#fff', borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: '#e5e7eb' },
  row:          { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  rowIcon:      { width: 36, height: 36, borderRadius: 10, justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  rowLabel:     { fontSize: 14, fontWeight: '600', color: '#111827' },
  rowSub:       { fontSize: 12, color: '#9ca3af', marginTop: 1 },
  infoBanner:   { flexDirection: 'row', gap: 8, backgroundColor: '#dcfce7', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#bbf7d0', marginTop: 8, alignItems: 'flex-start' },
  infoText:     { flex: 1, fontSize: 13, color: '#166534', lineHeight: 18 },
  emptyRow:     { padding: 16, alignItems: 'center' },
  emptyText:    { fontSize: 14, color: '#9ca3af' },
  revokeBtn:    { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: '#fee2e2' },
  revokeBtnText:{ fontSize: 12, fontWeight: '700', color: '#dc2626' },
  shieldWrap:   { width: 80, height: 80, borderRadius: 40, backgroundColor: '#eef2ff', justifyContent: 'center', alignItems: 'center', marginBottom: 16 },
  setupTitle:   { fontSize: 20, fontWeight: '800', color: '#111827', textAlign: 'center', marginBottom: 8 },
  setupDesc:    { fontSize: 14, color: '#6b7280', textAlign: 'center', lineHeight: 20, paddingHorizontal: 8 },
  secretBox:    { backgroundColor: '#1e1040', borderRadius: 12, padding: 16, width: '100%', marginTop: 16 },
  secretLabel:  { fontSize: 11, color: '#a5b4fc', fontWeight: '600', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  secretValue:  { fontSize: 14, color: '#e0e7ff', fontFamily: 'monospace', letterSpacing: 2, lineHeight: 22, textAlign: 'center' },
});

const m = StyleSheet.create({
  header:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  title:      { fontSize: 17, fontWeight: '700', color: '#111827' },
  body:       { padding: 20, gap: 8 },
  label:      { fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 6, marginTop: 12 },
  inputWrap:  { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f9fafb', borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 12, paddingHorizontal: 14 },
  inputOk:    { borderColor: '#22c55e' },
  inputErr:   { borderColor: '#ef4444' },
  input:      { flex: 1, paddingVertical: 12, fontSize: 15, color: '#111827' },
  eyeBtn:     { padding: 8 },
  reqList:    { gap: 4, paddingLeft: 4, marginTop: 6 },
  reqRow:     { flexDirection: 'row', alignItems: 'center', gap: 6 },
  reqText:    { fontSize: 12, color: '#9ca3af' },
  btn:        { backgroundColor: '#4f46e5', borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 12 },
  btnDisabled:{ opacity: 0.5 },
  btnText:    { color: '#fff', fontSize: 15, fontWeight: '800' },
});

