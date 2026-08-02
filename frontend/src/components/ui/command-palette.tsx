'use client'

import { useState, useEffect, useRef } from 'react'
import { Search, ArrowRight, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import Link from 'next/link'

interface CommandItem {
  id: string
  label: string
  description?: string
  href?: string
  icon?: React.ElementType
  category?: string
  onSelect?: () => void
  keywords?: string[]
}

interface CommandPaletteProps {
  open: boolean
  onClose: () => void
  items: CommandItem[]
  placeholder?: string
}

export function CommandPalette({ open, onClose, items, placeholder = 'Search anything...' }: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setQuery('')
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      // Ctrl+K or Cmd+K to open
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  if (!open) return null

  const filtered = query.length < 1 ? items : items.filter(item => {
    const q = query.toLowerCase()
    return (
      item.label.toLowerCase().includes(q) ||
      item.description?.toLowerCase().includes(q) ||
      item.keywords?.some(k => k.toLowerCase().includes(q))
    )
  })

  // Group by category
  const grouped: Record<string, CommandItem[]> = {}
  filtered.forEach(item => {
    const cat = item.category || 'General'
    if (!grouped[cat]) grouped[cat] = []
    grouped[cat].push(item)
  })

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-[15vh] px-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-fade-in">
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100">
          <Search className="w-5 h-5 text-gray-400 flex-shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={placeholder}
            className="flex-1 text-sm outline-none bg-transparent placeholder:text-gray-400"
          />
          {query && (
            <button onClick={() => setQuery('')} className="text-gray-400 hover:text-gray-600">
              <X className="w-4 h-4" />
            </button>
          )}
          <kbd className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded border border-gray-200">ESC</kbd>
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto py-2">
          {Object.keys(grouped).length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">No results for &quot;{query}&quot;</p>
          ) : (
            Object.entries(grouped).map(([category, catItems]) => (
              <div key={category}>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-4 py-2">{category}</p>
                {catItems.map(item => {
                  const Icon = item.icon
                  const content = (
                    <div
                      className="flex items-center gap-3 px-4 py-2.5 hover:bg-halqa-50 cursor-pointer transition-colors group"
                      onClick={() => { item.onSelect?.(); onClose() }}
                    >
                      {Icon && (
                        <div className="w-8 h-8 bg-gray-100 group-hover:bg-halqa-100 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors">
                          <Icon className="w-4 h-4 text-gray-500 group-hover:text-halqa-700" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{item.label}</p>
                        {item.description && <p className="text-xs text-gray-400 truncate">{item.description}</p>}
                      </div>
                      <ArrowRight className="w-4 h-4 text-gray-300 group-hover:text-halqa-500 flex-shrink-0" />
                    </div>
                  )

                  return item.href ? (
                    <Link key={item.id} href={item.href} onClick={onClose}>{content}</Link>
                  ) : (
                    <div key={item.id}>{content}</div>
                  )
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer hint */}
        <div className="px-4 py-2.5 border-t border-gray-100 flex items-center gap-4 text-xs text-gray-400">
          <span className="flex items-center gap-1"><kbd className="bg-gray-100 px-1 rounded">↑↓</kbd> navigate</span>
          <span className="flex items-center gap-1"><kbd className="bg-gray-100 px-1 rounded">↵</kbd> select</span>
          <span className="flex items-center gap-1"><kbd className="bg-gray-100 px-1 rounded">ESC</kbd> close</span>
        </div>
      </div>
    </div>
  )
}
