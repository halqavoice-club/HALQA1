/**
 * HALQA Mobile — LiveClassQuranPanel
 * Host selects surah/ayah → syncs to all students via socket.
 * Students receive liveclass:quran_position and scroll to the ayah.
 * Uses the public api.quran.com v4 API (no key required).
 */
import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, FlatList,
  StyleSheet, ActivityIndicator, Modal, ScrollView
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { showMessage } from 'react-native-flash-message';
import api from '@/lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────
export interface QuranPosition {
  surahNumber: number;
  ayahNumber: number;
}

interface Surah {
  id: number;
  name_simple: string;
  name_arabic: string;
  verses_count: number;
  revelation_place: 'makkah' | 'madinah';
}

interface Verse {
  id: number;
  verse_number: number;
  text_uthmani: string; // Arabic Uthmani script
}

interface Props {
  isHost: boolean;
  liveClassId: string;
  syncedPosition: QuranPosition | null; // received from socket (students)
  onPositionChange: (pos: QuranPosition) => void; // called by host to broadcast
}

// ─── Fetch surahs list ────────────────────────────────────────────────────────
function useSurahs() {
  return useQuery<Surah[]>({
    queryKey: ['quran-surahs'],
    queryFn: async () => {
      const res = await fetch('https://api.quran.com/api/v4/chapters?language=en');
      const json = await res.json();
      return json.chapters as Surah[];
    },
    staleTime: 24 * 60 * 60 * 1000, // 24h — surahs don't change
    retry: 2,
  });
}

// ─── Fetch verses for a surah ─────────────────────────────────────────────────
function useVerses(surahId: number | null) {
  return useQuery<Verse[]>({
    queryKey: ['quran-verses', surahId],
    queryFn: async () => {
      const res = await fetch(
        `https://api.quran.com/api/v4/quran/verses/uthmani?chapter_number=${surahId}`
      );
      const json = await res.json();
      return json.verses as Verse[];
    },
    enabled: !!surahId,
    staleTime: 24 * 60 * 60 * 1000,
    retry: 2,
  });
}

// ─── Surah Picker Modal ───────────────────────────────────────────────────────
function SurahPicker({ visible, onSelect, onClose }: {
  visible: boolean;
  onSelect: (surah: Surah) => void;
  onClose: () => void;
}) {
  const { data: surahs = [], isLoading } = useSurahs();

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#0f0f23' }}>
        <View style={sp.header}>
          <Text style={sp.title}>📖 Select Surah</Text>
          <TouchableOpacity onPress={onClose}>
            <Ionicons name="close" size={24} color="#9ca3af" />
          </TouchableOpacity>
        </View>
        {isLoading ? (
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
            <ActivityIndicator color="#4f46e5" size="large" />
          </View>
        ) : (
          <FlatList
            data={surahs}
            keyExtractor={s => String(s.id)}
            contentContainerStyle={{ paddingBottom: 40 }}
            renderItem={({ item: s }) => (
              <TouchableOpacity style={sp.row} onPress={() => onSelect(s)}>
                <View style={sp.num}><Text style={sp.numText}>{s.id}</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={sp.surahName}>{s.name_simple}</Text>
                  <Text style={sp.surahMeta}>{s.verses_count} ayahs · {s.revelation_place}</Text>
                </View>
                <Text style={sp.arabic}>{s.name_arabic}</Text>
              </TouchableOpacity>
            )}
          />
        )}
      </View>
    </Modal>
  );
}

const sp = StyleSheet.create({
  header:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: '#1e1e3a' },
  title:     { color: '#fff', fontSize: 17, fontWeight: '700' },
  row:       { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderBottomWidth: 1, borderBottomColor: '#1e1e3a11' },
  num:       { width: 36, height: 36, borderRadius: 18, backgroundColor: '#4f46e522', alignItems: 'center', justifyContent: 'center' },
  numText:   { color: '#a5b4fc', fontSize: 12, fontWeight: '700' },
  surahName: { color: '#e5e7eb', fontSize: 14, fontWeight: '600' },
  surahMeta: { color: '#6b7280', fontSize: 11, marginTop: 2, textTransform: 'capitalize' },
  arabic:    { color: '#a5b4fc', fontSize: 18, fontFamily: 'System' },
});

// ─── Ayah Row ─────────────────────────────────────────────────────────────────
function AyahRow({ verse, isHighlighted, onSelect }: {
  verse: Verse; isHighlighted: boolean; onSelect?: () => void;
}) {
  return (
    <TouchableOpacity
      style={[ar.row, isHighlighted && ar.rowHighlighted]}
      onPress={onSelect}
      activeOpacity={onSelect ? 0.7 : 1}
    >
      <View style={ar.numCircle}>
        <Text style={ar.num}>{verse.verse_number}</Text>
      </View>
      <Text style={ar.arabic}>{verse.text_uthmani}</Text>
    </TouchableOpacity>
  );
}

const ar = StyleSheet.create({
  row:             { flexDirection: 'row', gap: 12, padding: 12, borderBottomWidth: 1, borderBottomColor: '#1e1e3a33', alignItems: 'flex-start' },
  rowHighlighted:  { backgroundColor: '#4f46e518', borderLeftWidth: 3, borderLeftColor: '#4f46e5' },
  numCircle:       { width: 28, height: 28, borderRadius: 14, backgroundColor: '#1e1e3a', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 4 },
  num:             { color: '#6b7280', fontSize: 10, fontWeight: '700' },
  arabic:          { flex: 1, color: '#e5e7eb', fontSize: 22, textAlign: 'right', lineHeight: 42, fontFamily: 'System' },
});

