/**
 * VoiceRoomShareCard (React Native) — renders a structured Voice Club share card
 * in DM and Group Chat.
 *
 * Used by:
 *   - DmMediaBubble (msgType === 'VOICE_ROOM_SHARE')
 *   - Group Chat message rendering (type === 'VOICE_ROOM_SHARE')
 *
 * Data source: voiceRoomData from the backend (authoritative).
 * refEntityId is used for navigation — never a client-supplied title.
 *
 * States:
 *   voiceRoomData exists  → full card with title, emoji, status, Join button
 *   voiceRoomData === null → "Voice Club unavailable" fallback (safe, no crash)
 *   refEntityId missing   → minimal safe fallback
 *
 * Navigation: uses existing mobile Voice Club route app/voice/[id].tsx
 *   via router.push(`/voice/${refEntityId}`)
 */
import React from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

// ─── Types ─────────────────────────────────────────────────────────────────────
export interface VoiceRoomShareData {
  id: string;
  title: string;
  coverEmoji?: string | null;
  coverImageUrl?: string | null;
  privacy?: string | null;
  status?: string | null;
  hostId?: string | null;
  maxSpeakers?: number | null;
}

interface Props {
  /** Authoritative room ID — used for navigation via existing mobile route */
  refEntityId: string | null | undefined;
  /** Server-provided room data — null means room is unavailable */
  voiceRoomData: VoiceRoomShareData | null | undefined;
  /** Optional note/body the sender added */
  body?: string | null;
  /** Whether this message was sent by the current user */
  isMe: boolean;
}

// ─── Component ─────────────────────────────────────────────────────────────────
export function VoiceRoomShareCard({ refEntityId, voiceRoomData, body, isMe }: Props) {
  const router = useRouter();

  const handleJoin = () => {
    if (!refEntityId) return;
    // Use the existing mobile Voice Club route: app/voice/[id].tsx
    router.push(`/voice/${refEntityId}` as any);
  };

  const cardBg      = isMe ? 'rgba(18,140,126,0.12)' : '#f3f0ff';
  const borderColor = isMe ? 'rgba(18,140,126,0.30)' : '#ddd6fe';

  // ── Missing refEntityId — minimal safe fallback ─────────────────────────────
  if (!refEntityId) {
    return (
      <View style={[s.card, { backgroundColor: cardBg, borderColor }]}>
        <View style={s.headerRow}>
          <Text style={s.emoji}>🎙️</Text>
          <Text style={[s.label, isMe && s.labelMe]}>Voice Club</Text>
        </View>
      </View>
    );
  }

  // ── Room unavailable (deleted or not found) ─────────────────────────────────
  if (voiceRoomData === null || voiceRoomData === undefined) {
    return (
      <View style={[s.card, { backgroundColor: cardBg, borderColor }]}>
        <View style={s.headerRow}>
          <Text style={s.emoji}>🎙️</Text>
          <Text style={[s.labelSmall, isMe && s.labelMe]}>VOICE CLUB</Text>
        </View>
        <Text style={[s.unavailable, isMe && { color: '#6b7280' }]}>
          This Voice Club is no longer available
        </Text>
        {!!body && (
          <Text style={[s.note, isMe && { color: '#4b5563' }]}>{body}</Text>
        )}
      </View>
    );
  }

  // ── Full card ───────────────────────────────────────────────────────────────
  const isLive = voiceRoomData.status === 'LIVE';
  const emoji  = voiceRoomData.coverEmoji ?? '🎙️';

  const privacyText =
    voiceRoomData.privacy === 'PUBLIC'      ? '🌍 Public' :
    voiceRoomData.privacy === 'PRIVATE'     ? '🔒 Private' :
    voiceRoomData.privacy === 'INVITE_ONLY' ? '✉️ Invite Only' :
    null;

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={handleJoin}
      style={[s.card, { backgroundColor: cardBg, borderColor }]}
    >
      {/* Cover strip */}
      {voiceRoomData.coverImageUrl ? (
        <Image
          source={{ uri: voiceRoomData.coverImageUrl }}
          style={s.coverImage}
          resizeMode="cover"
        />
      ) : (
        <View style={[s.coverEmoji, { backgroundColor: isMe ? 'rgba(18,140,126,0.18)' : '#ede9fe' }]}>
          <Text style={s.coverEmojiText}>{emoji}</Text>
        </View>
      )}

      {/* Info */}
      <View style={s.info}>
        {/* Header row */}
        <View style={s.headerRow}>
          <Text style={[s.labelSmall, { color: '#7c3aed' }]}>🎙️ VOICE CLUB</Text>
          {isLive && (
            <View style={s.liveBadge}>
              <View style={s.liveDot} />
              <Text style={s.liveText}>LIVE</Text>
            </View>
          )}
        </View>

        {/* Title — server-provided, authoritative */}
        <Text style={[s.title, isMe && { color: '#111827' }]} numberOfLines={1}>
          {voiceRoomData.title}
        </Text>

        {/* Privacy + speaker count sub-line */}
        {(privacyText || voiceRoomData.maxSpeakers) ? (
          <Text style={s.sub} numberOfLines={1}>
            {[
              privacyText,
              voiceRoomData.maxSpeakers ? `Up to ${voiceRoomData.maxSpeakers} speakers` : null,
            ].filter(Boolean).join(' · ')}
          </Text>
        ) : null}

        {/* Optional note from sender */}
        {!!body && (
          <Text style={[s.note, isMe && { color: '#4b5563' }, { marginTop: 6 }]} numberOfLines={3}>
            {body}
          </Text>
        )}

        {/* Join button */}
        <TouchableOpacity
          onPress={handleJoin}
          style={[s.joinBtn, isLive && s.joinBtnLive]}
          activeOpacity={0.8}
        >
          <Ionicons
            name={isLive ? 'radio' : 'mic-outline'}
            size={14}
            color="#fff"
            style={{ marginRight: 5 }}
          />
          <Text style={s.joinBtnText}>
            {isLive ? 'Join Live Room' : 'Open Voice Club'}
          </Text>
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  card: {
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
    maxWidth: 260,
  },
  coverImage: {
    width: '100%',
    height: 60,
  },
  coverEmoji: {
    width: '100%',
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  coverEmojiText: {
    fontSize: 28,
  },
  info: {
    padding: 10,
    gap: 3,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  emoji: {
    fontSize: 18,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: '#7c3aed',
  },
  labelMe: {
    color: '#374151',
  },
  labelSmall: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
    color: '#7c3aed',
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#fef2f2',
    borderRadius: 20,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  liveDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: '#ef4444',
  },
  liveText: {
    fontSize: 8,
    fontWeight: '800',
    color: '#ef4444',
  },
  title: {
    fontSize: 13,
    fontWeight: '700',
    color: '#111827',
    lineHeight: 18,
  },
  sub: {
    fontSize: 10,
    color: '#9ca3af',
    marginTop: 1,
  },
  note: {
    fontSize: 11,
    fontStyle: 'italic',
    color: '#6b7280',
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.06)',
    paddingTop: 5,
  },
  unavailable: {
    fontSize: 11,
    color: '#9ca3af',
    marginTop: 2,
  },
  joinBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: '#7c3aed',
  },
  joinBtnLive: {
    backgroundColor: '#ef4444',
  },
  joinBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
});
