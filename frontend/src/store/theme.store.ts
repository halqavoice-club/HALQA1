'use client'

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { Language } from '@/lib/i18n/translations'

export type Theme = 'light' | 'dark' | 'system'
export { Language }

interface ThemeState {
  theme: Theme
  language: Language
  setTheme: (theme: Theme) => void
  setLanguage: (lang: Language) => void
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: 'light',
      language: 'en',
      setTheme: (theme) => { set({ theme }); applyTheme(theme) },
      setLanguage: (language) => { set({ language }); applyLanguage(language) },
    }),
    {
      name: 'halqa-theme',
      storage: createJSONStorage(() => {
        if (typeof window === 'undefined') {
          return { getItem: () => null, setItem: () => {}, removeItem: () => {} }
        }
        return localStorage
      })
    }
  )
)

export function applyTheme(theme: Theme) {
  if (typeof document === 'undefined') return
  const isDark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', isDark)
}

export function applyLanguage(lang: Language) {
  if (typeof document === 'undefined') return
  const rtlLangs: Language[] = ['ar']
  document.documentElement.setAttribute('lang', lang)
  document.documentElement.setAttribute('dir', rtlLangs.includes(lang) ? 'rtl' : 'ltr')
}
