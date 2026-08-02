'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { cn } from '@/lib/utils'
import { BookOpen, ChevronLeft, ChevronRight, Search, Loader2 } from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────
interface Surah {
  number: number
  englishName: string
  name: string               // Arabic name
  numberOfAyahs: number
  revelationType: string
}

interface Ayah {
  numberInSurah: number
  text: string               // Arabic text
}

interface Translation {
  numberInSurah: number
  text: string               // English translation
}

export interface QuranPosition {
  surahNumber: number
  ayahNumber:  number
}

interface Props {
  isHost:    boolean
  liveClassId: string
  /** position broadcast from socket (for students) */
  syncedPosition?: QuranPosition | null
  /** host calls this to broadcast to students */
  onPositionChange?: (pos: QuranPosition) => void
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function cleanTranslation(text: string) {
  // Remove footnote numbers like (1) or [1]
  return text.replace(/\s*[\(\[]\d+[\)\]]/g, '').trim()
}

// ─── Component ────────────────────────────────────────────────────────────────
export function LiveClassQuranPanel({ isHost, liveClassId, syncedPosition, onPositionChange }: Props) {
  const [surahNum,  setSurahNum]  = useState(1)
  const [ayahNum,   setAyahNum]   = useState(1)
  const [showPicker, setShowPicker] = useState(false)
  const [search,    setSearch]    = useState('')

  // Sync students to host position
  useEffect(() => {
    if (!isHost && syncedPosition) {
      setSurahNum(syncedPosition.surahNumber)
      setAyahNum(syncedPosition.ayahNumber)
    }
  }, [syncedPosition, isHost])

  // ── Fetch surah list ────────────────────────────────────────────────────────
  const { data: surahs = [] } = useQuery<Surah[]>({
    queryKey: ['quran-surahs'],
    queryFn: () =>
      fetch('https://api.alquran.cloud/v1/surah')
        .then(r => r.json())
        .then(d => d.data as Surah[]),
    staleTime: Infinity,
  })

  // ── Fetch current surah (Arabic + English) ─────────────────────────────────
  const { data: arabicSurah, isLoading: loadingArabic } = useQuery({
    queryKey: ['quran-surah', surahNum, 'arabic'],
    queryFn:  () =>
      fetch(`https://api.alquran.cloud/v1/surah/${surahNum}`)
        .then(r => r.json())
        .then(d => d.data.ayahs as Ayah[]),
    staleTime: 10 * 60 * 1000,
    enabled: !!surahNum,
  })

  const { data: engSurah, isLoading: loadingEng } = useQuery({
    queryKey: ['quran-surah', surahNum, 'en.sahih'],
    queryFn:  () =>
      fetch(`https://api.alquran.cloud/v1/surah/${surahNum}/en.sahih`)
        .then(r => r.json())
        .then(d => d.data.ayahs as Translation[]),
    staleTime: 10 * 60 * 1000,
    enabled: !!surahNum,
  })

  const isLoading   = loadingArabic || loadingEng
  const currentSurah = surahs.find(s => s.number === surahNum)
  const totalAyahs   = currentSurah?.numberOfAyahs ?? 1

  const arabicText = arabicSurah?.find(a => a.numberInSurah === ayahNum)?.text ?? ''
  const engText    = engSurah?.find(a => a.numberInSurah === ayahNum)?.text ?? ''

  // ── Navigation ──────────────────────────────────────────────────────────────
  const navigate = useCallback((newSurah: number, newAyah: number) => {
    setSurahNum(newSurah)
    setAyahNum(newAyah)
    if (isHost && onPositionChange) {
      onPositionChange({ surahNumber: newSurah, ayahNumber: newAyah })
    }
  }, [isHost, onPositionChange])

  const prevAyah = () => {
    if (ayahNum > 1) {
      navigate(surahNum, ayahNum - 1)
    } else if (surahNum > 1) {
      const prev = surahs.find(s => s.number === surahNum - 1)
      if (prev) navigate(prev.number, prev.numberOfAyahs)
    }
  }

  const nextAyah = () => {
    if (ayahNum < totalAyahs) {
      navigate(surahNum, ayahNum + 1)
    } else if (surahNum < 114) {
      navigate(surahNum + 1, 1)
    }
  }

  const filteredSurahs = surahs.filter(s =>
    !search ||
    s.englishName.toLowerCase().includes(search.toLowerCase()) ||
    s.number.toString().includes(search)
  )

  return (
    <div className="p-4 bg-emerald-950/40 border border-emerald-700/40 rounded-xl space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-emerald-400" />
          <span className="text-xs font-bold text-emerald-400">Quran Panel</span>
          {!isHost && (
            <span className="text-[10px] text-emerald-600 bg-emerald-900/40 px-1.5 py-0.5 rounded-full">
              Synced with teacher
            </span>
          )}
        </div>

        {/* Surah picker button */}
        {isHost && (
          <button
            onClick={() => setShowPicker(v => !v)}
            className="text-xs text-emerald-400 hover:text-emerald-300 bg-emerald-900/30 hover:bg-emerald-900/60 px-2 py-1 rounded-lg transition-colors flex items-center gap-1"
          >
            <Search className="w-3 h-3" />
            {currentSurah ? `${surahNum}. ${currentSurah.englishName}` : 'Select Surah'}
          </button>
        )}
        {!isHost && currentSurah && (
          <span className="text-xs text-emerald-500">{surahNum}. {currentSurah.englishName}</span>
        )}
      </div>

      {/* Surah picker dropdown */}
      {showPicker && isHost && (
        <div className="bg-gray-900 border border-emerald-800/50 rounded-xl overflow-hidden">
          <div className="p-2 border-b border-emerald-800/30">
            <input
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search surah…"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder-gray-500 outline-none focus:border-emerald-500"
            />
          </div>
          <div className="max-h-48 overflow-y-auto">
            {filteredSurahs.map(s => (
              <button
                key={s.number}
                onClick={() => { navigate(s.number, 1); setShowPicker(false); setSearch('') }}
                className={cn(
                  'w-full flex items-center justify-between px-3 py-2 text-xs hover:bg-emerald-900/30 transition-colors',
                  s.number === surahNum ? 'bg-emerald-900/40 text-emerald-300' : 'text-gray-300'
                )}
              >
                <span>{s.number}. {s.englishName}</span>
                <span className="text-gray-500 text-[11px]">{s.numberOfAyahs} ayahs</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Ayah display */}
      {isLoading ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="w-5 h-5 text-emerald-400 animate-spin" />
        </div>
      ) : (
        <>
          {/* Bismillah for non-Fatiha surahs (not surah 9) */}
          {ayahNum === 1 && surahNum !== 9 && surahNum !== 1 && (
            <p className="text-center text-base text-emerald-300/70 font-arabic leading-loose">
              بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ
            </p>
          )}

          {/* Arabic text */}
          <p
            dir="rtl"
            className="text-right text-xl text-emerald-100 leading-[2.2] font-arabic"
            style={{ fontFamily: "'Amiri', 'Traditional Arabic', 'Arial Unicode MS', serif" }}
          >
            {arabicText}
            <span className="text-emerald-500 text-sm mr-2">
              ﴿{ayahNum}﴾
            </span>
          </p>

          {/* Translation */}
          <p className="text-xs text-emerald-300/80 leading-relaxed border-t border-emerald-800/30 pt-2">
            {cleanTranslation(engText)}
          </p>
        </>
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between pt-1">
        <button
          onClick={prevAyah}
          disabled={!isHost || (surahNum === 1 && ayahNum === 1)}
          className="flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <ChevronLeft className="w-4 h-4" /> Prev
        </button>

        {/* Ayah selector */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-emerald-600">Ayah</span>
          {isHost ? (
            <select
              value={ayahNum}
              onChange={e => navigate(surahNum, parseInt(e.target.value))}
              className="bg-emerald-950/60 border border-emerald-800/50 text-emerald-300 text-xs rounded-lg px-2 py-0.5 outline-none"
            >
              {Array.from({ length: totalAyahs }, (_, i) => i + 1).map(n => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          ) : (
            <span className="text-xs text-emerald-300 font-bold">{ayahNum}</span>
          )}
          <span className="text-xs text-emerald-600">/ {totalAyahs}</span>
        </div>

        <button
          onClick={nextAyah}
          disabled={!isHost || (surahNum === 114 && ayahNum === totalAyahs)}
          className="flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          Next <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
