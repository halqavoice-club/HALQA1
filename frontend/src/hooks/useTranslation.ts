'use client'

import { useThemeStore } from '@/store/theme.store'
import { translations } from '@/lib/i18n/translations'

export function useTranslation() {
  const { language } = useThemeStore()
  const t = translations[language] ?? translations.en
  return { t, language }
}
