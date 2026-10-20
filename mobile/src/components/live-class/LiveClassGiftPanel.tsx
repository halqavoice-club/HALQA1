/**
 * LiveClassGiftPanel — Mobile gift-sending panel for live classes.
 * Matches the web GiftPanel feature (IMO/Bigo-style) adapted for React Native.
 *
 * Usage:
 *   <LiveClassGiftPanel
 *     liveClassId={id}
 *     participants={participants}
 *     visible={showGifts}
 *     onClose={() => setShowGifts(false)}
 *   />
 */
import React, { useEffect, useState, useCallback } from 'react';
import {
  Modal, View, Text, TouchableOpacity, FlatList,
  ActivityIndicator, StyleSheet, Image, ScrollView
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { showMessage } from 'react-native-flash-message';
import api from '@/lib/api';
import { avatarUrl } from '@/lib/avatar';

// ─── Types ────────────────────────────────────────────────────────────────────
interface GiftDef {
  id: string;
  name: string;
  emoji: string;
  priceCoins: number;
  comboEnabled: boolean;
  imageUrl?: string | null;
}

interface Recipient {
  userId: string;
  role: string;
  firstName: string;
  lastName: string;
  avatarUrl?: string | null;
}

interface Props {
  liveClassId: string;
  participants: Recipient[];
  visible: boolean;
  onClose: () => void;
}

const ALL_ID = '__ALL__';
const COMBOS = [1, 5, 10, 99];

// ─── Component ────────────────────────────────────────────────────────────────
export function LiveClassGiftPanel({ liveClassId, participants, visible, onClose }: Props) {
  const [gifts,        setGifts]        = useState<GiftDef[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [sending,      setSending]      = useState(false);
  const [selected,     setSelected]     = useState<GiftDef | null>(null);
  const [receiverId,   setReceiverId]   = useState<string>(ALL_ID);
  const [count,        setCount]        = useState(1);
  const [wallet,       setWallet]       = useState<{ coins: number } | null>(null);

  // Hosts and speakers are valid gift recipients (not audience)
  const recipients = participants.filter(p =>
    p.role === 'HOST' || p.role === 'MODERATOR' || p.role === 'SPEAKER'
  );

  // Reset to ALL when panel opens
  useEffect(() => {
    if (!visible) return;
    setReceiverId(recipients.length === 1 ? recipients[0].userId : ALL_ID);
    setCount(1);
  }, [visible, recipients.length]); // eslint-disable-line

  // Load gift catalogue and wallet balance when panel opens
  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    Promise.all([
      api.get('/gifts').then(r => r.data.data ?? []),
      api.get('/wallet').then(r => r.data.data ?? null).catch(() => null),
    ]).then(([giftList, walletData]) => {
      setGifts(giftList);
      if (giftList.length > 0 && !selected) setSelected(giftList[0]);
      setWallet(walletData);
    }).catch(() => {
      showMessage({ message: 'Failed to load gifts', type: 'warning' });
    }).finally(() => setLoading(false));
  }, [visible]); // eslint-disable-line

  const effectiveCount = selected?.comboEnabled ? count : 1;
  const receiverCount  = receiverId === ALL_ID ? Math.max(recipients.length, 1) : 1;
  const totalCost      = (selected?.priceCoins ?? 0) * effectiveCount * receiverCount;
  const canAfford      = (wallet?.coins ?? 0) >= totalCost;

  const handleSend = useCallback(async () => {
    if (!selected || sending) return;
    if (!canAfford) {
      showMessage({
        message: `Need 🪙 ${totalCost.toLocaleString()} — you have 🪙 ${(wallet?.coins ?? 0).toLocaleString()}`,
        type: 'warning',
        duration: 3000,
      });
      return;
    }
    setSending(true);
    try {
      const key = `${Date.now()}-${selected.id}`;
      if (receiverId === ALL_ID) {
        await api.post(`/live-classes/${liveClassId}/gifts/all`, {
          giftId: selected.id,
          count: effectiveCount,
          idempotencyKey: `all-${key}`,
        });
        showMessage({ message: `${selected.emoji} Sent to everyone on stage!`, type: 'success', duration: 2000 });
      } else {
        await api.post(`/live-classes/${liveClassId}/gifts`, {
          giftId: selected.id,
          receiverId,
          count: effectiveCount,
          idempotencyKey: key,
        });
        const target = recipients.find(r => r.userId === receiverId);
        const name   = target ? `${target.firstName} ${target.lastName}`.trim() : 'recipient';
        showMessage({ message: `${selected.emoji} Sent to ${name}!`, type: 'success', duration: 2000 });
      }
      // Refresh wallet balance after sending
      api.get('/wallet').then(r => setWallet(r.data.data ?? null)).catch(() => {});
    } catch (err: any) {
      showMessage({
        message: err?.response?.data?.message ?? 'Failed to send gift',
        type: 'danger',
        duration: 3000,
      });
    } finally {
      setSending(false);
    }
  }, [selected, sending, canAfford, receiverId, effectiveCount, liveClassId, totalCost, wallet, recipients]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="formSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>🎁 Send Gift</Text>
          <View style={styles.walletBadge}>
            <Ionicons name="logo-bitcoin" size={14} color="#f59e0b" />
            <Text style={styles.walletText}>
              {wallet ? wallet.coins.toLocaleString() : '—'}
            </Text>
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close" size={24} color="#374151" />
          </TouchableOpacity>
        </View>

        {/* Recipient selector */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.recipientRow} contentContainerStyle={styles.recipientContent}>
          {/* "Everyone" option */}
          <TouchableOpacity
            style={[styles.recipientChip, receiverId === ALL_ID && styles.recipientChipActive]}
            onPress={() => setReceiverId(ALL_ID)}
          >
            <View style={styles.recipientAvatar}>
              <Ionicons name="people" size={18} color={receiverId === ALL_ID ? '#fff' : '#6b7280'} />
            </View>
            <Text style={[styles.recipientName, receiverId === ALL_ID && styles.recipientNameActive]}>
              All Stage
            </Text>
          </TouchableOpacity>

          {recipients.map(r => {
            const name = `${r.firstName} ${r.lastName}`.trim();
            const isSelected = receiverId === r.userId;
            return (
              <TouchableOpacity
                key={r.userId}
                style={[styles.recipientChip, isSelected && styles.recipientChipActive]}
                onPress={() => setReceiverId(r.userId)}
              >
                <Image source={{ uri: avatarUrl(r.avatarUrl, name) }} style={styles.recipientAvatar} />
                <Text style={[styles.recipientName, isSelected && styles.recipientNameActive]} numberOfLines={1}>
                  {r.firstName}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Gift grid */}
        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator color="#4f46e5" />
          </View>
        ) : (
          <FlatList
            data={gifts}
            keyExtractor={g => g.id}
            numColumns={4}
            contentContainerStyle={styles.giftGrid}
            renderItem={({ item: g }) => {
              const isSelected = selected?.id === g.id;
              return (
                <TouchableOpacity
                  style={[styles.giftCard, isSelected && styles.giftCardActive]}
                  onPress={() => { setSelected(g); setCount(1); }}
                >
                  <Text style={styles.giftEmoji}>{g.emoji}</Text>
                  <Text style={[styles.giftName, isSelected && { color: '#4f46e5' }]} numberOfLines={1}>
                    {g.name}
                  </Text>
                  <Text style={styles.giftPrice}>🪙 {g.priceCoins}</Text>
                </TouchableOpacity>
              );
            }}
          />
        )}

        {/* Footer — combo selector + send button */}
        <View style={styles.footer}>
          {/* Combo count (only if gift supports it) */}
          {selected?.comboEnabled ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.comboRow}>
              {COMBOS.map(n => (
                <TouchableOpacity
                  key={n}
                  style={[styles.comboBtn, count === n && styles.comboBtnActive]}
                  onPress={() => setCount(n)}
                >
                  <Text style={[styles.comboBtnText, count === n && styles.comboBtnTextActive]}>×{n}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          ) : (
            <View style={{ flex: 1 }} />
          )}

          {/* Cost + send */}
          <View style={styles.sendArea}>
            <Text style={[styles.costText, !canAfford && { color: '#ef4444' }]}>
              🪙 {totalCost.toLocaleString()}
            </Text>
            <TouchableOpacity
              style={[styles.sendBtn, (!selected || !canAfford || sending) && styles.sendBtnDisabled]}
              onPress={handleSend}
              disabled={!selected || !canAfford || sending}
            >
              {sending
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={styles.sendBtnText}>Send</Text>
              }
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container:          { flex: 1, backgroundColor: '#fff' },
  header:             { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  headerTitle:        { fontSize: 17, fontWeight: '800', color: '#111827', flex: 1 },
  walletBadge:        { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#fffbeb', borderWidth: 1, borderColor: '#fde68a', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, marginRight: 12 },
  walletText:         { fontSize: 13, fontWeight: '700', color: '#92400e' },
  recipientRow:       { maxHeight: 80, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  recipientContent:   { paddingHorizontal: 12, paddingVertical: 10, gap: 8, flexDirection: 'row', alignItems: 'center' },
  recipientChip:      { alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12, borderWidth: 1.5, borderColor: '#e5e7eb', backgroundColor: '#f9fafb', minWidth: 60 },
  recipientChipActive:{ borderColor: '#4f46e5', backgroundColor: '#eef2ff' },
  recipientAvatar:    { width: 32, height: 32, borderRadius: 16, backgroundColor: '#4f46e5', alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  recipientName:      { fontSize: 11, color: '#6b7280', fontWeight: '600', maxWidth: 60 },
  recipientNameActive:{ color: '#4f46e5' },
  loadingBox:         { flex: 1, alignItems: 'center', justifyContent: 'center' },
  giftGrid:           { padding: 12, gap: 8 },
  giftCard:           { flex: 1, margin: 4, alignItems: 'center', padding: 10, borderRadius: 12, borderWidth: 1.5, borderColor: '#e5e7eb', backgroundColor: '#f9fafb', minWidth: 70 },
  giftCardActive:     { borderColor: '#4f46e5', backgroundColor: '#eef2ff' },
  giftEmoji:          { fontSize: 28, marginBottom: 4 },
  giftName:           { fontSize: 11, color: '#374151', fontWeight: '600', textAlign: 'center' },
  giftPrice:          { fontSize: 11, color: '#6b7280', marginTop: 2 },
  footer:             { flexDirection: 'row', alignItems: 'center', padding: 12, borderTopWidth: 1, borderTopColor: '#f3f4f6', gap: 8 },
  comboRow:           { flex: 1 },
  comboBtn:           { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5, borderColor: '#e5e7eb', marginRight: 6 },
  comboBtnActive:     { borderColor: '#4f46e5', backgroundColor: '#eef2ff' },
  comboBtnText:       { fontSize: 13, fontWeight: '700', color: '#6b7280' },
  comboBtnTextActive: { color: '#4f46e5' },
  sendArea:           { flexDirection: 'row', alignItems: 'center', gap: 10 },
  costText:           { fontSize: 14, fontWeight: '800', color: '#374151' },
  sendBtn:            { backgroundColor: '#4f46e5', paddingHorizontal: 22, paddingVertical: 12, borderRadius: 14 },
  sendBtnDisabled:    { backgroundColor: '#c7d2fe' },
  sendBtnText:        { color: '#fff', fontWeight: '800', fontSize: 15 },
});

