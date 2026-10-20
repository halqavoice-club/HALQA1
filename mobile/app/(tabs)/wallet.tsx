/**
 * HALQA Mobile — Wallet Screen
 * Balance card (coins + diamonds + totals), buy-coins packages,
 * transaction history tab, real-time coin credit via socket.
 */
import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, FlatList
} from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { showMessage } from 'react-native-flash-message';
import { formatDistanceToNow } from 'date-fns';
import api from '@/lib/api';
import { getSocket } from '@/lib/socket';
import { useAuthStore } from '@/store/auth.store';

type Tab = 'buy' | 'history';

function fmt(n: number) { return n.toLocaleString(); }

function timeAgo(iso: string) {
  try { return formatDistanceToNow(new Date(iso), { addSuffix: true }); }
  catch { return ''; }
}

// ─── Package Card ─────────────────────────────────────────────────────────────
function PackageCard({ pkg, onBuy, loading }: { pkg: any; onBuy: () => void; loading: boolean }) {
  const total = (pkg.coins ?? 0) + (pkg.bonusCoins ?? 0);
  return (
    <TouchableOpacity style={w.pkgCard} onPress={onBuy} disabled={loading} activeOpacity={0.85}>
      <View style={w.pkgIconWrap}><Text style={w.pkgEmoji}>🪙</Text></View>
      <Text style={w.pkgCoins}>{fmt(pkg.coins)}</Text>
      <Text style={w.pkgName} numberOfLines={1}>{pkg.name}</Text>
      {pkg.bonusCoins > 0 && (
        <View style={w.bonusBadge}>
          <Text style={w.bonusTxt}>+{fmt(pkg.bonusCoins)} bonus</Text>
        </View>
      )}
      <TouchableOpacity style={[w.buyBtn, loading && w.buyBtnDisabled]} onPress={onBuy} disabled={loading}>
        {loading ? <ActivityIndicator size="small" color="#fff" /> : <Text style={w.buyBtnTxt}>${Number(pkg.priceUsd).toFixed(2)}</Text>}
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

// ─── Tx Row — handles ALL WalletTransaction types ────────────────────────────
const TX_META: Record<string, { icon: string; label: string; bg: string }> = {
  STRIPE_PURCHASE:      { icon: '💳', label: 'Coin Purchase',       bg: '#eff6ff' },
  GIFT_SEND:            { icon: '🎁', label: 'Gift Sent',           bg: '#fef2f2' },
  GIFT_RECEIVE:         { icon: '🎁', label: 'Gift Received',       bg: '#f0fdf4' },
  TIP_SEND:             { icon: '💸', label: 'Tip Sent',            bg: '#fef2f2' },
  TIP_RECEIVE:          { icon: '💰', label: 'Tip Received',        bg: '#f0fdf4' },
  SUBSCRIPTION:         { icon: '⭐', label: 'Subscription',        bg: '#faf5ff' },
  SUBSCRIPTION_RECEIVE: { icon: '⭐', label: 'Subscription Income', bg: '#f0fdf4' },
  ADMIN_GRANT:          { icon: '🛡️', label: 'Admin Grant',         bg: '#eef2ff' },
  REFUND:               { icon: '↩️', label: 'Refund',              bg: '#fefce8' },
  PAYOUT:               { icon: '💎', label: 'Payout Request',      bg: '#fff7ed' },
  PAYOUT_REVERSAL:      { icon: '💎', label: 'Payout Reversed',     bg: '#f0fdf4' },
  DISPUTED:             { icon: '⚠️', label: 'Disputed',            bg: '#fef2f2' },
};

function TxRow({ tx }: { tx: any }) {
  const meta  = TX_META[tx.type] ?? { icon: '🪙', label: tx.type, bg: '#f9fafb' };

  const displayEmoji = (tx.type === 'GIFT_SEND' || tx.type === 'GIFT_RECEIVE')
    ? (tx.giftDetails?.gift?.emoji ?? meta.icon)
    : meta.icon;

  const displayLabel = tx.type === 'GIFT_SEND' && tx.giftDetails
    ? `${tx.giftDetails.gift.name} → ${tx.giftDetails.receiver.firstName} ${tx.giftDetails.receiver.lastName}`
    : (tx.description ?? meta.label);

  const coinAmt    = Math.abs(tx.coins ?? 0);
  const diamondAmt = Math.abs(tx.diamonds ?? 0);

  return (
    <View style={w.txRow}>
      <View style={[w.txEmoji, { backgroundColor: meta.bg }]}>
        <Text style={{ fontSize: 18 }}>{displayEmoji}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={w.txName} numberOfLines={1}>{meta.label}</Text>
        <Text style={w.txMeta} numberOfLines={1}>
          {displayLabel} · {timeAgo(tx.createdAt)}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        {coinAmt > 0 && (
          <Text style={[w.txAmount, { color: tx.coins < 0 ? '#ef4444' : '#22c55e' }]}>
            {tx.coins < 0 ? '-' : '+'}{fmt(coinAmt)} 🪙
          </Text>
        )}
        {diamondAmt > 0 && (
          <Text style={[w.txAmount, { color: tx.diamonds < 0 ? '#ef4444' : '#22c55e' }]}>
            {tx.diamonds < 0 ? '-' : '+'}{fmt(diamondAmt)} 💎
          </Text>
        )}
        {coinAmt === 0 && diamondAmt === 0 && (
          <Text style={w.txMeta}>—</Text>
        )}
      </View>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function WalletScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const [tab, setTab] = useState<Tab>('buy');
  const [buyingId, setBuyingId] = useState<string | null>(null);

  // Real-time coin credit
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    socket.emit('wallet:join');
    const onCredited = (d: { coins: number }) => {
      showMessage({ message: `✅ ${fmt(d.coins)} coins added to your wallet!`, type: 'success' });
      queryClient.invalidateQueries({ queryKey: ['wallet-me'] });
      // F-09: also invalidate history so the new transaction shows without a tab switch
      queryClient.invalidateQueries({ queryKey: ['wallet-history'] });
    };
    socket.on('wallet:coins_credited', onCredited);
    return () => {
      socket.emit('wallet:leave');
      socket.off('wallet:coins_credited', onCredited);
    };
  }, [queryClient]);

  const { data: wallet, isLoading: wLoading } = useQuery({
    queryKey: ['wallet-me'],
    queryFn: () => api.get('/wallet/me').then(r => r.data.data),
  });

  const { data: packages = [], isLoading: pkgLoading } = useQuery<any[]>({
    queryKey: ['coin-packages'],
    queryFn: () => api.get('/wallet/packages').then(r => r.data.data ?? []),
    staleTime: 5 * 60_000,
  });

  const { data: history, isLoading: histLoading } = useQuery<{ data: any[]; pagination: any }>({
    queryKey: ['wallet-history'],
    // Backend: GET /wallet/history → successResponse wraps in { success, message, data: { data: [...], pagination } }
    // r.data.data = { data: WalletTx[], pagination: {...} }
    queryFn: () => api.get('/wallet/history').then(r => r.data.data),
    enabled: tab === 'history',
  });

  const handleBuy = async (pkg: any) => {
    setBuyingId(pkg.id);
    try {
      // Try Stripe checkout link first
      const res = await api.post('/stripe/checkout', { packageId: pkg.id });
      const { checkoutUrl } = res.data.data;
      if (checkoutUrl) {
        // Navigate to buy-coins screen which will open the URL
        router.push({ pathname: '/buy-coins', params: { packageId: pkg.id, checkoutUrl } } as any);
        return;
      }
    } catch (e: any) {
      if (e?.response?.status !== 503) {
        showMessage({ message: e?.response?.data?.message ?? 'Purchase failed', type: 'danger' });
        setBuyingId(null); return;
      }
      // 503 = Stripe not configured — fall through to dev mode
    }
    // Dev fallback — only works in development (blocked by backend in production)
    // In production, the /stripe/checkout flow above handles coin purchases.
    // If we reach this point in production, show an appropriate message.
    if (process.env.EXPO_PUBLIC_ENV === 'production') {
      showMessage({ message: 'Stripe checkout is required for purchases', type: 'danger' });
      setBuyingId(null);
      return;
    }
    try {
      const res = await api.post('/wallet/purchase', { packageId: pkg.id });
      const total = res.data.data?.purchased?.total ?? 0;
      showMessage({ message: `🎉 ${fmt(total)} coins added!`, type: 'success' });
      queryClient.invalidateQueries({ queryKey: ['wallet-me'] });
    } catch (e: any) {
      showMessage({ message: e?.response?.data?.message ?? 'Purchase failed', type: 'danger' });
    } finally {
      setBuyingId(null);
    }
  };

  const coins    = wallet?.coins    ?? 0;
  const diamonds = wallet?.diamonds ?? 0;
  const spent    = wallet?.totalSpent  ?? 0;
  const earned   = wallet?.totalEarned ?? 0;

  return (
    <SafeAreaView style={w.container} edges={['top']}>
      {/* Header */}
      <View style={w.header}>
        <Text style={w.title}>Wallet</Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 24 + insets.bottom }}>
        {/* Balance card */}
        <View style={w.balanceCard}>
          <Text style={w.balanceUser}>{user?.firstName} {user?.lastName}</Text>
          <View style={w.balanceRow}>
            <View style={w.balanceItem}>
              <Text style={w.balanceEmoji}>🪙</Text>
              <Text style={w.balanceValue}>{wLoading ? '…' : fmt(coins)}</Text>
              <Text style={w.balanceSub}>Coins</Text>
            </View>
            <View style={w.balanceDivider} />
            <View style={w.balanceItem}>
              <Text style={w.balanceEmoji}>💎</Text>
              <Text style={w.balanceValue}>{wLoading ? '…' : fmt(diamonds)}</Text>
              <Text style={w.balanceSub}>Diamonds</Text>
            </View>
          </View>
          {!wLoading && (
            <View style={w.balanceTotals}>
              <Text style={w.balanceTotalItem}>↑ {fmt(spent)} spent</Text>
              <Text style={w.balanceTotalItem}>↓ {fmt(earned)} earned</Text>
            </View>
          )}
        </View>

        {/* Tabs */}
        <View style={w.tabBar}>
          {(['buy', 'history'] as Tab[]).map(t => (
            <TouchableOpacity key={t} style={[w.tabBtn, tab === t && w.tabBtnActive]} onPress={() => setTab(t)}>
              <Text style={[w.tabTxt, tab === t && w.tabTxtActive]}>
                {t === 'buy' ? '🛒 Buy Coins' : '📋 History'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Buy Tab */}
        {tab === 'buy' && (
          <>
            <View style={w.infoBanner}>
              <Ionicons name="information-circle-outline" size={16} color="#1d4ed8" />
              <Text style={w.infoTxt}>Coins are used to send gifts in Voice Club and Live Class rooms</Text>
            </View>
            {pkgLoading ? (
              <ActivityIndicator size="large" color="#4f46e5" style={{ margin: 32 }} />
            ) : packages.length === 0 ? (
              <View style={w.empty}>
                <Text style={{ fontSize: 36 }}>🪙</Text>
                <Text style={w.emptyTxt}>No packages available yet</Text>
              </View>
            ) : (
              <View style={w.pkgGrid}>
                {packages.map(pkg => (
                  <PackageCard
                    key={pkg.id}
                    pkg={pkg}
                    onBuy={() => handleBuy(pkg)}
                    loading={buyingId === pkg.id}
                  />
                ))}
              </View>
            )}
            {/* Transaction history shortcut */}
            <TouchableOpacity style={w.historyBtn} onPress={() => setTab('history')}>
              <Ionicons name="time-outline" size={20} color="#4f46e5" />
              <Text style={w.historyBtnTxt}>View Transaction History</Text>
              <Ionicons name="chevron-forward" size={16} color="#9ca3af" />
            </TouchableOpacity>
          </>
        )}

        {/* History Tab */}
        {tab === 'history' && (
          <View style={{ paddingHorizontal: 12 }}>
            {histLoading ? (
              <ActivityIndicator size="large" color="#4f46e5" style={{ margin: 32 }} />
            ) : !history || !history.data || history.data.length === 0 ? (
              <View style={w.empty}>
                <Text style={{ fontSize: 36 }}>🎁</Text>
                <Text style={w.emptyTxt}>No transactions yet</Text>
                <Text style={w.emptySub}>Send a gift in a Voice Club room to get started</Text>
              </View>
            ) : (
              <View style={w.txSection}>
                <View style={w.txSectionHeader}>
                  <Text style={w.txSectionTitle}>All Transactions</Text>
                </View>
                {history.data.map((tx: any) => <TxRow key={tx.id} tx={tx} />)}
                {history.pagination?.total > history.data.length && (
                  <Text style={[w.txMeta, { textAlign: 'center', paddingVertical: 8 }]}>
                    Showing {history.data.length} of {history.pagination.total}
                  </Text>
                )}
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const w = StyleSheet.create({
  container:        { flex: 1, backgroundColor: '#f9fafb' },
  header:           { paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  title:            { fontSize: 22, fontWeight: '900', color: '#111827' },
  // Balance
  balanceCard:      { margin: 12, borderRadius: 20, padding: 24, backgroundColor: '#4f46e5', overflow: 'hidden' },
  balanceUser:      { color: '#c7d2fe', fontSize: 12, fontWeight: '600', marginBottom: 14 },
  balanceRow:       { flexDirection: 'row', alignItems: 'center' },
  balanceItem:      { flex: 1, alignItems: 'center' },
  balanceEmoji:     { fontSize: 30, marginBottom: 4 },
  balanceValue:     { fontSize: 28, fontWeight: '900', color: '#fff' },
  balanceSub:       { fontSize: 12, color: '#c7d2fe', marginTop: 2 },
  balanceDivider:   { width: 1, height: 56, backgroundColor: 'rgba(255,255,255,0.2)', marginHorizontal: 8 },
  balanceTotals:    { flexDirection: 'row', justifyContent: 'space-around', marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.2)' },
  balanceTotalItem: { fontSize: 11, color: '#c7d2fe', fontWeight: '600' },
  // Tabs
  tabBar:           { flexDirection: 'row', marginHorizontal: 12, marginBottom: 12, backgroundColor: '#f1f5f9', borderRadius: 14, padding: 3 },
  tabBtn:           { flex: 1, paddingVertical: 9, alignItems: 'center', borderRadius: 11 },
  tabBtnActive:     { backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
  tabTxt:           { fontSize: 13, fontWeight: '600', color: '#6b7280' },
  tabTxtActive:     { color: '#111827', fontWeight: '700' },
  // Info banner
  infoBanner:       { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginHorizontal: 12, marginBottom: 12, backgroundColor: '#eff6ff', borderRadius: 12, padding: 10, borderWidth: 1, borderColor: '#bfdbfe' },
  infoTxt:          { flex: 1, fontSize: 12, color: '#1d4ed8', lineHeight: 18 },
  // Package grid
  pkgGrid:          { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 8, gap: 8, marginBottom: 12 },
  pkgCard:          { width: '47%', marginHorizontal: '1.5%', backgroundColor: '#fff', borderRadius: 16, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: '#e5e7eb' },
  pkgIconWrap:      { width: 48, height: 48, borderRadius: 24, backgroundColor: '#ede9fe', justifyContent: 'center', alignItems: 'center', marginBottom: 6 },
  pkgEmoji:         { fontSize: 26 },
  pkgCoins:         { fontSize: 20, fontWeight: '900', color: '#111827' },
  pkgName:          { fontSize: 11, color: '#6b7280', marginTop: 2, textAlign: 'center' },
  bonusBadge:       { backgroundColor: '#d1fae5', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, marginVertical: 4 },
  bonusTxt:         { fontSize: 10, fontWeight: '700', color: '#059669' },
  buyBtn:           { backgroundColor: '#4f46e5', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 7, marginTop: 6 },
  buyBtnDisabled:   { backgroundColor: '#c7d2fe' },
  buyBtnTxt:        { color: '#fff', fontSize: 13, fontWeight: '700' },
  historyBtn:       { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 12, backgroundColor: '#fff', padding: 16, borderRadius: 16, borderWidth: 1, borderColor: '#f3f4f6' },
  historyBtnTxt:    { flex: 1, fontSize: 15, fontWeight: '600', color: '#374151' },
  // Transaction history
  txSection:        { backgroundColor: '#fff', borderRadius: 14, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: '#f1f5f9' },
  txSectionHeader:  { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  txSectionTitle:   { fontSize: 12, fontWeight: '700', color: '#374151', textTransform: 'uppercase', letterSpacing: 0.5 },
  txRow:            { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f9fafb' },
  txEmoji:          { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  txName:           { fontSize: 13, fontWeight: '600', color: '#1e293b' },
  txMeta:           { fontSize: 11, color: '#94a3b8', marginTop: 1 },
  txAmount:         { fontSize: 12, fontWeight: '800', flexShrink: 0 },
  // Empty
  empty:            { alignItems: 'center', paddingVertical: 40, gap: 8 },
  emptyTxt:         { fontSize: 15, color: '#94a3b8', marginTop: 8 },
  emptySub:         { fontSize: 12, color: '#cbd5e1', textAlign: 'center' },
});

