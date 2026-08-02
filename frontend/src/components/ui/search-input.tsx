'use client'

import { useState, useEffect, useRef } from 'react'
import { Search, X, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SearchInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  isLoading?: boolean
  className?: string
  debounceMs?: number
  onFocus?: () => void
}

export function SearchInput({
  value,
  onChange,
  placeholder = 'Search...',
  isLoading = false,
  className,
  debounceMs = 300,
  onFocus
}: SearchInputProps) {
  const [localValue, setLocalValue] = useState(value)
  const timerRef = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    setLocalValue(value)
  }, [value])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value
    setLocalValue(v)
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => onChange(v), debounceMs)
  }

  const handleClear = () => {
    setLocalValue('')
    onChange('')
  }

  return (
    <div className={cn('relative', className)}>
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
      <input
        type="text"
        value={localValue}
        onChange={handleChange}
        onFocus={onFocus}
        placeholder={placeholder}
        className="flex h-10 w-full rounded-md border border-input bg-background pl-9 pr-9 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      />
      <div className="absolute right-3 top-1/2 -translate-y-1/2">
        {isLoading ? (
          <Loader2 className="h-4 w-4 text-gray-400 animate-spin" />
        ) : localValue ? (
          <button onClick={handleClear} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>
    </div>
  )
}
