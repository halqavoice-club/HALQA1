/**
 * HALQA Mobile — Payout Request Screen
 * Creators request to withdraw their diamond earnings.
 */
import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  SafeAreaView, ScrollView, ActivityIndicator, KeyboardAvoidingView, Platform
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { showMessage } from 'react-native-flash-message';
import { useScreenProtection } from '@/src/hooks/useScreenProtection';
import api from '@/lib/api';

const METHODS = [
  { value: 'bank_transfer', label: 'Bank Transfer',  icon: '🏦' },
  { value: 'paypal',        label: 'PayPal',          icon: '💳' },
];

export default function PayoutRequestScreen() {
  const router = useRouter();

  // MOB-003: Prevent screenshots on payout screen (shows account numbers, balances).
  useScreenProtection();

  const { data: info, isLoading } = useQuery({
    queryKey: ['payout-info'],
    queryFn:  () => api.get('/creators/me/payout-info').then(r => r.data.data),
  });

  const [diamonds,       setDiamonds]       = useState('');
  const [method,         setMethod]         = useState('bank_transfer');
  const [accountHolder,  setAccountHolder]  = useState('');
  const [accountNumber,  setAccountNumber]  = useState('');
  const [bankName,       setBankName]       = useState('');
  const [loading,        setLoading]        = useState(false);

  const diamondNum = parseInt(diamonds) || 0;
  const usd = info ? (diamondNum / (info.conversionRate?.split(' ')[0] || 100)).toFixed(2) : '0.00';
  const net = info ? (parseFloat(usd) * 0.9).toFixed(2) : '0.00';

  const handleSubmit = async () => {
    if (!diamondNum || diamondNum < (info?.minPayout || 1000)) {
      showMessage({ message: `Minimum ${info?.minPayout || 1000} diamonds required`, type: 'warning' });
      return;
    }
    if (!accountHolder.trim()) {
      showMessage({ message: 'Account holder name is required', type: 'warning' });
      return;
    }
    setLoading(true);
    try {
      await api.post('/creators/me/payout-request', {
        diamonds:       diamondNum,
        paymentMethod:  method,
        paymentDetails: {
          accountHolder: accountHolder.trim(),
          accountNumber: accountNumber.trim() || undefined,
          bankName:      bankName.trim()      || undefined,
        }
      });
      showMessage({ message: 'Payout request submitted! Processing takes 3–5 business days.', type: 'success' });
      router.back();
    } catch (err: any) {
      showMessage({ message: err?.response?.data?.message || 'Request failed', type: 'danger' });
    } finally { setLoading(false); }
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Request Payout', headerShown: true, headerTintColor: '#4f46e5' }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <SafeAreaView style={styles.container}>
          <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

            {/* Balance summary */}
            {!isLoading && info && (
              <View style={styles.balanceCard}>
                <Text style={styles.balLabel}>Available Balance</Text>
                <Text style={styles.balValue}>💎 {(info.diamonds || 0).toLocaleString()} diamonds</Text>
                <Text style={styles.balRate}>{info.conversionRate} · {info.platformFeeRate} fee</Text>
                <Text style={styles.balMin}>Minimum: {info.minPayout?.toLocaleString()} diamonds (${info.minPayoutUsd?.toFixed(2)})</Text>
              </View>
            )}

            <Text style={styles.label}>Diamonds to Withdraw *</Text>
            <TextInput style={styles.input} value={diamonds} onChangeText={setDiamonds}
              keyboardType="number-pad" placeholder={`Min ${info?.minPayout || 1000}`}
              placeholderTextColor="#94a3b8" maxLength={8} />

            {diamondNum > 0 && (
              <View style={styles.calcCard}>
                <Text style={styles.calcRow}>Gross amount:  <Text style={styles.calcVal}>${usd}</Text></Text>
                <Text style={styles.calcRow}>Platform fee (10%): <Text style={styles.calcVal}>−${(parseFloat(usd) * 0.1).toFixed(2)}</Text></Text>
                <Text style={[styles.calcRow, { fontWeight: '800' }]}>You receive: <Text style={[styles.calcVal, { color: '#10b981' }]}>${net}</Text></Text>
              </View>
            )}

            <Text style={styles.label}>Payment Method</Text>
            {METHODS.map(m => (
              <TouchableOpacity key={m.value}
                style={[styles.methodOpt, method === m.value && styles.methodOptActive]}
                onPress={() => setMethod(m.value)}>
                <Text style={styles.methodIcon}>{m.icon}</Text>
                <Text style={[styles.methodLabel, method === m.value && { color: '#6366f1' }]}>{m.label}</Text>
                {method === m.value && <View style={styles.check}><Text style={styles.checkText}>✓</Text></View>}
              </TouchableOpacity>
            ))}

            <Text style={styles.label}>Account Holder Name *</Text>
            <TextInput style={styles.input} value={accountHolder} onChangeText={setAccountHolder}
              placeholder="Full legal name" placeholderTextColor="#94a3b8" />

            <Text style={styles.label}>Account Number / PayPal Email</Text>
            <TextInput style={styles.input} value={accountNumber} onChangeText={setAccountNumber}
              placeholder="Bank account number or PayPal email" placeholderTextColor="#94a3b8"
              autoCapitalize="none" />

            <Text style={styles.label}>Bank Name (if applicable)</Text>
            <TextInput style={styles.input} value={bankName} onChangeText={setBankName}
              placeholder="Your bank name" placeholderTextColor="#94a3b8" />

            <TouchableOpacity style={[styles.submitBtn, loading && { opacity: 0.7 }]}
              onPress={handleSubmit} disabled={loading}>
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitBtnText}>Submit Payout Request</Text>}
            </TouchableOpacity>

            <Text style={styles.note}>Processing takes 3–5 business days after approval.</Text>
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  container:      { flex: 1, backgroundColor: '#f8fafc' },
  scroll:         { padding: 16, paddingBottom: 40 },
  balanceCard:    { backgroundColor: '#6366f1', borderRadius: 16, padding: 20, marginBottom: 4 },
  balLabel:       { color: '#c7d2fe', fontSize: 13, fontWeight: '600', marginBottom: 6 },
  balValue:       { color: '#fff', fontSize: 24, fontWeight: '900' },
  balRate:        { color: '#c7d2fe', fontSize: 12, marginTop: 4 },
  balMin:         { color: '#a5b4fc', fontSize: 12, marginTop: 2 },
  label:          { fontSize: 13, fontWeight: '700', color: '#475569', marginBottom: 8, marginTop: 16, textTransform: 'uppercase', letterSpacing: 0.5 },
  input:          { backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0', padding: 14, fontSize: 15, color: '#1e293b' },
  calcCard:       { backgroundColor: '#f1f5f9', borderRadius: 12, padding: 14, marginTop: 8, gap: 4 },
  calcRow:        { fontSize: 14, color: '#475569' },
  calcVal:        { fontWeight: '700', color: '#1e293b' },
  methodOpt:      { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1.5, borderColor: '#e2e8f0', gap: 12 },
  methodOptActive:{ borderColor: '#6366f1', backgroundColor: '#f5f3ff' },
  methodIcon:     { fontSize: 22 },
  methodLabel:    { flex: 1, fontSize: 15, fontWeight: '600', color: '#1e293b' },
  check:          { width: 22, height: 22, borderRadius: 11, backgroundColor: '#6366f1', alignItems: 'center', justifyContent: 'center' },
  checkText:      { color: '#fff', fontWeight: '900', fontSize: 12 },
  submitBtn:      { backgroundColor: '#6366f1', borderRadius: 14, padding: 16, alignItems: 'center', marginTop: 24 },
  submitBtnText:  { color: '#fff', fontSize: 16, fontWeight: '800' },
  note:           { textAlign: 'center', color: '#94a3b8', fontSize: 12, marginTop: 12 },
});
