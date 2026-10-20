/**
 * HALQA Mobile — MicPassModal
 * Handles the "mic pass" flow: host offers the mic to an audience member,
 * and that member can accept or decline.
 *
 * Usage (host side):
 *   <MicPassModal
 *     visible={showMicPass}
 *     mode="offer"           // host is offering the mic
 *     roomId={id}
 *     target={{ id, name, avatar }}
 *     onClose={() => setShowMicPass(false)}
 *   />
 *
 * Usage (recipient side — triggered by socket event voice:mic_pass_offer):
 *   <MicPassModal
 *     visible={showMicPassIncoming}
 *     mode="incoming"
 *     roomId={id}
 *     offeredBy={{ id, name, avatar }}
 *     onClose={() => setShowMicPassIncoming(false)}
 *     onAccepted={() => { setShowMicPassIncoming(false); }} // role updated via socket
 *   />
 */
import React, { useEffect, useRef } from 'react';
import {
  Modal, View, Text, TouchableOpacity, StyleSheet,
  Image, Animated, Easing, ActivityIndicator
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { showMessage } from 'react-native-flash-message';
import api from '@/lib/api';
import { avatarUrl } from '@/lib/avatar';

export interface MicPassUser {
  id: string;
  name: string;
  avatar?: string | null;
}

interface MicPassModalProps {
  visible: boolean;
  mode: 'offer' | 'incoming';
  roomId: string;
  /** The person being offered the mic (host-side, mode=offer) */
  target?: MicPassUser;
  /** The person who offered the mic (recipient-side, mode=incoming) */
  offeredBy?: MicPassUser;
  /** The offer ID returned by socket event voice:mic_offer (needed for accept/decline) */
  offerId?: string;
  onClose: () => void;
  onAccepted?: () => void;
}

export default function MicPassModal({
  visible, mode, roomId, target, offeredBy, offerId, onClose, onAccepted,
}: MicPassModalProps) {
  const [sending, setSending] = React.useState(false);
  // Track the offerId returned after sending so the passer can cancel
  const [sentOfferId, setSentOfferId] = React.useState<string | null>(null);
  const [cancelling, setCancelling] = React.useState(false);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Pulse animation for incoming offer
  useEffect(() => {
    if (!visible || mode !== 'incoming') return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.15, duration: 600, easing: Easing.ease, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 600, easing: Easing.ease, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [visible, mode]);

  // Reset sentOfferId when modal is hidden (e.g. acceptance resolved externally)
  useEffect(() => {
    if (!visible) setSentOfferId(null);
  }, [visible]);

  // Auto-decline after 30s if incoming offer not acted on
  useEffect(() => {
    if (!visible || mode !== 'incoming') return;
    const timer = setTimeout(() => {
      handleDecline();
    }, 30_000);
    return () => clearTimeout(timer);
  }, [visible, mode]);

  const handleOffer = async () => {
    if (!target) return;
    setSending(true);
    try {
      // POST /voice/:id/mic-pass/:targetUserId
      const res = await api.post(`/voice/${roomId}/mic-pass/${target.id}`);
      const returnedOfferId = res.data?.data?.offerId;
      showMessage({ message: `🎙️ Mic offered to ${target.name.split(' ')[0]} — waiting…`, type: 'info' });
      // Store the offerId so we can cancel later; DON'T close yet
      setSentOfferId(returnedOfferId ?? null);
    } catch (e: any) {
      showMessage({ message: e?.response?.data?.message ?? 'Failed to offer mic', type: 'danger' });
    } finally {
      setSending(false);
    }
  };

  const handleCancelOffer = async () => {
    if (!sentOfferId) { onClose(); return; }
    setCancelling(true);
    try {
      await api.delete(`/voice/${roomId}/mic-pass/${sentOfferId}`);
      showMessage({ message: 'Mic offer cancelled', type: 'info' });
    } catch {} finally {
      setCancelling(false);
      setSentOfferId(null);
      onClose();
    }
  };

  const handleAccept = async () => {
    if (!offerId) {
      showMessage({ message: 'Offer expired — no offer ID', type: 'warning' });
      onClose();
      return;
    }
    setSending(true);
    try {
      // POST /voice/:id/mic-pass/:offerId/accept
      await api.post(`/voice/${roomId}/mic-pass/${offerId}/accept`);
      showMessage({ message: '🎤 You are now on stage!', type: 'success' });
      onAccepted?.();
      onClose();
    } catch (e: any) {
      showMessage({ message: e?.response?.data?.message ?? 'Failed to accept', type: 'danger' });
    } finally {
      setSending(false);
    }
  };

  const handleDecline = async () => {
    try {
      if (offerId) {
        // POST /voice/:id/mic-pass/:offerId/decline
        await api.post(`/voice/${roomId}/mic-pass/${offerId}/decline`).catch(() => {});
      }
    } finally {
      onClose();
    }
  };

  if (!visible) return null;

  // ── Offer mode: host choosing to pass mic to a specific user ──────────────
  if (mode === 'offer') {
    // ── State: offer sent, waiting for recipient ────────────────────────────
    if (sentOfferId) {
      return (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={handleCancelOffer}>
          <TouchableOpacity style={st.backdrop} activeOpacity={1} onPress={handleCancelOffer} />
          <View style={st.sheet}>
            <View style={st.handle} />
            <Text style={st.title}>🎙️ Offer Sent</Text>
            {target && (
              <View style={st.userRow}>
                <Image source={{ uri: avatarUrl(target.avatar, target.name) }} style={st.avatar} />
                <View style={{ flex: 1 }}>
                  <Text style={st.userName}>{target.name}</Text>
                  <Text style={st.userSub}>Waiting for them to accept…</Text>
                </View>
                <Ionicons name="time-outline" size={20} color="#a5b4fc" />
              </View>
            )}
            <Text style={st.desc}>
              The offer expires in 30 seconds. Tap cancel to withdraw it.
            </Text>
            <TouchableOpacity
              style={[st.confirmBtn, { backgroundColor: '#374151' }, cancelling && st.btnDisabled]}
              onPress={handleCancelOffer}
              disabled={cancelling}
            >
              {cancelling
                ? <ActivityIndicator color="#fff" size="small" />
                : <><Ionicons name="close-circle" size={16} color="#fff" /><Text style={st.confirmTxt}>Cancel Offer</Text></>
              }
            </TouchableOpacity>
          </View>
        </Modal>
      );
    }

    // ── State: pre-send confirmation ────────────────────────────────────────
    return (
      <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
        <TouchableOpacity style={st.backdrop} activeOpacity={1} onPress={onClose} />
        <View style={st.sheet}>
          <View style={st.handle} />
          <Text style={st.title}>🎙️ Pass the Mic</Text>
          {target && (
            <View style={st.userRow}>
              <Image source={{ uri: avatarUrl(target.avatar, target.name) }} style={st.avatar} />
              <View style={{ flex: 1 }}>
                <Text style={st.userName}>{target.name}</Text>
                <Text style={st.userSub}>Will be promoted to Speaker</Text>
              </View>
            </View>
          )}
          <Text style={st.desc}>
            Passing the mic will promote{' '}
            <Text style={{ color: '#a5b4fc', fontWeight: '700' }}>{target?.name.split(' ')[0] ?? 'this user'}</Text>
            {' '}to Speaker. They will be able to unmute and speak.
          </Text>
          <View style={st.btnRow}>
            <TouchableOpacity style={st.cancelBtn} onPress={onClose} disabled={sending}>
              <Text style={st.cancelTxt}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[st.confirmBtn, sending && st.btnDisabled]} onPress={handleOffer} disabled={sending}>
              {sending
                ? <ActivityIndicator color="#fff" size="small" />
                : <><Ionicons name="mic" size={16} color="#fff" /><Text style={st.confirmTxt}>Pass Mic</Text></>
              }
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  }

  // ── Incoming mode: recipient seeing the offer ─────────────────────────────
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleDecline}>
      <View style={st.incomingBackdrop}>
        <View style={st.incomingCard}>
          {/* Pulsing mic icon */}
          <Animated.View style={[st.micCircle, { transform: [{ scale: pulseAnim }] }]}>
            <Ionicons name="mic" size={32} color="#fff" />
          </Animated.View>

          <Text style={st.incomingTitle}>🎙️ Mic Invitation</Text>
          {offeredBy && (
            <View style={st.incomingHost}>
              <Image source={{ uri: avatarUrl(offeredBy.avatar, offeredBy.name) }} style={st.incomingAvatar} />
              <Text style={st.incomingHostName}>
                <Text style={{ color: '#a5b4fc', fontWeight: '700' }}>{offeredBy.name.split(' ')[0]}</Text>
                {' '}is passing the mic to you
              </Text>
            </View>
          )}
          <Text style={st.incomingDesc}>
            Accept to join the stage and speak. You can mute yourself at any time.
          </Text>
          <Text style={st.incomingTimer}>Auto-declines in 30s</Text>

          <View style={st.incomingBtns}>
            <TouchableOpacity style={st.declineBtn} onPress={handleDecline} disabled={sending}>
              <Ionicons name="close" size={20} color="#ef4444" />
              <Text style={st.declineTxt}>Decline</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[st.acceptBtn, sending && st.btnDisabled]} onPress={handleAccept} disabled={sending}>
              {sending
                ? <ActivityIndicator color="#fff" size="small" />
                : <><Ionicons name="mic" size={20} color="#fff" /><Text style={st.acceptTxt}>Accept</Text></>
              }
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  backdrop:         { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet:            { backgroundColor: '#1a1a2e', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 36 },
  handle:           { width: 40, height: 4, backgroundColor: '#374151', borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  title:            { color: '#fff', fontSize: 20, fontWeight: '800', marginBottom: 16, textAlign: 'center' },
  userRow:          { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#0f0f23', borderRadius: 14, padding: 12, marginBottom: 14 },
  avatar:           { width: 48, height: 48, borderRadius: 24, backgroundColor: '#374151' },
  userName:         { color: '#e5e7eb', fontSize: 15, fontWeight: '700' },
  userSub:          { color: '#a5b4fc', fontSize: 12, marginTop: 2 },
  desc:             { color: '#9ca3af', fontSize: 13, lineHeight: 20, marginBottom: 20 },
  btnRow:           { flexDirection: 'row', gap: 10 },
  cancelBtn:        { flex: 1, backgroundColor: '#374151', borderRadius: 14, padding: 14, alignItems: 'center' },
  cancelTxt:        { color: '#9ca3af', fontWeight: '700', fontSize: 14 },
  confirmBtn:       { flex: 2, flexDirection: 'row', backgroundColor: '#4f46e5', borderRadius: 14, padding: 14, alignItems: 'center', justifyContent: 'center', gap: 6 },
  confirmTxt:       { color: '#fff', fontWeight: '800', fontSize: 14 },
  btnDisabled:      { backgroundColor: '#374151' },

  // Incoming card
  incomingBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  incomingCard:     { backgroundColor: '#1a1a2e', borderRadius: 24, padding: 28, width: '100%', alignItems: 'center', borderWidth: 1, borderColor: '#4f46e544' },
  micCircle:        { width: 72, height: 72, borderRadius: 36, backgroundColor: '#4f46e5', alignItems: 'center', justifyContent: 'center', marginBottom: 16, shadowColor: '#4f46e5', shadowOpacity: 0.6, shadowRadius: 20, shadowOffset: { width: 0, height: 0 }, elevation: 12 },
  incomingTitle:    { color: '#fff', fontSize: 22, fontWeight: '900', marginBottom: 12 },
  incomingHost:     { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#0f0f23', borderRadius: 12, padding: 10, marginBottom: 12, width: '100%' },
  incomingAvatar:   { width: 36, height: 36, borderRadius: 18, backgroundColor: '#374151' },
  incomingHostName: { color: '#e5e7eb', fontSize: 13, flex: 1, lineHeight: 18 },
  incomingDesc:     { color: '#9ca3af', fontSize: 13, textAlign: 'center', lineHeight: 20, marginBottom: 8 },
  incomingTimer:    { color: '#6b7280', fontSize: 11, marginBottom: 20 },
  incomingBtns:     { flexDirection: 'row', gap: 12, width: '100%' },
  declineBtn:       { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#ef444422', borderWidth: 1.5, borderColor: '#ef444466', borderRadius: 14, paddingVertical: 14 },
  declineTxt:       { color: '#ef4444', fontWeight: '800', fontSize: 14 },
  acceptBtn:        { flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#4f46e5', borderRadius: 14, paddingVertical: 14 },
  acceptTxt:        { color: '#fff', fontWeight: '800', fontSize: 14 },
});

