/**
 * Mobile LiveCard v2
 * Voice Club → card with large profile circle inside
 * Live Class → card with cover emoji (no large circle)
 */
import { TouchableOpacity, View, Text, StyleSheet, Image } from 'react-native'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { getAvatarUrl } from '@/lib/avatar'

export interface LiveCardData {
  id:            string
  type:          'LIVE_ROOM_SHARE' | 'LIVE_CLASS_SHARE'
  refEntityId:   string
  authorId:      string
  author?:       { id: string; firstName: string; lastName: string; avatarUrl: string | null } | null
  liveData: {
    title:            string
    description?:     string | null
    coverEmoji?:      string
    coverImageUrl?:   string | null
    participantCount: number
    className?:       string | null
    isLive:           boolean
  }
}

interface Props {
  card:              LiveCardData
  participantCount?: number
}

export function LiveCard({ card, participantCount }: Props) {
  const router   = useRouter()
  const liveData = card.liveData
  const isVoice  = card.type === 'LIVE_ROOM_SHARE'
  const count    = participantCount ?? liveData.participantCount ?? 0
  const avSrc    = getAvatarUrl(card.author?.avatarUrl)
  const initials = card.author
    ? `${card.author.firstName?.charAt(0) ?? ''}${card.author.lastName?.charAt(0) ?? ''}`.toUpperCase() || '?'
    : '?'

  const handleJoin = () => {
    if (isVoice) router.push(`/voice/${card.refEntityId}` as any)
    else         router.push(`/live-class/${card.refEntityId}` as any)
  }

  return (
    <TouchableOpacity
      onPress={handleJoin}
      activeOpacity={0.85}
      style={[s.card, { backgroundColor: isVoice ? '#7c3aed' : '#dc2626' }]}
    >
      {/* LIVE badge */}
      <View style={s.liveBadge}>
        <View style={s.liveDot} />
        <Text allowFontScaling={false} style={s.liveTxt}>LIVE</Text>
      </View>

      {/* Type badge */}
      <View style={s.typeBadge}>
        <Ionicons name={isVoice ? 'mic' : 'videocam'} size={11} color="rgba(255,255,255,0.9)" />
        <Text allowFontScaling={false} style={s.typeTxt}>
          {isVoice ? 'Voice Club' : 'Live Class'}
        </Text>
        {liveData.className ? (
          <Text allowFontScaling={false} style={s.classTxt}> · {liveData.className}</Text>
        ) : null}
      </View>

      {isVoice ? (
        /* ── VOICE CLUB — room cover circle (emoji or cover image) ─────── */
        <View style={s.voiceContent}>
          {/* Room identity circle: coverImageUrl takes priority, else coverEmoji */}
          <View style={s.bigCircleOuter}>
            <View style={s.bigCircleInner}>
              {liveData.coverImageUrl
                ? <Image source={{ uri: liveData.coverImageUrl }} style={s.bigCircleImg} />
                : <Text style={s.bigCircleEmoji}>{liveData.coverEmoji ?? '🎙️'}</Text>
              }
            </View>
          </View>

          {/* Room info beside circle */}
          <View style={{ flex: 1 }}>
            <Text allowFontScaling={false} style={s.title} numberOfLines={2}>
              {liveData.title}
            </Text>
            {liveData.description ? (
              <Text allowFontScaling={false} style={s.desc} numberOfLines={2}>
                {liveData.description}
              </Text>
            ) : null}
          </View>
        </View>
      ) : (
        /* ── LIVE CLASS — cover emoji in a red circle ────────────────── */
        <View style={s.classContent}>
          <View style={s.classCircle}>
            <Text style={s.classCircleEmoji}>{liveData.coverEmoji ?? '📹'}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text allowFontScaling={false} style={s.title} numberOfLines={2}>
              {liveData.title}
            </Text>
            {liveData.description ? (
              <Text allowFontScaling={false} style={s.desc} numberOfLines={1}>
                {liveData.description}
              </Text>
            ) : null}
          </View>
        </View>
      )}

      {/* Footer */}
      <View style={s.footer}>
        <View style={s.hostRow}>
          {/* Small avatar — only for live class (voice already has big circle) */}
          {!isVoice && (
            <View style={s.smallAv}>
              {avSrc
                ? <Image source={{ uri: avSrc }} style={s.smallAvImg} />
                : <Text style={s.smallAvTxt}>{initials}</Text>}
            </View>
          )}
          <Text allowFontScaling={false} style={s.hostName} numberOfLines={1}>
            {card.author?.firstName} {card.author?.lastName}
          </Text>
          {count > 0 && (
            <>
              <Text style={s.dot}>·</Text>
              <Ionicons name="people-outline" size={11} color="rgba(255,255,255,0.8)" />
              <Text allowFontScaling={false} style={s.countTxt}>{count}</Text>
            </>
          )}
        </View>

        <TouchableOpacity onPress={handleJoin} style={s.joinBtn} activeOpacity={0.8}>
          <Text allowFontScaling={false} style={s.joinTxt}>Join</Text>
          <Ionicons name="arrow-forward" size={12} color="#111" />
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  )
}

