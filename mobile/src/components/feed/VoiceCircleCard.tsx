/**
 * Mobile VoiceCircleCard — story-circle style card for a live voice room.
 */
import { TouchableOpacity, View, Text, StyleSheet, Image } from 'react-native'
import { useRouter } from 'expo-router'
import { getAvatarUrl } from '@/lib/avatar'

export interface VoiceCircleData {
  id:               string
  title:            string
  coverEmoji?:      string | null
  coverImageUrl?:   string | null
  participantCount: number
}

interface Props {
  room:              VoiceCircleData
  participantCount?: number
}

export function VoiceCircleCard({ room, participantCount }: Props) {
  const router  = useRouter()
  const count   = participantCount ?? room.participantCount ?? 0
  const avSrc   = room.coverImageUrl ? getAvatarUrl(room.coverImageUrl) : null

  return (
    <TouchableOpacity
      onPress={() => router.push(`/voice/${room.id}` as any)}
      style={s.container}
      activeOpacity={0.7}
    >
      {/* Gradient ring wrapper */}
      <View style={s.ringOuter}>
        <View style={s.ringInner}>
          {avSrc ? (
            <Image source={{ uri: avSrc }} style={s.circleImg} />
          ) : (
            <View style={s.circle}>
              <Text style={s.emoji}>{room.coverEmoji ?? '🎙️'}</Text>
            </View>
          )}
        </View>

        {/* LIVE badge */}
        <View style={s.liveBadge}>
          <View style={s.liveDot} />
          <Text allowFontScaling={false} style={s.liveTxt}>LIVE</Text>
        </View>
      </View>

      {/* Title */}
      <Text allowFontScaling={false} style={s.title} numberOfLines={2}>
        {room.title}
      </Text>

      {/* Count */}
      {count > 0 && (
        <Text allowFontScaling={false} style={s.count}>
          🎙️ {count}
        </Text>
      )}
    </TouchableOpacity>
  )
}

const s = StyleSheet.create({
  container:  { width: 72, alignItems: 'center', gap: 5 },
  ringOuter:  {
    width: 64, height: 64,
    borderRadius: 32,
    // Simulate purple gradient ring with border
    borderWidth: 2.5,
    borderColor: '#9333ea',
    padding: 2,
    position: 'relative',
    backgroundColor: 'transparent',
  },
  ringInner:  { flex: 1, borderRadius: 30, overflow: 'hidden', backgroundColor: '#ede9fe' },
  circleImg:  { width: '100%', height: '100%' },
  circle:     { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'linear-gradient(135deg, #9333ea, #ec4899)' },
  emoji:      { fontSize: 28, lineHeight: 34 },
  liveBadge:  {
    position: 'absolute', bottom: -4, left: '50%',
    transform: [{ translateX: -18 }],
    flexDirection: 'row', alignItems: 'center', gap: 2,
    backgroundColor: '#ef4444',
    paddingHorizontal: 5, paddingVertical: 2,
    borderRadius: 8,
  },
  liveDot:    { width: 4, height: 4, borderRadius: 2, backgroundColor: '#fff' },
  liveTxt:    { color: '#fff', fontSize: 8, fontWeight: '900', letterSpacing: 0.5 },
  title:      { fontSize: 11, fontWeight: '600', color: '#374151', textAlign: 'center', lineHeight: 14 },
  count:      { fontSize: 10, color: '#9ca3af', textAlign: 'center' },
})
