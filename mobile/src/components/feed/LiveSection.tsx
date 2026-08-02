/**
 * Mobile LiveSection v3
 * All live sessions shown as cards.
 * Voice club card has large profile circle. Live class has emoji.
 * 1 session = full width. 2+ = horizontal scroll + +N more.
 */
import { useEffect, useState } from 'react'
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Ionicons } from '@expo/vector-icons'
import api from '@/lib/api'
import { getSocket } from '@/lib/socket'
import { LiveCard, type LiveCardData } from './LiveCard'

const VISIBLE_LIMIT = 2

export function LiveSection() {
  const queryClient = useQueryClient()
  const [counts,   setCounts]   = useState<Record<string, number>>({})
  const [expanded, setExpanded] = useState(false)

  const { data } = useQuery<LiveCardData[]>({
    queryKey: ['live-sessions'],
    queryFn: () => api.get('/posts/live').then(r => r.data.data as LiveCardData[]),
    staleTime: 30_000,
    refetchInterval: 60_000,
  })

  const liveSessions = (data ?? []).filter(s => s.liveData?.isLive !== false)

  useEffect(() => {
    const socket = getSocket()
    if (!socket) return
    const onLive = (card: LiveCardData) => {
      queryClient.setQueryData<LiveCardData[]>(['live-sessions'], old => {
        if (!old) return [card]
        if (old.some(p => p.refEntityId === card.refEntityId)) return old
        return [card, ...old]
      })
    }
    const onLiveEnded = ({ refEntityId }: { refEntityType: string; refEntityId: string }) => {
      queryClient.setQueryData<LiveCardData[]>(['live-sessions'], old =>
        old ? old.map(p =>
          p.refEntityId === refEntityId
            ? { ...p, liveData: { ...p.liveData, isLive: false } }
            : p
        ) : old
      )
    }
    const onLiveUpdate = ({ refEntityId, participantCount }: { refEntityType: string; refEntityId: string; participantCount: number }) => {
      setCounts(prev => ({ ...prev, [refEntityId]: participantCount }))
    }
    socket.on('feed:live',        onLive)
    socket.on('feed:live_ended',  onLiveEnded)
    socket.on('feed:live_update', onLiveUpdate)
    return () => {
      socket.off('feed:live',        onLive)
      socket.off('feed:live_ended',  onLiveEnded)
      socket.off('feed:live_update', onLiveUpdate)
    }
  }, [queryClient])

  if (liveSessions.length === 0) return null

  const total    = liveSessions.length
  const overflow = total - VISIBLE_LIMIT
  const visible  = expanded ? liveSessions : liveSessions.slice(0, VISIBLE_LIMIT)

  return (
    <View style={s.container}>
      {/* Header */}
      <View style={s.header}>
        <View style={s.headerLeft}>
          <View style={s.pulseDot}><View style={s.pulseDotInner} /></View>
          <Ionicons name="radio" size={13} color="#6b7280" />
          <Text allowFontScaling={false} style={s.headerTxt}>LIVE NOW</Text>
          <Text allowFontScaling={false} style={s.countBadge}>{total}</Text>
        </View>
        {overflow > 0 && (
          <TouchableOpacity onPress={() => setExpanded(v => !v)} style={s.moreBtn}>
            <Text allowFontScaling={false} style={s.moreTxt}>
              {expanded ? 'See less' : `+${overflow} more`}
            </Text>
            <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={13} color="#4f46e5" />
          </TouchableOpacity>
        )}
      </View>

      {/* Single card — full width */}
      {total === 1 && (
        <View style={s.singleCard}>
          <LiveCard card={liveSessions[0]} participantCount={counts[liveSessions[0].refEntityId]} />
        </View>
      )}

      {/* Multiple — horizontal scroll */}
      {total > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.scroll}>
          {visible.map(session => (
            <View key={session.id} style={s.cardWrapper}>
              <LiveCard card={session} participantCount={counts[session.refEntityId]} />
            </View>
          ))}
          {!expanded && overflow > 0 && (
            <TouchableOpacity onPress={() => setExpanded(true)} style={s.overflowTile} activeOpacity={0.7}>
              <Text allowFontScaling={false} style={s.overflowNum}>+{overflow}</Text>
              <Text allowFontScaling={false} style={s.overflowTxt}>more</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      )}
    </View>
  )
}

const s = StyleSheet.create({
  container:     { marginBottom: 8 },
  header:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, paddingHorizontal: 12 },
  headerLeft:    { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pulseDot:      { width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(239,68,68,0.3)', justifyContent: 'center', alignItems: 'center' },
  pulseDotInner: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#ef4444' },
  headerTxt:     { fontSize: 11, fontWeight: '800', color: '#6b7280', letterSpacing: 1 },
  countBadge:    { fontSize: 10, fontWeight: '700', color: '#fff', backgroundColor: '#ef4444', paddingHorizontal: 5, paddingVertical: 1, borderRadius: 8 },
  moreBtn:       { flexDirection: 'row', alignItems: 'center', gap: 3 },
  moreTxt:       { fontSize: 12, fontWeight: '700', color: '#4f46e5' },
  singleCard:    { paddingHorizontal: 12 },
  scroll:        { paddingHorizontal: 12, gap: 10 },
  cardWrapper:   { width: 270 },
  overflowTile:  { width: 72, borderRadius: 16, borderWidth: 2, borderColor: '#e5e7eb', borderStyle: 'dashed', backgroundColor: '#f9fafb', justifyContent: 'center', alignItems: 'center', gap: 4, minHeight: 100 },
  overflowNum:   { fontSize: 22, fontWeight: '900', color: '#4f46e5' },
  overflowTxt:   { fontSize: 10, fontWeight: '700', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 1 },
})
