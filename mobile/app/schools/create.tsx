/**
 * HALQA Mobile — Create School Screen
 * Route: /schools/create
 *
 * Creates a new school. The creator automatically becomes School Admin.
 * Endpoint: POST /school-memberships/create-school
 */
import KeyboardAvoidingView from '@/components/KeyboardAvoidingView';
import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, ScrollView, Platform} from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { showMessage } from 'react-native-flash-message';
import api from '@/lib/api';

const SCHOOL_TYPES = [
  { value: 'school',  label: 'School'      },
  { value: 'academy', label: 'Academy'     },
  { value: 'college', label: 'College'     },
  { value: 'daycare', label: 'Daycare'     },
  { value: 'camp',    label: 'Camp'        },
  { value: 'sports',  label: 'Sports Club' },
];

const TIMEZONES = [
  { value: 'America/New_York',    label: 'Eastern (UTC-5/-4)' },
  { value: 'America/Chicago',     label: 'Central (UTC-6/-5)' },
  { value: 'America/Los_Angeles', label: 'Pacific (UTC-8/-7)' },
  { value: 'Europe/London',       label: 'London (UTC+0/+1)' },
  { value: 'Asia/Riyadh',         label: 'Riyadh (UTC+3)' },
  { value: 'Asia/Dubai',          label: 'Dubai (UTC+4)' },
  { value: 'Asia/Karachi',        label: 'Karachi (UTC+5)' },
  { value: 'Asia/Dhaka',          label: 'Dhaka (UTC+6)' },
  { value: 'Asia/Kuala_Lumpur',   label: 'Kuala Lumpur (UTC+8)' },
  { value: 'Asia/Jakarta',        label: 'Jakarta (UTC+7)' },
  { value: 'Asia/Tokyo',          label: 'Tokyo (UTC+9)' },
];

