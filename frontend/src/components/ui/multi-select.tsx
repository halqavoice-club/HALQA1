'use client'

import { useState, useRef, useEffect } from 'react'
import { X, ChevronDown, Check, Search } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Option {
  value: string
  label: string
  color?: string
}

interface MultiSelectProps {
  options: Option[]
  value: string[]
  onChange: (value: string[]) => void
  placeholder?: string
  searchable?: boolean
  maxItems?: number
  disabled?: boolean
  className?: string
}

export function MultiSelect({
  options, value, onChange, placeholder = 'Select...', searchable = true,
  maxItems, disabled, className
}: MultiSelectProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const filtered = options.filter(o =>
    !search || o.label.toLowerCase().includes(search.toLowerCase())
  )

  const toggle = (v: string) => {
    if (value.includes(v)) {
      onChange(value.filter(x => x !== v))
    } else if (!maxItems || value.length < maxItems) {
      onChange([...value, v])
    }
  }

  const selectedOptions = options.filter(o => value.includes(o.value))

  return (
    <div ref={ref} className={cn('relative', className)}>
      {/* Trigger */}
      <div
        onClick={() => !disabled && setOpen(!open)}
        className={cn(
          'min-h-[38px] w-full px-3 py-1.5 rounded-lg border border-input bg-background flex items-center gap-1.5 flex-wrap cursor-pointer transition-colors',
          open && 'ring-2 ring-halqa-500 border-transparent',
          disabled && 'opacity-50 cursor-not-allowed bg-gray-50'
        )}
      >
        {selectedOptions.length === 0 ? (
          <span className="text-sm text-muted-foreground flex-1">{placeholder}</span>
        ) : (
          <>
            {selectedOptions.map(opt => (
              <span
                key={opt.value}
                className="inline-flex items-center gap-1 bg-halqa-100 text-halqa-700 text-xs font-medium px-2 py-0.5 rounded-full"
              >
                {opt.label}
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); toggle(opt.value) }}
                  className="hover:text-halqa-900 transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
            <span className="flex-1" />
          </>
        )}
        <ChevronDown className={cn('w-4 h-4 text-gray-400 flex-shrink-0 transition-transform', open && 'rotate-180')} />
      </div>

      {/* Dropdown */}
      {open && (
        <div className="absolute top-full mt-1 left-0 right-0 bg-white rounded-xl shadow-xl border border-gray-100 z-50 overflow-hidden">
          {searchable && (
            <div className="p-2 border-b border-gray-100">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                <input
                  autoFocus
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search..."
                  className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg outline-none focus:border-halqa-400"
                />
              </div>
            </div>
          )}
          <div className="max-h-52 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">No options found</p>
            ) : (
              filtered.map(opt => {
                const selected = value.includes(opt.value)
                const disabled = !selected && !!maxItems && value.length >= maxItems
                return (
                  <button
                    key={opt.value}
                    type="button"
                    disabled={disabled}
                    onClick={() => toggle(opt.value)}
                    className={cn(
                      'w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left transition-colors',
                      selected ? 'bg-halqa-50 text-halqa-700' : 'hover:bg-gray-50 text-gray-700',
                      disabled && 'opacity-40 cursor-not-allowed'
                    )}
                  >
                    <div className={cn(
                      'w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0',
                      selected ? 'bg-halqa-700 border-halqa-700' : 'border-gray-300'
                    )}>
                      {selected && <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />}
                    </div>
                    {opt.label}
                  </button>
                )
              })
            )}
          </div>
          {maxItems && (
            <div className="px-3 py-2 border-t border-gray-100 text-xs text-gray-400">
              {value.length}/{maxItems} selected
            </div>
          )}
        </div>
      )}
    </div>
  )
}
