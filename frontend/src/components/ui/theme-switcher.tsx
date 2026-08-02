'use client'

import { useThemeStore, type Theme } from '@/store/theme.store'
import { Sun, Moon, Monitor } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { useTranslation } from '@/hooks/useTranslation'

export function ThemeSwitcher() {
  const { theme, setTheme } = useThemeStore()
  const { t } = useTranslation()

  const icons: Record<Theme, React.ReactNode> = {
    light: <Sun className="w-4 h-4" />,
    dark: <Moon className="w-4 h-4" />,
    system: <Monitor className="w-4 h-4" />,
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-9 w-9 p-0">
          {icons[theme]}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-36">
        {(['light', 'dark', 'system'] as Theme[]).map(opt => (
          <DropdownMenuItem
            key={opt}
            onClick={() => setTheme(opt)}
            className={`gap-2 cursor-pointer ${theme === opt ? 'bg-halqa-50 text-halqa-700 font-medium' : ''}`}
          >
            {icons[opt]}
            <span className="text-sm capitalize">
              {opt === 'light' ? t.lightMode : opt === 'dark' ? t.darkMode : t.systemMode}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
