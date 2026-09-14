/**
 * DmMediaBubble (React Native) — renders DM message content for all media types.
 * Mirrors frontend/src/components/dm/DmMediaBubble.tsx exactly.
 *
 * Supported types: TEXT | IMAGE | VIDEO | GIF | VOICE | AUDIO | FILE
 */
import React, { useState, useRef, useCallback } from 'react';
import {
  View, Text, Image, TouchableOpacity, Linking,
  StyleSheet, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Audio, Video as ExpoVideo, ResizeMode, type AVPlaybackStatus } from 'expo-av';
import { getBaseURL } from '@/lib/api';
import { VoiceRoomShareCard } from '@/src/components/chat/VoiceRoomShareCard';

// ─── Backend base URL (strips /api/v1 suffix) ─────────────────────────────────
const BACKEND_BASE = getBaseURL().replace('/api/v1', '');

/** Resolve any URL — relative backend paths get the backend origin prepended */
function resolveUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith('http')) return url;
  // Relative path like /uploads/media/uuid.jpg
  return `${BACKEND_BASE}${url}`;
}

// ─── Types ─────────────────────────────────────────────────────────────────────
export interface DmMsgMedia {
  body?: string | null;
  msgType?: string;
  mediaUrl?: string | null;
  mimeType?: string | null;
  fileSize?: number | null;
  fileName?: string | null;
  duration?: number | null;
  width?: number | null;
  height?: number | null;
  thumbnail?: string | null;
  // Phase 6: structured entity reference (VOICE_ROOM_SHARE)
  refEntityType?: string | null;
  refEntityId?: string | null;
  voiceRoomData?: {
    id: string;
    title: string;
    coverEmoji?: string | null;
    coverImageUrl?: string | null;
    privacy?: string | null;
    status?: string | null;
    hostId?: string | null;
    maxSpeakers?: number | null;
  } | null;
}

interface Props {
  msg: DmMsgMedia;
  isMe: boolean;
}