// ─── Main Panel ───────────────────────────────────────────────────────────────
export function LiveClassQuranPanel({ isHost, liveClassId, syncedPosition, onPositionChange }: Props) {
  const [selectedSurah, setSelectedSurah] = useState<Surah | null>(null);
  const [showSurahPicker, setShowSurahPicker] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const listRef = useRef<FlatList>(null);

  const { data: verses = [], isLoading: versesLoading } = useVerses(selectedSurah?.id ?? null);

  // When a sync position arrives (student), scroll to the ayah
  useEffect(() => {
    if (!syncedPosition || !verses.length || isHost) return;
    const idx = verses.findIndex((v: Verse) => v.verse_number === syncedPosition.ayahNumber);
    if (idx >= 0) {
      setTimeout(() => listRef.current?.scrollToIndex({ index: idx, animated: true }), 300);
    }
  }, [syncedPosition, verses, isHost]);

  // Auto-load the synced surah if we don't have it selected yet
  useEffect(() => {
    if (!syncedPosition || isHost) return;
    // If the surah differs from what's selected, we need to show it
    if (selectedSurah?.id !== syncedPosition.surahNumber) {
      // We don't have the surah object but we can show the verse list if we set it
      setSelectedSurah({ id: syncedPosition.surahNumber } as Surah);
    }
  }, [syncedPosition?.surahNumber]);

  const handleSelectSurah = (surah: Surah) => {
    setSelectedSurah(surah);
    setShowSurahPicker(false);
  };

  const handleSelectAyah = useCallback(async (verse: Verse) => {
    if (!isHost || !selectedSurah) return;
    const pos: QuranPosition = {
      surahNumber: selectedSurah.id,
      ayahNumber:  verse.verse_number,
    };
    setSyncing(true);
    try {
      await api.post(`/live-classes/${liveClassId}/quran-position`, pos);
      onPositionChange(pos);
      showMessage({ message: `📖 Synced to ${selectedSurah.name_simple ?? `Surah ${selectedSurah.id}`}:${verse.verse_number}`, type: 'success', duration: 1500 });
    } catch (e: any) {
      showMessage({ message: e?.response?.data?.message ?? 'Sync failed', type: 'danger' });
    } finally {
      setSyncing(false);
    }
  }, [isHost, selectedSurah, liveClassId, onPositionChange]);

  const isAyahHighlighted = (verse: Verse) =>
    syncedPosition?.surahNumber === selectedSurah?.id &&
    syncedPosition?.ayahNumber === verse.verse_number;

  return (
    <View style={{ flex: 1 }}>
      {/* Toolbar */}
      <View style={qp.toolbar}>
        <TouchableOpacity style={qp.surahBtn} onPress={() => setShowSurahPicker(true)}>
          <Ionicons name="book-outline" size={16} color="#a5b4fc" />
          <Text style={qp.surahBtnText} numberOfLines={1}>
            {selectedSurah?.name_simple ?? 'Select Surah'}
          </Text>
          <Ionicons name="chevron-down" size={14} color="#6b7280" />
        </TouchableOpacity>

        {/* Sync indicator */}
        {syncedPosition && (
          <View style={qp.syncBadge}>
            <View style={qp.syncDot} />
            <Text style={qp.syncText}>
              {syncedPosition.surahNumber}:{syncedPosition.ayahNumber}
            </Text>
          </View>
        )}

        {syncing && <ActivityIndicator color="#4f46e5" size="small" />}
      </View>

      {/* Instructions for host */}
      {isHost && selectedSurah && verses.length > 0 && (
        <Text style={qp.hint}>Tap an ayah to sync all students to it</Text>
      )}

      {/* Verse list */}
      {!selectedSurah ? (
        <View style={qp.empty}>
          <Text style={{ fontSize: 40 }}>📖</Text>
          <Text style={qp.emptyText}>
            {isHost ? 'Select a surah to begin' : 'Waiting for teacher to open Quran…'}
          </Text>
        </View>
      ) : versesLoading ? (
        <View style={qp.empty}><ActivityIndicator color="#4f46e5" size="large" /></View>
      ) : (
        <FlatList
          ref={listRef}
          data={verses}
          keyExtractor={v => String(v.id)}
          contentContainerStyle={{ paddingBottom: 40 }}
          onScrollToIndexFailed={() => {}}
          renderItem={({ item: verse }) => (
            <AyahRow
              verse={verse}
              isHighlighted={isAyahHighlighted(verse)}
              onSelect={isHost ? () => handleSelectAyah(verse) : undefined}
            />
          )}
        />
      )}

      {/* Surah picker */}
      <SurahPicker
        visible={showSurahPicker}
        onSelect={handleSelectSurah}
        onClose={() => setShowSurahPicker(false)}
      />
    </View>
  );
}

const qp = StyleSheet.create({
  toolbar:     { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderBottomWidth: 1, borderBottomColor: '#1e1e3a' },
  surahBtn:    { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#1e1e3a', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  surahBtnText:{ flex: 1, color: '#a5b4fc', fontSize: 13, fontWeight: '600' },
  syncBadge:   { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#4f46e522', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  syncDot:     { width: 6, height: 6, borderRadius: 3, backgroundColor: '#4f46e5' },
  syncText:    { color: '#a5b4fc', fontSize: 11, fontWeight: '700' },
  hint:        { color: '#6b7280', fontSize: 11, textAlign: 'center', paddingVertical: 6, fontStyle: 'italic' },
  empty:       { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingTop: 40 },
  emptyText:   { color: '#6b7280', fontSize: 14, textAlign: 'center' },
});

