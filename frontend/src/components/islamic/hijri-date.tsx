'use client'

import { useQuery } from '@tanstack/react-query'
import { Moon } from 'lucide-react'

const HIJRI_MONTHS_EN = [
  'Muharram','Safar','Rabi al-Awwal','Rabi al-Thani',
  'Jumada al-Awwal','Jumada al-Thani','Rajab','Sha\'ban',
  'Ramadan','Shawwal','Dhu al-Qi\'dah','Dhu al-Hijjah'
]

const HIJRI_MONTHS_AR = [
  'محرم','صفر','ربيع الأول','ربيع الثاني',
  'جمادى الأولى','جمادى الثانية','رجب','شعبان',
  'رمضان','شوال','ذو القعدة','ذو الحجة'
]

interface HijriDateProps {
  showArabic?: boolean
  className?: string
  compact?: boolean
}

export function HijriDate({ showArabic = false, className = '', compact = false }: HijriDateProps) {
  const today = new Date()
  const dateStr = `${today.getDate()}-${today.getMonth() + 1}-${today.getFullYear()}`

  const { data } = useQuery({
    queryKey: ['hijri-date', dateStr],
    queryFn: async () => {
      const res = await fetch(
        `https://api.aladhan.com/v1/gToH/${today.getDate()}-${today.getMonth() + 1}-${today.getFullYear()}`
      )
      const json = await res.json()
      return json.data?.hijri
    },
    staleTime: 1000 * 60 * 60 * 12, // 12 hours
    retry: 1
  })

  if (!data) {
    // Fallback: approximate Hijri date calculation
    const approx = gregorianToHijriApprox(today)
    return (
      <span className={`flex items-center gap-1 text-xs text-gray-500 ${className}`}>
        <Moon className="w-3 h-3" />
        {compact
          ? `${approx.day} ${HIJRI_MONTHS_EN[approx.month - 1]} ${approx.year}H`
          : `${approx.day} ${HIJRI_MONTHS_EN[approx.month - 1]}, ${approx.year} AH`
        }
      </span>
    )
  }

  const monthEn = HIJRI_MONTHS_EN[parseInt(data.month.number) - 1] || data.month.en
  const monthAr = HIJRI_MONTHS_AR[parseInt(data.month.number) - 1] || data.month.ar

  if (compact) {
    return (
      <span className={`flex items-center gap-1 text-xs text-gray-500 ${className}`}>
        <Moon className="w-3 h-3 text-yellow-500" />
        {data.day} {showArabic ? monthAr : monthEn} {data.year}H
      </span>
    )
  }

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <Moon className="w-4 h-4 text-yellow-500 flex-shrink-0" />
      <div>
        <p className="text-sm font-medium text-gray-700">
          {data.day} {monthEn} {data.year} AH
        </p>
        {showArabic && (
          <p className="text-xs text-gray-400 font-arabic" dir="rtl">
            {data.day} {monthAr} {data.year} هـ
          </p>
        )}
      </div>
    </div>
  )
}

// Approximate Gregorian → Hijri (±1 day accuracy, no API needed)
function gregorianToHijriApprox(date: Date) {
  const jd = Math.floor((date.getTime() / 86400000) + 2440587.5)
  const l = jd - 1948440 + 10632
  const n = Math.floor((l - 1) / 10631)
  const l2 = l - 10631 * n + 354
  const j = Math.floor((10985 - l2) / 5316) * Math.floor((50 * l2) / 17719)
    + Math.floor(l2 / 5670) * Math.floor((43 * l2) / 15238)
  const l3 = l2 - Math.floor((30 - j) / 15) * Math.floor((17719 * j) / 50)
    - Math.floor(j / 16) * Math.floor((15238 * j) / 43) + 29
  const month = Math.floor((24 * l3) / 709)
  const day = l3 - Math.floor((709 * month) / 24)
  const year = 30 * n + j - 30
  return { day, month, year }
}
