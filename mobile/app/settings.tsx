/**
 * HALQA Mobile — Settings Screen
 * Matches the web settings page feature-for-feature:
 *  • Profile (name, phone, bio)
 *  • Change password
 *  • Appearance (theme, language)
 *  • School settings (admin only)
 *  • Notification toggles (admin only)
 *  • Blocked users
 *  • Username (@handle)
 *  • Server URL override (developer)
 *  • Delete account
 *  • Sign out
 */
import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView,
  ScrollView, Alert, ActivityIndicator, Switch
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@/store/auth.store';
import { showMessage } from 'react-native-flash-message';
import * as SecureStore from 'expo-secure-store';
import { applyURLOverride, API_URL_OVERRIDE_KEY, BUILD_API_URL } from '@/lib/api';
import api from '@/lib/api';

type Tab = 'profile' | 'appearance' | 'school' | 'account';

const THEMES = [
  { value: 'light',  label: 'Light',  icon: '☀️' },
  { value: 'dark',   label: 'Dark',   icon: '🌙' },
  { value: 'system', label: 'System', icon: '💻' },
];

const LANGUAGES = [
  { value: 'en', label: 'English',  flag: '🇬🇧' },
  { value: 'ar', label: 'العربية',  flag: '🇸🇦' },
  { value: 'so', label: 'Somali',   flag: '🇸🇴' },
  { value: 'am', label: 'Amharic',  flag: '🇪🇹' },
  { value: 'om', label: 'Oromo',    flag: '🇪🇹' },
];