export default function CreateSchoolScreen() {
  const router = useRouter();

  const [name,        setName]        = useState('');
  const [slug,        setSlug]        = useState('');
  const [type,        setType]        = useState('school');
  const [description, setDescription] = useState('');
  const [city,        setCity]        = useState('');
  const [country,     setCountry]     = useState('US');
  const [email,       setEmail]       = useState('');
  const [phone,       setPhone]       = useState('');
  const [timezone,    setTimezone]    = useState('Asia/Kuala_Lumpur');
  const [loading,     setLoading]     = useState(false);
  const [success,     setSuccess]     = useState(false);
  const [createdName, setCreatedName] = useState('');
  const [showTypes,   setShowTypes]   = useState(false);
  const [showTZs,     setShowTZs]     = useState(false);

  const handleNameChange = (val: string) => {
    setName(val);
    setSlug(val.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''));
  };

  const handleCreate = async () => {
    if (!name.trim()) { showMessage({ message: 'School name is required', type: 'warning' }); return; }
    if (!slug.trim()) { showMessage({ message: 'URL slug is required', type: 'warning' }); return; }

    setLoading(true);
    try {
      await api.post('/school-memberships/create-school', {
        name:     name.trim(),
        slug:     slug.trim(),
        type,
        description: description.trim() || undefined,
        city:        city.trim()    || undefined,
        country:     country.trim() || 'US',
        email:       email.trim()   || undefined,
        phone:       phone.trim()   || undefined,
        timezone,
      });
      setCreatedName(name.trim());
      setSuccess(true);
      showMessage({ message: `${name} created!`, type: 'success' });
      setTimeout(() => router.back(), 2000);
    } catch (err: any) {
      showMessage({ message: err?.response?.data?.message ?? 'Failed to create school', type: 'danger' });
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <SafeAreaView style={[s.container, s.center]}>
        <Text style={{ fontSize: 64, marginBottom: 16 }}>🏫</Text>
        <Text style={s.successTitle}>School Created!</Text>
        <Text style={s.successSub}>
          <Text style={{ fontWeight: '700', color: '#4f46e5' }}>{createdName}</Text>
          {'\n'}is ready. You are now the School Admin.
        </Text>
      </SafeAreaView>
    );
  }

  const selectedType = SCHOOL_TYPES.find(t => t.value === type)?.label ?? 'School';
  const selectedTZ   = TIMEZONES.find(t => t.value === timezone)?.label ?? timezone;

  return (
    <SafeAreaView style={s.container} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Create a School', headerBackTitle: 'Back' }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">

          {/* Info */}
          <View style={s.infoBanner}>
            <Ionicons name="information-circle-outline" size={18} color="#4f46e5" />
            <Text style={s.infoText}>
              You'll become the School Admin and can invite teachers, students, and guardians.
            </Text>
          </View>

          {/* Name */}
          <Text style={s.label}>School Name <Text style={s.req}>*</Text></Text>
          <TextInput
            style={s.input}
            value={name}
            onChangeText={handleNameChange}
            placeholder="Halqa Academy"
            placeholderTextColor="#9ca3af"
            maxLength={100}
          />

          {/* Slug */}
          <Text style={s.label}>URL Slug <Text style={s.req}>*</Text></Text>
          <View style={s.slugRow}>
            <Text style={s.slugPrefix}>halqa.app/</Text>
            <TextInput
              style={[s.input, { flex: 1, marginBottom: 0 }]}
              value={slug}
              onChangeText={v => setSlug(v.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
              placeholder="halqa-academy"
              placeholderTextColor="#9ca3af"
              autoCapitalize="none"
              maxLength={60}
            />
          </View>
          <Text style={s.hint}>Lowercase letters, numbers, hyphens only</Text>

          {/* Type */}
          <Text style={s.label}>School Type</Text>
          <TouchableOpacity style={s.picker} onPress={() => setShowTypes(v => !v)}>
            <Text style={s.pickerText}>{selectedType}</Text>
            <Ionicons name={showTypes ? 'chevron-up' : 'chevron-down'} size={16} color="#6b7280" />
          </TouchableOpacity>
          {showTypes && (
            <View style={s.pickerList}>
              {SCHOOL_TYPES.map(t => (
                <TouchableOpacity key={t.value} style={[s.pickerItem, type === t.value && s.pickerItemActive]}
                  onPress={() => { setType(t.value); setShowTypes(false); }}>
                  <Text style={[s.pickerItemText, type === t.value && { color: '#4f46e5', fontWeight: '700' }]}>{t.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Description */}
          <Text style={s.label}>About / Description <Text style={s.opt}>(optional)</Text></Text>
          <TextInput
            style={[s.input, { height: 80, textAlignVertical: 'top' }]}
            value={description}
            onChangeText={setDescription}
            placeholder="Tell parents and students about your school…"
            placeholderTextColor="#9ca3af"
            multiline
            maxLength={500}
          />

          {/* City / Country */}
          <View style={s.row}>
            <View style={{ flex: 1 }}>
              <Text style={s.label}>City <Text style={s.opt}>(optional)</Text></Text>
              <TextInput style={s.input} value={city} onChangeText={setCity}
                placeholder="Kuala Lumpur" placeholderTextColor="#9ca3af" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.label}>Country</Text>
              <TextInput style={s.input} value={country} onChangeText={setCountry}
                placeholder="MY" placeholderTextColor="#9ca3af" autoCapitalize="characters" maxLength={2} />
            </View>
          </View>

          {/* Email / Phone */}
          <Text style={s.label}>School Email <Text style={s.opt}>(optional)</Text></Text>
          <TextInput style={s.input} value={email} onChangeText={setEmail}
            placeholder="info@school.edu" placeholderTextColor="#9ca3af"
            keyboardType="email-address" autoCapitalize="none" />

          <Text style={s.label}>Phone <Text style={s.opt}>(optional)</Text></Text>
          <TextInput style={s.input} value={phone} onChangeText={setPhone}
            placeholder="+60 12 345 6789" placeholderTextColor="#9ca3af" keyboardType="phone-pad" />

          {/* Timezone */}
          <Text style={s.label}>Timezone</Text>
          <TouchableOpacity style={s.picker} onPress={() => setShowTZs(v => !v)}>
            <Text style={s.pickerText}>{selectedTZ}</Text>
            <Ionicons name={showTZs ? 'chevron-up' : 'chevron-down'} size={16} color="#6b7280" />
          </TouchableOpacity>
          {showTZs && (
            <View style={s.pickerList}>
              {TIMEZONES.map(t => (
                <TouchableOpacity key={t.value} style={[s.pickerItem, timezone === t.value && s.pickerItemActive]}
                  onPress={() => { setTimezone(t.value); setShowTZs(false); }}>
                  <Text style={[s.pickerItemText, timezone === t.value && { color: '#4f46e5', fontWeight: '700' }]}>{t.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Submit */}
          <TouchableOpacity
            style={[s.btn, (!name.trim() || !slug.trim() || loading) && { opacity: 0.5 }]}
            onPress={handleCreate}
            disabled={!name.trim() || !slug.trim() || loading}
          >
            {loading
              ? <ActivityIndicator color="#fff" />
              : (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Ionicons name="school-outline" size={18} color="#fff" />
                  <Text style={s.btnText}>Create School</Text>
                </View>
              )
            }
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container:       { flex: 1, backgroundColor: '#f8fafc' },
  center:          { justifyContent: 'center', alignItems: 'center', padding: 32 },
  scroll:          { padding: 16 },
  infoBanner:      { flexDirection: 'row', gap: 8, backgroundColor: '#eef2ff', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#c7d2fe', alignItems: 'flex-start', marginBottom: 16 },
  infoText:        { flex: 1, fontSize: 13, color: '#4338ca', lineHeight: 18 },
  label:           { fontSize: 13, fontWeight: '600', color: '#374151', marginTop: 14, marginBottom: 6 },
  req:             { color: '#ef4444' },
  opt:             { color: '#9ca3af', fontWeight: '400' },
  input:           { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: '#111827', marginBottom: 4 },
  slugRow:         { flexDirection: 'row', alignItems: 'center', gap: 6 },
  slugPrefix:      { fontSize: 14, color: '#9ca3af' },
  hint:            { fontSize: 11, color: '#9ca3af', marginBottom: 4 },
  row:             { flexDirection: 'row', gap: 10 },
  picker:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#fff', borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, marginBottom: 4 },
  pickerText:      { fontSize: 15, color: '#111827' },
  pickerList:      { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 12, marginBottom: 4, overflow: 'hidden' },
  pickerItem:      { paddingHorizontal: 14, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  pickerItemActive:{ backgroundColor: '#eef2ff' },
  pickerItemText:  { fontSize: 14, color: '#374151' },
  btn:             { backgroundColor: '#4f46e5', borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 24, marginBottom: 32 },
  btnText:         { color: '#fff', fontSize: 16, fontWeight: '800' },
  successTitle:    { fontSize: 26, fontWeight: '900', color: '#111827', textAlign: 'center' },
  successSub:      { fontSize: 15, color: '#6b7280', textAlign: 'center', lineHeight: 22, marginTop: 8 },
});





