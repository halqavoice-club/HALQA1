/**
 * HALQA Mobile — Buy Coins Screen (Stripe Checkout)
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet, SafeAreaView, TouchableOpacity, ActivityIndicator, Linking, Alert } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { showMessage } from 'react-native-flash-message';
import { useScreenProtection } from '@/hooks/useScreenProtection';
import api from '@/lib/api';

export default function BuyCoinsScreen() {
  const { packageId } = useLocalSearchParams<{ packageId: string }>();
  const router        = useRouter();
  const [loading, setLoading] = useState(false);

  // MOB-003: Prevent screenshots and screen recording on payment screens.
  useScreenProtection();

  const { data: packages = [] } = useQuery({
    queryKey: ['coin-packages'],
    queryFn:  () => api.get('/wallet/packages').then(r => r.data.data ?? []),
    staleTime: 5 * 60_000,
  });

  const pkg = (packages as any[]).find((p: any) => p.id === packageId);

  const handlePurchase = async () => {
    if (!pkg) return;

    Alert.alert(
      'Buy Coins',
      `Purchase ${(pkg.coins + pkg.bonusCoins).toLocaleString()} coins for $${Number(pkg.priceUsd).toFixed(2)}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue to Payment',
          onPress: async () => {
            setLoading(true);
            try {
              const res = await api.post('/stripe/checkout', { packageId: pkg.id });
              const { checkoutUrl } = res.data.data;
              if (checkoutUrl) {
                await Linking.openURL(checkoutUrl);
                router.back();
              }
            } catch (err: any) {
              showMessage({ message: err?.response?.data?.message || 'Payment failed', type: 'danger' });
            } finally { setLoading(false); }
          }
        }
      ]
    );
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Buy Coins', headerShown: true, headerTintColor: '#4f46e5' }} />
      <SafeAreaView style={styles.container}>
        {pkg ? (
          <View style={styles.card}>
            <Text style={styles.emoji}>🪙</Text>
            <Text style={styles.coins}>{pkg.coins.toLocaleString()} Coins</Text>
            {pkg.bonusCoins > 0 && (
              <View style={styles.bonus}><Text style={styles.bonusText}>+ {pkg.bonusCoins.toLocaleString()} BONUS</Text></View>
            )}
            <Text style={styles.total}>Total: {(pkg.coins + pkg.bonusCoins).toLocaleString()} coins</Text>
            <Text style={styles.price}>${Number(pkg.priceUsd).toFixed(2)}</Text>

            <TouchableOpacity style={[styles.buyBtn, loading && { opacity: 0.7 }]} onPress={handlePurchase} disabled={loading}>
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buyBtnText}>Pay with Stripe 🔒</Text>}
            </TouchableOpacity>

            <Text style={styles.note}>You'll be redirected to Stripe's secure checkout page.</Text>
          </View>
        ) : (
          <ActivityIndicator size="large" color="#6366f1" style={{ marginTop: 40 }} />
        )}
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc', alignItems: 'center', justifyContent: 'center' },
  card:      { backgroundColor: '#fff', borderRadius: 20, padding: 32, alignItems: 'center', width: '85%', shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 12, elevation: 4 },
  emoji:     { fontSize: 56, marginBottom: 12 },
  coins:     { fontSize: 28, fontWeight: '900', color: '#1e293b' },
  bonus:     { backgroundColor: '#d1fae5', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 4, marginTop: 8 },
  bonusText: { color: '#059669', fontWeight: '700', fontSize: 13 },
  total:     { fontSize: 14, color: '#64748b', marginTop: 8 },
  price:     { fontSize: 36, fontWeight: '900', color: '#6366f1', marginTop: 16 },
  buyBtn:    { backgroundColor: '#6366f1', borderRadius: 14, paddingHorizontal: 32, paddingVertical: 14, marginTop: 24, width: '100%', alignItems: 'center' },
  buyBtnText:{ color: '#fff', fontSize: 16, fontWeight: '800' },
  note:      { fontSize: 12, color: '#94a3b8', marginTop: 16, textAlign: 'center' },
});
