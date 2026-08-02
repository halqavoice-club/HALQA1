'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Moon, Sun, Sunrise, Sunset, Clock } from 'lucide-react'

interface PrayerTime {
  name: string
  time: string
  icon: React.ElementType
  color: string
}

interface HijriDate {
  day: string
  month: { en: string; ar: string }
  year: string
}

interface QuranVerse {
  text: string
  surah: string
  ayah: number
}

// Static Quran verses (no API needed)
const DAILY_VERSES: QuranVerse[] = [
  { text: 'Indeed, with hardship will be ease.', surah: 'Al-Inshirah', ayah: 6 },
  { text: 'And He found you lost and guided you.', surah: 'Ad-Duha', ayah: 7 },
  { text: 'So remember Me; I will remember you.', surah: 'Al-Baqarah', ayah: 152 },
  { text: 'Allah does not burden a soul beyond that it can bear.', surah: 'Al-Baqarah', ayah: 286 },
  { text: 'And whoever relies upon Allah — then He is sufficient for him.', surah: 'At-Talaq', ayah: 3 },
  { text: 'Verily, the most noble of you in the sight of Allah is the most righteous.', surah: 'Al-Hujurat', ayah: 13 },
  { text: 'And seek help through patience and prayer.', surah: 'Al-Baqarah', ayah: 45 },
]

function formatTime(timeStr: string): string {
  if (!timeStr) return '--:--'
  const [h, m] = timeStr.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const hour = h % 12 || 12
  return `${hour}:${m.toString().padStart(2, '0')} ${ampm}`
}

function getNextPrayer(prayers: { name: string; time: string }[]): string {
  const now = new Date()
  const currentMinutes = now.getHours() * 60 + now.getMinutes()
  for (const p of prayers) {
    const [h, m] = p.time.split(':').map(Number)
    if (h * 60 + m > currentMinutes) return p.name
  }
  return prayers[0]?.name || ''
}

export function PrayerTimesWidget() {
  const [prayerTimes, setPrayerTimes] = useState<Record<string, string>>({})
  const [hijri, setHijri] = useState<HijriDate | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [currentTime, setCurrentTime] = useState(new Date())

  // Daily verse based on day of year
  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000)
  const verse = DAILY_VERSES[dayOfYear % DAILY_VERSES.length]

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Get user's timezone offset for date
        const today = new Date()
        const dateStr = `${today.getDate().toString().padStart(2, '0')}-${(today.getMonth() + 1).toString().padStart(2, '0')}-${today.getFullYear()}`

        // Fetch prayer times + hijri date from Aladhan API (free, no key needed)
        const res = await fetch(
          `https://api.aladhan.com/v1/timingsByCity/${dateStr}?city=New+York&country=US&method=2`,
          { signal: AbortSignal.timeout(5000) }
        )
        if (!res.ok) throw new Error('API error')
        const data = await res.json()

        setPrayerTimes(data.data?.timings || {})
        setHijri(data.data?.date?.hijri || null)
      } catch {
        setError(true)
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [])

  const prayers = [
    { name: 'Fajr',    key: 'Fajr',    icon: Moon,    color: 'text-indigo-500' },
    { name: 'Sunrise', key: 'Sunrise', icon: Sunrise, color: 'text-orange-400' },
    { name: 'Dhuhr',   key: 'Dhuhr',   icon: Sun,     color: 'text-yellow-500' },
    { name: 'Asr',     key: 'Asr',     icon: Sun,     color: 'text-amber-500' },
    { name: 'Maghrib', key: 'Maghrib', icon: Sunset,  color: 'text-orange-600' },
    { name: 'Isha',    key: 'Isha',    icon: Moon,    color: 'text-blue-600' },
  ]

  const prayerList = prayers.map(p => ({ name: p.name, time: prayerTimes[p.key] || '' }))
  const nextPrayer = !loading && !error ? getNextPrayer(prayerList.filter(p => p.time)) : ''

  return (
    <div className="space-y-4">
      {/* Hijri date + current time */}
      <Card className="border-0 shadow-sm bg-gradient-to-br from-halqa-800 to-halqa-700 text-white">
        <CardContent className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-halqa-200 text-xs font-medium uppercase tracking-wider">Today</p>
              <p className="text-2xl font-bold mt-0.5">
                {currentTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
              </p>
              <p className="text-halqa-200 text-sm mt-0.5">
                {currentTime.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
              </p>
            </div>
            <div className="text-right">
              <p className="text-halqa-200 text-xs font-medium uppercase tracking-wider">Hijri</p>
              {hijri ? (
                <>
                  <p className="text-xl font-bold mt-0.5">{hijri.day} {hijri.month.en}</p>
                  <p className="text-halqa-200 text-sm">{hijri.year} AH</p>
                </>
              ) : (
                <p className="text-halqa-300 text-sm mt-1">{loading ? 'Loading...' : 'Unavailable'}</p>
              )}
            </div>
          </div>
          {nextPrayer && (
            <div className="mt-3 pt-3 border-t border-halqa-600 flex items-center gap-2">
              <Clock className="w-3.5 h-3.5 text-halqa-300" />
              <p className="text-xs text-halqa-200">Next prayer: <span className="text-white font-semibold">{nextPrayer}</span></p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Prayer times */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Moon className="w-4 h-4 text-halqa-600" /> Prayer Times
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-4 space-y-2">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="h-8 bg-gray-100 rounded animate-pulse" />
              ))}
            </div>
          ) : error ? (
            <p className="text-sm text-gray-400 text-center py-4">Prayer times unavailable</p>
          ) : (
            <div className="divide-y divide-gray-100">
              {prayers.map(prayer => {
                const time = prayerTimes[prayer.key]
                const Icon = prayer.icon
                const isNext = prayer.name === nextPrayer
                return (
                  <div key={prayer.name} className={`flex items-center justify-between px-4 py-2.5 ${isNext ? 'bg-halqa-50' : ''}`}>
                    <div className="flex items-center gap-2.5">
                      <Icon className={`w-4 h-4 ${prayer.color}`} />
                      <span className={`text-sm font-medium ${isNext ? 'text-halqa-700' : 'text-gray-700'}`}>
                        {prayer.name}
                      </span>
                      {isNext && <span className="text-xs bg-halqa-100 text-halqa-700 px-1.5 py-0.5 rounded-full font-medium">Next</span>}
                    </div>
                    <span className={`text-sm font-semibold ${isNext ? 'text-halqa-700' : 'text-gray-600'}`}>
                      {time ? formatTime(time) : '--:--'}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quran verse of the day */}
      <Card className="border-0 shadow-sm bg-gradient-to-br from-emerald-50 to-teal-50 border-emerald-100">
        <CardContent className="p-4">
          <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wider mb-2">Verse of the Day</p>
          <p className="text-sm text-gray-800 leading-relaxed italic">&ldquo;{verse.text}&rdquo;</p>
          <p className="text-xs text-emerald-600 mt-2 font-medium">— Surah {verse.surah}, {verse.ayah}</p>
        </CardContent>
      </Card>
    </div>
  )
}
