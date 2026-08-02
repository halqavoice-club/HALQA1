/**
 * HALQA Mobile — Creator Tiers Management
 */
import React, { useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, SafeAreaView, ActivityIndicator, TextInput, Alert } from 'react-native';
import { Stack } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { showMessage } from 'react-native-flash-message';
import api from '@/lib/api';

type Tier = { id: string; name: string; description?: string; priceCoins: number; isActive: boolean; subscriberCount?: number; };

export default function CreatorTiersScreen() {
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName]       = useState('');
  const [desc, setDesc]       = useState('');
  const [price, setPrice]     = useState('');
  const [saving, setSaving]   = useState(false);

  const { data: dashboard, isLoading } = useQuery({
    queryKey: ['creator-dashboard'],
    queryFn:  () => api.get('/creators/me/dashboard').then(r => r.data.data),
  });

  const tiers: Tier[] = dashboard?.profile?.tiers ?? [];

  const toggleMutation = useMutation({
    mutationFn: ({ tierId, isActive }: { tierId: string; isActive: boolean }) =>
      api.patch(`/creators/me/tiers/${tierId}`, { isActive: !isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['creator-dashboard'] }),
    onError:   (err: any) => showMessage({ message: err?.response?.data?.message || 'Failed', type: 'danger' }),
  });

  const handleAddTier = async () => {
    if (!name.trim() || !price) { showMessage({ message: 'Name and price required', type: 'warning' }); return; }
    if (parseInt(price) < 1)    { showMessage({ message: 'Price must be at least 1 coin', type: 'warning' }); return; }
    setSaving(true);
    try {
      await api.post('/creators/me/tiers', { name: name.trim(), description: desc.trim() || undefined, priceCoins: parseInt(price) });
      qc.invalidateQueries({ queryKey: ['creator-dashboard'] });
      setName(''); setDesc(''); setPrice(''); setShowAdd(false);
      showMessage({ message: 'Tier created!', type: 'success' });
    } catch (err: any) {
      showMessage({ message: err?.response?.data?.message || 'Failed', type: 'danger' });
    } finally { setSaving(false); }
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Manage Tiers', headerShown: true, headerTintColor: '#4f46e5' }} />
      <SafeAreaView style={styles.container}>
        {isLoading ? <ActivityIndicator size="large" color="#6366f1" style={{ marginTop: 40 }} /> : (
          <FlatList
            data={tiers}
            keyExtractor={t => t.id}
            contentContainerStyle={styles.list}
            ListHeaderComponent={
              <TouchableOpacity style={styles.addBtn} onPress={() => setShowAdd(v => !v)}>
                <Ionicons name={showAdd ? 'close' : 'add'} size={18} color="#6366f1" />
                <Text style={styles.addBtnText}>{showAdd ? 'Cancel' : 'Add New Tier'}</Text>
              </TouchableOpacity>
            }
            ListFooterComponent={showAdd ? (
              <View style={styles.addForm}>
                <Text style={styles.formTitle}>New Tier</Text>
                <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Tier name (e.g. Gold)" placeholderTextColor="#94a3b8" />
                <TextInput style={[styles.input, { height: 72, textAlignVertical: 'top' }]} value={desc} onChangeText={setDesc} placeholder="Description (optional)" placeholderTextColor="#94a3b8" multiline />
                <TextInput style={styles.input} value={price} onChangeText={setPrice} placeholder="Price in coins (e.g. 100)" placeholderTextColor="#94a3b8" keyboardType="number-pad" />
                <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.7 }]} onPress={handleAddTier} disabled={saving}>
                  {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.saveBtnText}>Create Tier</Text>}
                </TouchableOpacity>
              </View>
            ) : null}
            renderItem={({ item: t }) => (
              <View style={[styles.tierCard, !t.isActive && styles.tierCardInactive]}>
                <View style={styles.tierLeft}>
                  <Text style={styles.tierName}>{t.name}</Text>
                  {t.description ? <Text style={styles.tierDesc}>{t.description}</Text> : null}
                  <Text style={styles.tierPrice}>🪙 {t.priceCoins.toLocaleString()} coins/month</Text>
                </View>
                <TouchableOpacity
                  style={[styles.toggleBtn, t.isActive ? styles.toggleActive : styles.toggleInactive]}
                  onPress={() => toggleMutation.mutate({ tierId: t.id, isActive: t.isActive })}
                >
                  <Text style={[styles.toggleText, t.isActive ? { color: '#6366f1' } : { color: '#94a3b8' }]}>
                    {t.isActive ? 'Active' : 'Inactive'}
                  </Text>
                </TouchableOpacity>
              </View>
            )}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Text style={styles.emptyEmoji}>🏷️</Text>
                <Text style={styles.emptyText}>No tiers yet. Create your first subscription tier!</Text>
              </View>
            }
          />
        )}
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  container:       { flex: 1, backgroundColor: '#f8fafc' },
  list:            { padding: 16, paddingBottom: 40 },
  addBtn:          { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#e0e7ff', borderRadius: 12, padding: 14, marginBottom: 12, justifyContent: 'center' },
  addBtnText:      { color: '#6366f1', fontWeight: '700', fontSize: 15 },
  addForm:         { backgroundColor: '#fff', borderRadius: 14, padding: 16, gap: 12, marginBottom: 12, borderWidth: 1, borderColor: '#e2e8f0' },
  formTitle:       { fontSize: 16, fontWeight: '800', color: '#1e293b', marginBottom: 4 },
  input:           { backgroundColor: '#f8fafc', borderRadius: 10, borderWidth: 1, borderColor: '#e2e8f0', padding: 12, fontSize: 15, color: '#1e293b' },
  saveBtn:         { backgroundColor: '#6366f1', borderRadius: 12, padding: 14, alignItems: 'center' },
  saveBtnText:     { color: '#fff', fontWeight: '700', fontSize: 15 },
  tierCard:        { backgroundColor: '#fff', borderRadius: 14, padding: 16, marginBottom: 10, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#e2e8f0' },
  tierCardInactive:{ opacity: 0.6 },
  tierLeft:        { flex: 1 },
  tierName:        { fontSize: 16, fontWeight: '700', color: '#1e293b' },
  tierDesc:        { fontSize: 13, color: '#64748b', marginTop: 3 },
  tierPrice:       { fontSize: 13, fontWeight: '600', color: '#6366f1', marginTop: 6 },
  toggleBtn:       { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  toggleActive:    { backgroundColor: '#e0e7ff', borderColor: '#6366f1' },
  toggleInactive:  { backgroundColor: '#f1f5f9', borderColor: '#e2e8f0' },
  toggleText:      { fontWeight: '700', fontSize: 12 },
  empty:           { alignItems: 'center', padding: 40 },
  emptyEmoji:      { fontSize: 40, marginBottom: 12 },
  emptyText:       { color: '#94a3b8', fontSize: 14, textAlign: 'center' },
});