const s = StyleSheet.create({
  card:             { borderRadius: 16, padding: 14, overflow: 'hidden' },
  liveBadge:        { position: 'absolute', top: 12, right: 12, flexDirection: 'row', alignItems: 'center', gap: 4, zIndex: 2 },
  liveDot:          { width: 7, height: 7, borderRadius: 4, backgroundColor: '#fff' },
  liveTxt:          { color: '#fff', fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  typeBadge:        { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20, marginBottom: 12 },
  typeTxt:          { color: 'rgba(255,255,255,0.9)', fontSize: 11, fontWeight: '700' },
  classTxt:         { color: 'rgba(255,255,255,0.7)', fontSize: 11 },
  // Voice content
  voiceContent:     { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  bigCircleOuter:   { position: 'relative', flexShrink: 0 },
  bigCircleInner:   { width: 60, height: 60, borderRadius: 30, borderWidth: 2, borderColor: 'rgba(255,255,255,0.6)', overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.15)', justifyContent: 'center', alignItems: 'center' },
  bigCircleImg:     { width: 60, height: 60, borderRadius: 30 },
  bigCircleEmoji:   { fontSize: 30, lineHeight: 36 },
  // Class content
  classContent:     { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 12 },
  classCircle:      { width: 60, height: 60, borderRadius: 30, borderWidth: 2, borderColor: 'rgba(255,255,255,0.6)', backgroundColor: 'rgba(255,255,255,0.15)', justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  classCircleEmoji: { fontSize: 30, lineHeight: 36 },
  // Shared
  title:            { color: '#fff', fontSize: 14, fontWeight: '800', lineHeight: 19 },
  desc:             { color: 'rgba(255,255,255,0.7)', fontSize: 12, marginTop: 3, lineHeight: 16 },
  footer:           { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  hostRow:          { flexDirection: 'row', alignItems: 'center', gap: 5, flex: 1, minWidth: 0 },
  smallAv:          { width: 20, height: 20, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.3)', justifyContent: 'center', alignItems: 'center', overflow: 'hidden', flexShrink: 0 },
  smallAvImg:       { width: 20, height: 20, borderRadius: 10 },
  smallAvTxt:       { color: '#fff', fontSize: 7, fontWeight: '800' },
  hostName:         { color: 'rgba(255,255,255,0.8)', fontSize: 12, flex: 1 },
  dot:              { color: 'rgba(255,255,255,0.4)', fontSize: 10 },
  countTxt:         { color: 'rgba(255,255,255,0.8)', fontSize: 12 },
  joinBtn:          { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#fff', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, flexShrink: 0 },
  joinTxt:          { color: '#111', fontSize: 12, fontWeight: '800' },
})