export default function SettingsScreen() {
  const router  = useRouter();
  const qc      = useQueryClient();
  const { user, updateUser, logout } = useAuthStore();

  // SA-SETTINGS-01: SUPER_ADMIN is a platform role — not a school-scoped admin.
  // The "School" settings tab is for SCHOOL_ADMIN (school membership role) only.
  // Platform admins manage schools through the admin panel (/admin/schools).
  const isAdmin = user?.role === 'SCHOOL_ADMIN';

  const [tab,          setTab]          = useState<Tab>('profile');
  const [theme,        setThemeVal]     = useState('system');
  const [language,     setLanguageVal]  = useState('en');
  const [showDevTools, setShowDevTools] = useState(false);
  const [serverUrl,    setServerUrl]    = useState('');

  // Profile form
  const [firstName, setFirstName] = useState(user?.firstName || '');
  const [lastName,  setLastName]  = useState(user?.lastName  || '');
  const [phone,     setPhone]     = useState('');
  const [bio,       setBio]       = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  // Password form
  const [currentPw,  setCurrentPw]  = useState('');
  const [newPw,      setNewPw]      = useState('');
  const [confirmPw,  setConfirmPw]  = useState('');
  const [showPw,     setShowPw]     = useState(false);
  const [savingPw,   setSavingPw]   = useState(false);

  // School settings (admin only)
  const { data: schoolData } = useQuery({
    queryKey: ['school', user?.schoolId],
    queryFn:  () => api.get(`/schools/${user?.schoolId}`).then(r => r.data.data),
    enabled:  isAdmin && !!user?.schoolId,
  });

  const [schoolForm, setSchoolForm] = useState({
    name: '', phone: '', email: '', address: '', city: '', timezone: 'America/New_York',
    schoolStartTime: '08:00', schoolEndTime: '15:00',
    allowSelfCheckIn: true, requireGpsCheckIn: false,
    parentNotifications: true, emailEnabled: true, smsEnabled: false,
    maxAbsenceAlert: 3, passingGrade: 60,
  });
  const [savingSchool, setSavingSchool] = useState(false);

  useEffect(() => {
    if (schoolData) {
      setSchoolForm(f => ({
        ...f,
        name:  schoolData.name  || '',
        phone: schoolData.phone || '',
        email: schoolData.email || '',
        address: schoolData.address || '',
        city:    schoolData.city    || '',
        timezone: schoolData.timezone || 'America/New_York',
        ...(schoolData.settings || {}),
      }));
    }
  }, [schoolData]);

  // Save profile
  const saveProfile = async () => {
    if (!firstName.trim()) { showMessage({ message: 'First name required', type: 'warning' }); return; }
    setSavingProfile(true);
    try {
      const res = await api.put('/users/profile', { firstName: firstName.trim(), lastName: lastName.trim(), phone, bio });
      updateUser(res.data.data);
      showMessage({ message: 'Profile saved', type: 'success' });
    } catch (err: any) {
      showMessage({ message: err?.response?.data?.message || 'Update failed', type: 'danger' });
    } finally { setSavingProfile(false); }
  };

  // Change password
  const changePassword = async () => {
    if (!currentPw || !newPw) { showMessage({ message: 'Fill in all password fields', type: 'warning' }); return; }
    if (newPw !== confirmPw)  { showMessage({ message: 'Passwords do not match', type: 'warning' }); return; }
    if (newPw.length < 8)     { showMessage({ message: 'Password must be at least 8 characters', type: 'warning' }); return; }
    setSavingPw(true);
    try {
      await api.put('/auth/change-password', { currentPassword: currentPw, newPassword: newPw });
      setCurrentPw(''); setNewPw(''); setConfirmPw('');
      showMessage({ message: 'Password changed. Please log in again.', type: 'success', duration: 4000 });
      setTimeout(() => logout(), 2000);
    } catch (err: any) {
      showMessage({ message: err?.response?.data?.message || 'Failed', type: 'danger' });
    } finally { setSavingPw(false); }
  };

  // Save school
  const saveSchool = async () => {
    setSavingSchool(true);
    try {
      await api.put(`/schools/${user?.schoolId}`, {
        name: schoolForm.name, phone: schoolForm.phone, email: schoolForm.email,
        address: schoolForm.address, city: schoolForm.city, timezone: schoolForm.timezone,
      });
      await api.put(`/schools/${user?.schoolId}/settings`, {
        schoolStartTime: schoolForm.schoolStartTime, schoolEndTime: schoolForm.schoolEndTime,
        allowSelfCheckIn: schoolForm.allowSelfCheckIn, requireGpsCheckIn: schoolForm.requireGpsCheckIn,
        parentNotifications: schoolForm.parentNotifications, emailEnabled: schoolForm.emailEnabled,
        smsEnabled: schoolForm.smsEnabled, maxAbsenceAlert: Number(schoolForm.maxAbsenceAlert),
        passingGrade: Number(schoolForm.passingGrade),
      });
      qc.invalidateQueries({ queryKey: ['school'] });
      showMessage({ message: 'School settings saved', type: 'success' });
    } catch (err: any) {
      showMessage({ message: err?.response?.data?.message || 'Save failed', type: 'danger' });
    } finally { setSavingSchool(false); }
  };

  // Delete account
  const handleDeleteAccount = () => {
    Alert.prompt(
      'Delete Account',
      'Enter your password to permanently delete your account. This cannot be undone.',
      async (password) => {
        if (!password) return;
        try {
          await api.delete('/users/me', { data: { password } });
          showMessage({ message: 'Account deleted', type: 'info' });
          await logout();
        } catch (err: any) {
          showMessage({ message: err?.response?.data?.message || 'Deletion failed', type: 'danger' });
        }
      },
      'secure-text'
    );
  };

  const TABS: { key: Tab; label: string; icon: string; adminOnly?: boolean }[] = [
    { key: 'profile',    label: 'Profile',    icon: 'person-outline'   },
    { key: 'appearance', label: 'Appearance', icon: 'color-palette-outline' },
    { key: 'school',     label: 'School',     icon: 'school-outline', adminOnly: true },
    { key: 'account',    label: 'Account',    icon: 'shield-outline'   },
  ];

  const visibleTabs = TABS.filter(t => !t.adminOnly || isAdmin);

  return (
    <>
      <Stack.Screen options={{ title: 'Settings', headerShown: true, headerTintColor: '#4f46e5' }} />
      <SafeAreaView style={styles.container}>
        {/* Tab bar */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabBar} contentContainerStyle={styles.tabBarContent}>
          {visibleTabs.map(t => (
            <TouchableOpacity key={t.key} style={[styles.tabBtn, tab === t.key && styles.tabBtnActive]} onPress={() => setTab(t.key)}>
              <Ionicons name={t.icon as any} size={15} color={tab === t.key ? '#6366f1' : '#94a3b8'} />
              <Text style={[styles.tabBtnText, tab === t.key && styles.tabBtnTextActive]}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

          {/* ── PROFILE TAB ──────────────────────────────────────────────── */}
          {tab === 'profile' && (
            <>
              <Text style={styles.sectionTitle}>Personal Information</Text>
              <View style={styles.card}>
                <Text style={styles.label}>First Name</Text>
                <TextInput style={styles.input} value={firstName} onChangeText={setFirstName} />
                <Text style={styles.label}>Last Name</Text>
                <TextInput style={styles.input} value={lastName} onChangeText={setLastName} />
                <Text style={styles.label}>Phone</Text>
                <TextInput style={styles.input} value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="+1 555 0100" placeholderTextColor="#94a3b8" />
                <Text style={styles.label}>Bio <Text style={styles.optional}>(optional)</Text></Text>
                <TextInput style={[styles.input, styles.inputMulti]} value={bio} onChangeText={setBio}
                  placeholder="Tell people about yourself…" placeholderTextColor="#94a3b8"
                  multiline numberOfLines={3} maxLength={200} />
                <Text style={styles.charCount}>{bio.length}/200</Text>
                <Text style={styles.emailNote}>📧 {user?.email} (cannot be changed)</Text>
                <TouchableOpacity style={[styles.btn, savingProfile && { opacity: 0.7 }]} onPress={saveProfile} disabled={savingProfile}>
                  {savingProfile ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.btnText}>Save Profile</Text>}
                </TouchableOpacity>
              </View>

              <Text style={styles.sectionTitle}>Username</Text>
              <TouchableOpacity style={styles.card} onPress={() => router.push('/set-username' as any)}>
                <View style={styles.row}>
                  <View>
                    <Text style={styles.rowLabel}>@{user?.username || 'Not set'}</Text>
                    <Text style={styles.rowSub}>Used for @mentions in posts</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color="#94a3b8" />
                </View>
              </TouchableOpacity>

              <Text style={styles.sectionTitle}>Change Password</Text>
              <View style={styles.card}>
                <Text style={styles.label}>Current Password</Text>
                <View style={styles.pwWrap}>
                  <TextInput style={[styles.input, { flex: 1, borderWidth: 0, marginBottom: 0 }]} value={currentPw} onChangeText={setCurrentPw} secureTextEntry={!showPw} placeholder="Current password" placeholderTextColor="#94a3b8" />
                  <TouchableOpacity onPress={() => setShowPw(s => !s)} style={{ padding: 6 }}>
                    <Text style={{ fontSize: 17 }}>{showPw ? '🙈' : '👁️'}</Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.label}>New Password</Text>
                <TextInput style={styles.input} value={newPw} onChangeText={setNewPw} secureTextEntry={!showPw} placeholder="8+ characters" placeholderTextColor="#94a3b8" />
                <Text style={styles.label}>Confirm New Password</Text>
                <TextInput style={styles.input} value={confirmPw} onChangeText={setConfirmPw} secureTextEntry={!showPw} placeholder="Repeat new password" placeholderTextColor="#94a3b8" />
                <TouchableOpacity style={[styles.outlineBtn, savingPw && { opacity: 0.7 }]} onPress={changePassword} disabled={savingPw}>
                  {savingPw ? <ActivityIndicator color="#6366f1" size="small" /> : <Text style={styles.outlineBtnText}>Change Password</Text>}
                </TouchableOpacity>
              </View>

              <Text style={styles.sectionTitle}>Privacy</Text>
              <TouchableOpacity style={styles.card} onPress={() => router.push('/blocked-users' as any)}>
                <View style={styles.row}>
                  <View>
                    <Text style={styles.rowLabel}>Blocked Users</Text>
                    <Text style={styles.rowSub}>Manage users you've blocked</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color="#94a3b8" />
                </View>
              </TouchableOpacity>
            </>
          )}

          {/* ── APPEARANCE TAB ────────────────────────────────────────────── */}
          {tab === 'appearance' && (
            <>
              <Text style={styles.sectionTitle}>Theme</Text>
              <View style={styles.card}>
                <View style={styles.themeGrid}>
                  {THEMES.map(t => (
                    <TouchableOpacity
                      key={t.value}
                      style={[styles.themeOpt, theme === t.value && styles.themeOptActive]}
                      onPress={() => setThemeVal(t.value)}
                    >
                      <Text style={styles.themeIcon}>{t.icon}</Text>
                      <Text style={[styles.themeLabel, theme === t.value && { color: '#6366f1', fontWeight: '700' }]}>{t.label}</Text>
                      {theme === t.value && <View style={styles.themeCheck} />}
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <Text style={styles.sectionTitle}>Language</Text>
              <View style={styles.card}>
                {LANGUAGES.map(l => (
                  <TouchableOpacity
                    key={l.value}
                    style={[styles.langRow, language === l.value && styles.langRowActive]}
                    onPress={() => setLanguageVal(l.value)}
                  >
                    <Text style={styles.langFlag}>{l.flag}</Text>
                    <Text style={[styles.langLabel, language === l.value && { color: '#6366f1', fontWeight: '700' }]}>{l.label}</Text>
                    {language === l.value && <Ionicons name="checkmark" size={18} color="#6366f1" />}
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}

          {/* ── SCHOOL TAB (admin only) ───────────────────────────────────── */}
          {tab === 'school' && isAdmin && (
            <>
              <Text style={styles.sectionTitle}>School Information</Text>
              <View style={styles.card}>
                {[
                  { label: 'School Name', key: 'name', placeholder: 'School name' },
                  { label: 'Phone', key: 'phone', placeholder: '+1 555 0100' },
                  { label: 'Email', key: 'email', placeholder: 'school@email.com' },
                  { label: 'Address', key: 'address', placeholder: '123 Main St' },
                  { label: 'City', key: 'city', placeholder: 'City' },
                  { label: 'Timezone', key: 'timezone', placeholder: 'America/New_York' },
                ].map(f => (
                  <View key={f.key}>
                    <Text style={styles.label}>{f.label}</Text>
                    <TextInput
                      style={styles.input}
                      value={(schoolForm as any)[f.key] || ''}
                      onChangeText={v => setSchoolForm(s => ({ ...s, [f.key]: v }))}
                      placeholder={f.placeholder}
                      placeholderTextColor="#94a3b8"
                    />
                  </View>
                ))}

                <View style={styles.twoCol}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.label}>Start Time</Text>
                    <TextInput style={styles.input} value={schoolForm.schoolStartTime}
                      onChangeText={v => setSchoolForm(s => ({ ...s, schoolStartTime: v }))} placeholder="08:00" placeholderTextColor="#94a3b8" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.label}>End Time</Text>
                    <TextInput style={styles.input} value={schoolForm.schoolEndTime}
                      onChangeText={v => setSchoolForm(s => ({ ...s, schoolEndTime: v }))} placeholder="15:00" placeholderTextColor="#94a3b8" />
                  </View>
                </View>

                <View style={styles.twoCol}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.label}>Passing Grade (%)</Text>
                    <TextInput style={styles.input} value={String(schoolForm.passingGrade)}
                      onChangeText={v => setSchoolForm(s => ({ ...s, passingGrade: parseInt(v) || 60 }))}
                      keyboardType="number-pad" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.label}>Max Absence Alert</Text>
                    <TextInput style={styles.input} value={String(schoolForm.maxAbsenceAlert)}
                      onChangeText={v => setSchoolForm(s => ({ ...s, maxAbsenceAlert: parseInt(v) || 3 }))}
                      keyboardType="number-pad" />
                  </View>
                </View>
              </View>

              <Text style={styles.sectionTitle}>Notification Settings</Text>
              <View style={styles.card}>
                {[
                  { key: 'parentNotifications', label: 'Parent Notifications', desc: 'Send alerts to parents' },
                  { key: 'emailEnabled',         label: 'Email Notifications',  desc: 'Send via email' },
                  { key: 'smsEnabled',           label: 'SMS Notifications',    desc: 'Requires SMS provider' },
                  { key: 'allowSelfCheckIn',     label: 'QR Self Check-in',     desc: 'Students use QR code' },
                  { key: 'requireGpsCheckIn',    label: 'Require GPS',          desc: 'Verify location on check-in' },
                ].map(item => (
                  <View key={item.key} style={styles.toggleRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.toggleLabel}>{item.label}</Text>
                      <Text style={styles.toggleDesc}>{item.desc}</Text>
                    </View>
                    <Switch
                      value={(schoolForm as any)[item.key] ?? false}
                      onValueChange={v => setSchoolForm(s => ({ ...s, [item.key]: v }))}
                      trackColor={{ true: '#6366f1', false: '#e2e8f0' }}
                      thumbColor="#fff"
                    />
                  </View>
                ))}
              </View>

              <TouchableOpacity style={[styles.btn, savingSchool && { opacity: 0.7 }]} onPress={saveSchool} disabled={savingSchool}>
                {savingSchool ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.btnText}>Save School Settings</Text>}
              </TouchableOpacity>
            </>
          )}

          {/* ── ACCOUNT TAB ───────────────────────────────────────────────── */}
          {tab === 'account' && (
            <>
              <Text style={styles.sectionTitle}>Security</Text>
              <TouchableOpacity style={styles.card} onPress={() => router.push('/security-settings' as any)}>
                <View style={styles.row}>
                  <View style={[styles.rowIcon, { backgroundColor: '#eef2ff' }]}>
                    <Ionicons name="shield-checkmark-outline" size={18} color="#4f46e5" />
                  </View>
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={styles.rowLabel}>Security Settings</Text>
                    <Text style={styles.rowSub}>Password, 2FA, active sessions</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color="#94a3b8" />
                </View>
              </TouchableOpacity>

              <Text style={styles.sectionTitle}>School</Text>
              <View style={styles.card}>
                <TouchableOpacity style={[styles.row, { borderBottomWidth: 1, borderBottomColor: '#f1f5f9', paddingBottom: 12 }]}
                  onPress={() => router.push('/schools/join' as any)}>
                  <View style={[styles.rowIcon, { backgroundColor: '#eff6ff' }]}>
                    <Ionicons name="enter-outline" size={18} color="#2563eb" />
                  </View>
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={styles.rowLabel}>Join a School</Text>
                    <Text style={styles.rowSub}>Search and request membership</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color="#94a3b8" />
                </TouchableOpacity>
                <TouchableOpacity style={[styles.row, { paddingTop: 12 }]}
                  onPress={() => router.push('/schools/create' as any)}>
                  <View style={[styles.rowIcon, { backgroundColor: '#f0fdf4' }]}>
                    <Ionicons name="add-circle-outline" size={18} color="#16a34a" />
                  </View>
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={styles.rowLabel}>Create a School</Text>
                    <Text style={styles.rowSub}>Set up your own school</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color="#94a3b8" />
                </TouchableOpacity>
              </View>

              <Text style={styles.sectionTitle}>Developer Tools</Text>
              <TouchableOpacity style={styles.card} onPress={() => setShowDevTools(v => !v)}>
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>🔧 Server URL Override</Text>
                  <Text style={{ color: '#94a3b8', fontSize: 13 }}>{showDevTools ? '▲' : '▼'}</Text>
                </View>
              </TouchableOpacity>
              {showDevTools && (
                <View style={[styles.card, { marginTop: 8 }]}>
                  <Text style={styles.hint}>Override the backend URL (for dev testing).</Text>
                  <Text style={styles.label}>Server URL</Text>
                  <TextInput style={styles.input} value={serverUrl} onChangeText={setServerUrl}
                    placeholder={BUILD_API_URL.replace('/api/v1', '')} placeholderTextColor="#94a3b8"
                    autoCapitalize="none" keyboardType="url" />
                  <View style={styles.btnRow}>
                    <TouchableOpacity style={[styles.btn, { flex: 1 }]} onPress={async () => {
                      const url = serverUrl.trim().replace(/\/$/, '');
                      if (!url) return;
                      applyURLOverride(url);
                      await SecureStore.setItemAsync(API_URL_OVERRIDE_KEY, url);
                      showMessage({ message: `Server set to ${url}`, type: 'success' });
                    }}>
                      <Text style={styles.btnText}>Apply</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.outlineBtn, { flex: 1 }]} onPress={async () => {
                      applyURLOverride(BUILD_API_URL);
                      await SecureStore.deleteItemAsync(API_URL_OVERRIDE_KEY);
                      setServerUrl('');
                      showMessage({ message: 'URL reset to default', type: 'info' });
                    }}>
                      <Text style={styles.outlineBtnText}>Reset</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              <Text style={styles.sectionTitle}>Session</Text>
              <TouchableOpacity style={styles.card} onPress={() => Alert.alert('Sign Out', 'Are you sure?', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Sign Out', style: 'destructive', onPress: logout }
              ])}>
                <View style={styles.row}>
                  <Ionicons name="log-out-outline" size={20} color="#ef4444" />
                  <Text style={[styles.rowLabel, { color: '#ef4444', marginLeft: 8 }]}>Sign Out</Text>
                </View>
              </TouchableOpacity>

              <Text style={[styles.sectionTitle, { color: '#ef4444' }]}>Danger Zone</Text>
              <View style={styles.card}>
                <TouchableOpacity style={styles.dangerBtn} onPress={handleDeleteAccount}>
                  <Ionicons name="trash-outline" size={16} color="#ef4444" />
                  <Text style={styles.dangerBtnText}>Delete My Account</Text>
                </TouchableOpacity>
                <Text style={styles.dangerNote}>Permanently deletes your account and all data. Cannot be undone.</Text>
              </View>
            </>
          )}

        </ScrollView>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  container:       { flex: 1, backgroundColor: '#f8fafc' },
  tabBar:          { flexGrow: 0, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e2e8f0' },
  tabBarContent:   { paddingHorizontal: 12, gap: 4, paddingVertical: 8 },
  tabBtn:          { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: '#f1f5f9' },
  tabBtnActive:    { backgroundColor: '#e0e7ff' },
  tabBtnText:      { fontSize: 13, fontWeight: '600', color: '#94a3b8' },
  tabBtnTextActive:{ color: '#6366f1' },
  scroll:          { padding: 16, paddingBottom: 40 },
  sectionTitle:    { fontSize: 12, fontWeight: '700', color: '#475569', marginBottom: 8, marginTop: 16, textTransform: 'uppercase', letterSpacing: 0.5 },
  card:            { backgroundColor: '#fff', borderRadius: 14, padding: 16, borderWidth: 1, borderColor: '#e2e8f0', marginBottom: 4 },
  label:           { fontSize: 12, fontWeight: '600', color: '#64748b', marginBottom: 5, marginTop: 10 },
  optional:        { color: '#94a3b8', fontWeight: '400' },
  input:           { backgroundColor: '#f8fafc', borderRadius: 10, borderWidth: 1, borderColor: '#e2e8f0', padding: 12, fontSize: 15, color: '#1e293b', marginBottom: 2 },
  inputMulti:      { height: 80, textAlignVertical: 'top' },
  charCount:       { fontSize: 11, color: '#94a3b8', textAlign: 'right', marginBottom: 6 },
  emailNote:       { fontSize: 12, color: '#94a3b8', marginBottom: 12 },
  hint:            { fontSize: 13, color: '#94a3b8', marginBottom: 10 },
  pwWrap:          { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f8fafc', borderRadius: 10, borderWidth: 1, borderColor: '#e2e8f0', marginBottom: 2 },
  btn:             { backgroundColor: '#6366f1', borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 14 },
  btnText:         { color: '#fff', fontWeight: '700', fontSize: 15 },
  outlineBtn:      { borderWidth: 1.5, borderColor: '#6366f1', borderRadius: 12, padding: 13, alignItems: 'center', marginTop: 10 },
  outlineBtnText:  { color: '#6366f1', fontWeight: '700', fontSize: 14 },
  btnRow:          { flexDirection: 'row', gap: 10, marginTop: 12 },
  row:             { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowIcon:         { width: 32, height: 32, borderRadius: 8, justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  rowLabel:        { fontSize: 15, fontWeight: '600', color: '#1e293b' },
  rowSub:          { fontSize: 12, color: '#94a3b8', marginTop: 2 },
  themeGrid:       { flexDirection: 'row', gap: 10 },
  themeOpt:        { flex: 1, alignItems: 'center', padding: 14, borderRadius: 12, backgroundColor: '#f8fafc', borderWidth: 1.5, borderColor: '#e2e8f0', gap: 6 },
  themeOptActive:  { borderColor: '#6366f1', backgroundColor: '#e0e7ff' },
  themeIcon:       { fontSize: 24 },
  themeLabel:      { fontSize: 13, fontWeight: '600', color: '#475569' },
  themeCheck:      { width: 8, height: 8, borderRadius: 4, backgroundColor: '#6366f1' },
  langRow:         { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f1f5f9', gap: 12 },
  langRowActive:   { backgroundColor: '#f5f3ff', marginHorizontal: -16, paddingHorizontal: 16 },
  langFlag:        { fontSize: 22 },
  langLabel:       { flex: 1, fontSize: 15, color: '#1e293b' },
  twoCol:          { flexDirection: 'row', gap: 10 },
  toggleRow:       { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f1f5f9', gap: 12 },
  toggleLabel:     { fontSize: 14, fontWeight: '600', color: '#1e293b' },
  toggleDesc:      { fontSize: 12, color: '#94a3b8', marginTop: 1 },
  dangerBtn:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#fef2f2', borderRadius: 10, padding: 13, borderWidth: 1, borderColor: '#fecaca' },
  dangerBtnText:   { color: '#ef4444', fontWeight: '700', fontSize: 14 },
  dangerNote:      { fontSize: 12, color: '#94a3b8', marginTop: 10, lineHeight: 18 },
});
