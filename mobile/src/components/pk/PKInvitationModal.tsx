/**
 * PKInvitationModal — Mobile
 * ─────────────────────────────────────────────────────────────────────────────
 * Global modal that slides up from the bottom when a PK challenge arrives on
 * any screen. Subscribes to `pk:invitation` directly — does not require the
 * PK hub screen to be mounted.
 *
 * Usage: render once inside the root _layout.tsx so it's always active.
 */

import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View, Text, Modal, TouchableOpacity, StyleSheet,
  Image, Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { showMessage } from 'react-native-flash-message';
import api from '@/lib/api';
import { getSocket } from '@/lib/socket';
import { avatarUrl as buildAvatarUrl } from '@/lib/avatar';

interface Invitation {
  id:              string;
  senderId:        string;
  type:            string;
  durationSeconds: number;
  expiresAt:       string;
  message:         string | null;
  sender?: {
    id:        string;
    firstName: string;
    lastName:  string;
    avatarUrl: string | null;
  };
}

export function PKInvitationModal() {
  const [invitation,  setInvitation]  = useState<Invitation | null>(null);
  const [accepting,   setAccepting]   = useState(false);
  const [rejecting,   setRejecting]   = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const timerRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const slideAnim = useRef(new Animated.Value(300)).current;

  const dismiss = useCallback(() => {
    Animated.timing(slideAnim, {
      toValue: 300, duration: 250, useNativeDriver: true,
    }).start(() => {
      setInvitation(null);
      setAccepting(false);
      setRejecting(false);
    });
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }, [slideAnim]);

  // Subscribe to socket events globally — with retry until socket is ready
  useEffect(() => {
    let unsubscribe: (() => void) | null = null;

    function trySubscribe() {
      const socket = getSocket();
      if (!socket) return false;

      const handler = (data: { invitation: Invitation; sender: Invitation['sender'] }) => {
        const inv = { ...data.invitation, sender: data.sender };
        setInvitation(inv);
        setAccepting(false);
        setRejecting(false);

        Animated.spring(slideAnim, {
          toValue: 0, useNativeDriver: true, tension: 80, friction: 12,
        }).start();

        const expiresMs  = new Date(inv.expiresAt).getTime() - Date.now();
        const expirySecs = Math.max(0, Math.floor(expiresMs / 1000));
        setSecondsLeft(expirySecs || 300);

        if (timerRef.current) clearInterval(timerRef.current);
        timerRef.current = setInterval(() => {
          setSecondsLeft(s => {
            if (s <= 1) {
              clearInterval(timerRef.current!);
              timerRef.current = null;
              dismiss();
              return 0;
            }
            return s - 1;
          });
        }, 1000);
      };

      socket.on('pk:invitation', handler);
      unsubscribe = () => {
        socket.off('pk:invitation', handler);
        if (timerRef.current) clearInterval(timerRef.current);
      };
      return true;
    }

    if (!trySubscribe()) {
      // Socket not ready yet — retry every 500ms until it is
      const retryId = setInterval(() => {
        if (trySubscribe()) clearInterval(retryId);
      }, 500);
      return () => { clearInterval(retryId); unsubscribe?.(); };
    }

    return () => { unsubscribe?.(); };
  }, [dismiss, slideAnim]);

  const handleAccept = useCallback(async () => {
    if (!invitation || accepting) return;
    setAccepting(true);
    try {
      await api.post(`/pk/invitations/${invitation.id}/accept`);
      // Simply dismiss — if the user is in a Voice Club room, the MobilePKBanner
      // will appear automatically when pk:room:started fires.
      // If they accepted from outside a room, they need to go to the voice room
      // where the battle is happening to see the banner.
      dismiss();
    } catch (e: any) {
      showMessage({
        message: e?.response?.data?.message || 'Could not accept invitation',
        type: 'danger',
      });
      dismiss();
    }
  }, [invitation, accepting, dismiss]);

  const handleDecline = useCallback(async () => {
    if (!invitation || rejecting) return;
    setRejecting(true);
    try {
      await api.post(`/pk/invitations/${invitation.id}/reject`);
    } catch {}
    dismiss();
  }, [invitation, rejecting, dismiss]);

  if (!invitation) return null;

  const senderName = invitation.sender
    ? `${invitation.sender.firstName} ${invitation.sender.lastName}`
    : 'Someone';

  const durationLabel = `${Math.floor(invitation.durationSeconds / 60)} min battle`;

  // Expiry progress
  const totalSecs = Math.max(1, Math.floor(
    (new Date(invitation.expiresAt).getTime() - Date.now() + secondsLeft * 1000) / 1000
  ));
  const pctLeft = (secondsLeft / totalSecs) * 100;

  return (
    <Modal visible transparent animationType="none" onRequestClose={dismiss}>
      {/* Backdrop */}
      <TouchableOpacity
        style={s.backdrop}
        activeOpacity={1}
        onPress={dismiss}
      />

      {/* Sheet */}
      <Animated.View style={[s.sheet, { transform: [{ translateY: slideAnim }] }]}>
        {/* Handle */}
        <View style={s.handle} />

        {/* Expiry bar */}
        <View style={s.expiryTrack}>
          <View style={[s.expiryFill, { width: `${pctLeft}%` as any }]} />
        </View>

        {/* Sender info */}
        <View style={s.senderRow}>
          <View style={s.avatarWrap}>
            <Image
              source={{ uri: buildAvatarUrl(invitation.sender?.avatarUrl, senderName) }}
              style={s.avatar}
            />
            <Text style={s.swordEmoji}>⚔️</Text>
          </View>

          <View style={s.senderInfo}>
            <Text style={s.senderName} numberOfLines={1}>{senderName}</Text>
            <Text style={s.challengeText}>challenges you to a PK battle!</Text>
            <Text style={s.meta}>{durationLabel} · expires in {secondsLeft}s</Text>
          </View>

          <TouchableOpacity onPress={dismiss} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close" size={20} color="#64748b" />
          </TouchableOpacity>
        </View>

        {/* Optional message */}
        {invitation.message ? (
          <Text style={s.message}>"{invitation.message}"</Text>
        ) : null}

        {/* Buttons */}
        <View style={s.btnRow}>
          <TouchableOpacity
            style={[s.btn, s.btnDecline]}
            onPress={handleDecline}
            disabled={accepting || rejecting}
            activeOpacity={0.8}
          >
            <Text style={s.btnDeclineText}>
              {rejecting ? '…' : '✕ Decline'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[s.btn, s.btnAccept, (accepting || rejecting) && s.btnDisabled]}
            onPress={handleAccept}
            disabled={accepting || rejecting}
            activeOpacity={0.8}
          >
            <Text style={s.btnAcceptText}>
              {accepting ? '⏳ Joining…' : '⚔️ Accept'}
            </Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop:      { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet:         {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: '#0f172a',
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 20, paddingBottom: 36,
    borderWidth: 1, borderColor: 'rgba(99,102,241,0.25)',
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.4, shadowRadius: 16, elevation: 20,
  },
  handle:        { width: 40, height: 4, backgroundColor: '#334155', borderRadius: 2, alignSelf: 'center', marginBottom: 12 },
  expiryTrack:   { height: 3, backgroundColor: '#1e293b', borderRadius: 2, marginBottom: 16, overflow: 'hidden' },
  expiryFill:    { height: 3, backgroundColor: '#6366f1', borderRadius: 2 },
  senderRow:     { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  avatarWrap:    { position: 'relative' },
  avatar:        { width: 52, height: 52, borderRadius: 26, borderWidth: 2, borderColor: '#6366f1', backgroundColor: '#1e293b' },
  swordEmoji:    { position: 'absolute', bottom: -4, right: -4, fontSize: 18 },
  senderInfo:    { flex: 1, minWidth: 0, gap: 2 },
  senderName:    { color: '#e2e8f0', fontSize: 16, fontWeight: '700' },
  challengeText: { color: '#818cf8', fontSize: 13, fontWeight: '600' },
  meta:          { color: '#64748b', fontSize: 11, marginTop: 2 },
  message:       { color: '#94a3b8', fontSize: 12, fontStyle: 'italic', marginBottom: 14, paddingHorizontal: 4 },
  btnRow:        { flexDirection: 'row', gap: 10, marginTop: 4 },
  btn:           { flex: 1, paddingVertical: 14, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  btnDecline:    { backgroundColor: '#1e293b', borderWidth: 1, borderColor: '#334155' },
  btnDeclineText:{ color: '#94a3b8', fontSize: 15, fontWeight: '600' },
  btnAccept:     { backgroundColor: '#4f46e5' },
  btnAcceptText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  btnDisabled:   { opacity: 0.5 },
});
