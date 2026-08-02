'use client'

import { useThemeStore } from '@/store/theme.store'
import { LANGUAGE_OPTIONS, type Language } from '@/lib/i18n/translations'
import { Globe } from 'lucide-react'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger, DropdownMenuLabel, DropdownMenuSeparator
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'

export function LanguageSwitcher() {
  const { language, setLanguage } = useThemeStore()
  const current = LANGUAGE_OPTIONS.find(l => l.value === language)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2 h-9 px-2">
          <Globe className="w-4 h-4" />
          <span className="text-sm font-medium hidden sm:block">{current?.nativeLabel}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel className="text-xs text-gray-500 font-normal">Select Language</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {LANGUAGE_OPTIONS.map(opt => (
          <DropdownMenuItem
            key={opt.value}
            onClick={() => setLanguage(opt.value as Language)}
            className={`gap-3 cursor-pointer ${language === opt.value ? 'bg-halqa-50 text-halqa-700 font-medium' : ''}`}
          >
            <span className="text-base">{getLangFlag(opt.value)}</span>
            <div className="flex-1">
              <p className="text-sm">{opt.nativeLabel}</p>
              <p className="text-xs text-gray-400">{opt.label}</p>
            </div>
            {language === opt.value && (
              <div className="w-2 h-2 rounded-full bg-halqa-600" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function getLangFlag(lang: Language): string {
  const flags: Record<Language, string> = {
    en: '🇬🇧', ar: '🇸🇦', om: '🇪🇹', am: '🇪🇹', so: '🇸🇴'
  }
  return flags[lang] ?? '🌐'
}