// ─── Proportional image component ────────────────────────────────────────────
function ProportionalImage({ uri, style }: { uri: string; style?: any }) {
  const [dims, setDims] = React.useState<{ width: number; height: number } | null>(null);
  const MAX_W = 240;
  const MAX_H = 360;

  React.useEffect(() => {
    Image.getSize(uri, (w, h) => {
      // Scale to fit within MAX_W × MAX_H while maintaining aspect ratio
      const ratio = Math.min(MAX_W / w, MAX_H / h, 1);
      setDims({ width: Math.round(w * ratio), height: Math.round(h * ratio) });
    }, () => {
      setDims({ width: MAX_W, height: MAX_W }); // fallback square
    });
  }, [uri]);

  if (!dims) {
    return <View style={{ width: MAX_W, height: 180, borderRadius: 10, backgroundColor: '#e5e7eb' }} />;
  }

  return (
    <Image
      source={{ uri }}
      style={[{ width: dims.width, height: dims.height, borderRadius: 10 }, style]}
      resizeMode="contain"
    />
  );
}
function fmtBytes(bytes?: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function fmtDur(secs?: number | null): string {
  if (!secs) return '0:00';
  const m = Math.floor(secs / 60), s = secs % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ─── Audio player ──────────────────────────────────────────────────────────────
function AudioPlayer({ url, duration, isMe, isVoice }: {
  url: string; duration?: number | null; isMe: boolean; isVoice?: boolean;
}) {
  const soundRef = useRef<Audio.Sound | null>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [loading, setLoading] = useState(false);
  const total = duration ?? 0;

  const toggle = useCallback(async () => {
    try {
      if (playing) {
        await soundRef.current?.pauseAsync();
        setPlaying(false);
        return;
      }
      setLoading(true);
      if (!soundRef.current) {
        await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
        const { sound } = await Audio.Sound.createAsync(
          { uri: url },
          { shouldPlay: true },
          (status: AVPlaybackStatus) => {
            if (status.isLoaded) {
              setCurrent(Math.floor((status.positionMillis ?? 0) / 1000));
              if (status.didJustFinish) { setPlaying(false); setCurrent(0); soundRef.current = null; }
            }
          }
        );
        soundRef.current = sound;
      } else {
        await soundRef.current.playAsync();
      }
      setPlaying(true);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [url, playing]);

  const pct = total > 0 ? (current / total) * 100 : 0;
  const trackColor = isMe ? '#128c7e' : '#9ca3af';
  const fillColor  = isMe ? '#25d366' : '#374151';

  return (
    <View style={[s.audioRow, isMe && { flexDirection: 'row-reverse' }]}>
      <TouchableOpacity onPress={toggle} style={[s.playBtn, { backgroundColor: isMe ? '#25d366' : '#e5e7eb' }]}>
        {loading
          ? <ActivityIndicator size="small" color={isMe ? '#fff' : '#374151'} />
          : <Ionicons name={playing ? 'pause' : 'play'} size={18} color={isMe ? '#fff' : '#374151'} style={{ marginLeft: playing ? 0 : 2 }} />
        }
      </TouchableOpacity>
      <View style={{ flex: 1, gap: 3 }}>
        <View style={[s.track, { backgroundColor: trackColor }]}>
          <View style={[s.fill, { width: `${pct}%` as any, backgroundColor: fillColor }]} />
        </View>
        <View style={s.audioMeta}>
          <Ionicons name={isVoice ? 'mic' : 'musical-notes'} size={11} color={isMe ? '#128c7e' : '#9ca3af'} />
          <Text style={[s.audioDur, { color: isMe ? '#128c7e' : '#9ca3af' }]}>
            {fmtDur(playing || current > 0 ? current : total)}
          </Text>
        </View>
      </View>
    </View>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────
export function DmMediaBubble({ msg, isMe }: Props) {
  const { msgType = 'TEXT', mimeType, fileSize, fileName, duration, body } = msg;
  // Always resolve through resolveUrl so relative /uploads/… paths get the backend origin
  const mediaUrl = resolveUrl(msg.mediaUrl);
  const thumbUrl = resolveUrl(msg.thumbnail);

  // Phase 6: VOICE_ROOM_SHARE — render structured Voice Club card using server-authoritative data.
  // Must be checked before the switch to avoid hook-ordering issues (no hooks after this return).
  if (msgType === 'VOICE_ROOM_SHARE') {
    return (
      <VoiceRoomShareCard
        refEntityId={msg.refEntityId}
        voiceRoomData={msg.voiceRoomData}
        body={body}
        isMe={isMe}
      />
    );
  }

  // Legacy TEXT or fallback
  if (!msgType || msgType === 'TEXT') {
    if (!body) return null;
    return <Text style={[s.bodyText, isMe && s.bodyTextMe]}>{body}</Text>;
  }

  switch (msgType) {
    case 'IMAGE':
    case 'GIF': {
      if (!mediaUrl) return null;
      return (
        <View>
          <ProportionalImage uri={mediaUrl} />
          {msgType === 'GIF' && (
            <View style={s.gifBadge}><Text style={s.gifText}>GIF</Text></View>
          )}
        </View>
      );
    }

    case 'VIDEO': {
      if (!mediaUrl) return null;
      return (
        <View>
          <View style={s.videoWrap}>
            <ExpoVideo
              source={{ uri: mediaUrl }}
              style={s.video}
              useNativeControls
              resizeMode={ResizeMode.CONTAIN}
              posterSource={thumbUrl ? { uri: thumbUrl } : undefined}
            />
            {duration && (
              <View style={s.durBadge}><Text style={s.durText}>{fmtDur(duration)}</Text></View>
            )}
          </View>
          {/* Download / open in external player */}
          <TouchableOpacity
            style={s.videoDownload}
            onPress={() => Linking.openURL(mediaUrl).catch(() => {})}
            activeOpacity={0.7}
          >
            <Ionicons name="download-outline" size={14} color="#6b7280" />
            <Text style={s.videoDownloadText}>{fileName || 'Download video'}</Text>
          </TouchableOpacity>
        </View>
      );
    }

    case 'VOICE':
      if (!mediaUrl) return null;
      return (
        <View>
          <AudioPlayer url={mediaUrl} duration={duration} isMe={isMe} isVoice />
          <TouchableOpacity
            style={s.audioDownload}
            onPress={() => Linking.openURL(mediaUrl).catch(() => {})}
            activeOpacity={0.7}
          >
            <Ionicons name="download-outline" size={12} color="#9ca3af" />
            <Text style={s.audioDownloadText}>Save voice message</Text>
          </TouchableOpacity>
        </View>
      );

    case 'AUDIO':
      if (!mediaUrl) return null;
      return (
        <View>
          {fileName && <Text style={[s.fileName, isMe && { color: '#374151' }]} numberOfLines={1}>{fileName}</Text>}
          <AudioPlayer url={mediaUrl} duration={duration} isMe={isMe} />
          <TouchableOpacity
            style={s.audioDownload}
            onPress={() => Linking.openURL(mediaUrl).catch(() => {})}
            activeOpacity={0.7}
          >
            <Ionicons name="download-outline" size={12} color="#9ca3af" />
            <Text style={s.audioDownloadText}>{fileName ? `Save "${fileName}"` : 'Save audio'}</Text>
          </TouchableOpacity>
        </View>
      );

    case 'FILE': {
      if (!mediaUrl) return null;
      const isImg = /\.(jpe?g|png|gif|webp)/i.test(mediaUrl);
      const isPdf = mimeType?.includes('pdf') || fileName?.endsWith('.pdf');
      const iconName: any = isPdf ? 'document-text-outline' : isImg ? 'image-outline' : 'attach-outline';
      return (
        <TouchableOpacity
          style={[s.fileCard, isMe && s.fileCardMe]}
          onPress={() => Linking.openURL(mediaUrl).catch(() => {})}
          activeOpacity={0.8}
        >
          <View style={[s.fileIcon, { backgroundColor: isMe ? '#dcf8c6' : '#e5e7eb' }]}>
            <Ionicons name={iconName} size={22} color={isMe ? '#128c7e' : '#6b7280'} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[s.fileCardName, isMe && { color: '#111827' }]} numberOfLines={1}>
              {fileName || 'File'}
            </Text>
            {fileSize ? <Text style={s.fileCardSize}>{fmtBytes(fileSize)}</Text> : null}
          </View>
          <Ionicons name="download-outline" size={18} color={isMe ? '#128c7e' : '#9ca3af'} />
        </TouchableOpacity>
      );
    }

    default:
      return body ? <Text style={[s.bodyText, isMe && s.bodyTextMe]}>{body}</Text> : null;
  }
}

// ─── Styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  bodyText:   { fontSize: 15, color: '#111827', lineHeight: 21 },
  bodyTextMe: { color: '#111827' },
  gifBadge:   { position: 'absolute', top: 6, left: 6, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 },
  gifText:    { color: '#fff', fontSize: 10, fontWeight: '800' },
  videoWrap:  { borderRadius: 10, overflow: 'hidden', position: 'relative', backgroundColor: '#000' },
  video:      { width: 240, height: 200 },
  durBadge:   { position: 'absolute', bottom: 6, left: 6, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 },
  durText:    { color: '#fff', fontSize: 10, fontWeight: '600' },
  videoDownload: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingTop: 5, paddingHorizontal: 2 },
  videoDownloadText: { fontSize: 11, color: '#6b7280', flex: 1 },
  audioRow:   { flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 160, maxWidth: 220 },
  playBtn:    { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  track:      { height: 4, borderRadius: 2, overflow: 'hidden', backgroundColor: '#9ca3af' },
  fill:       { height: '100%' as any, borderRadius: 2 },
  audioMeta:  { flexDirection: 'row', alignItems: 'center', gap: 3 },
  audioDur:   { fontSize: 11 },
  fileName:   { fontSize: 11, color: '#9ca3af', marginBottom: 4, maxWidth: 180 },
  audioDownload: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 5 },
  audioDownloadText: { fontSize: 10, color: '#9ca3af' },
  fileCard:   { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#f3f4f6', borderRadius: 12, padding: 10, maxWidth: 220, minWidth: 160 },
  fileCardMe: { backgroundColor: 'rgba(255,255,255,0.5)' },
  fileIcon:   { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  fileCardName:{ fontSize: 13, fontWeight: '600', color: '#374151', flex: 1 },
  fileCardSize:{ fontSize: 10, color: '#9ca3af', marginTop: 1 },
});
