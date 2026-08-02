'use client'

import { useState, KeyboardEvent } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface TagInputProps {
  tags: string[]
  onChange: (tags: string[]) => void
  placeholder?: string
  maxTags?: number
  suggestions?: string[]
  className?: string
}

export function TagInput({ tags, onChange, placeholder = 'Add tag...', maxTags = 20, suggestions = [], className }: TagInputProps) {
  const [input, setInput] = useState('')
  const [showSuggestions, setShowSuggestions] = useState(false)

  const addTag = (tag: string) => {
    const t = tag.trim()
    if (!t || tags.includes(t) || tags.length >= maxTags) return
    onChange([...tags, t])
    setInput('')
    setShowSuggestions(false)
  }

  const removeTag = (i: number) => onChange(tags.filter((_, idx) => idx !== i))

  const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(input) }
    if (e.key === 'Backspace' && !input && tags.length > 0) removeTag(tags.length - 1)
  }

  const filtered = suggestions.filter(s => s.toLowerCase().includes(input.toLowerCase()) && !tags.includes(s))

  return (
    <div className={cn('relative', className)}>
      <div className="flex flex-wrap gap-1.5 p-2 border border-input rounded-md bg-background min-h-[42px] focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
        {tags.map((tag, i) => (
          <span key={i} className="inline-flex items-center gap-1 bg-halqa-100 text-halqa-700 text-xs font-medium px-2 py-1 rounded-full">
            {tag}
            <button onClick={() => removeTag(i)} className="hover:text-halqa-900 transition-colors">
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
        {tags.length < maxTags && (
          <input
            value={input}
            onChange={e => { setInput(e.target.value); setShowSuggestions(true) }}
            onKeyDown={handleKey}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
            placeholder={tags.length === 0 ? placeholder : ''}
            className="flex-1 min-w-[80px] text-sm outline-none bg-transparent placeholder:text-muted-foreground"
          />
        )}
      </div>
      {showSuggestions && filtered.length > 0 && (
        <div className="absolute top-full mt-1 left-0 right-0 bg-white border border-gray-200 rounded-lg shadow-lg z-20 max-h-40 overflow-y-auto">
          {filtered.map(s => (
            <button key={s} onMouseDown={() => addTag(s)}
              className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 transition-colors">
              {s}
            </button>
          ))}
        </div>
      )}
      <p className="text-xs text-gray-400 mt-1">Press Enter or comma to add · {tags.length}/{maxTags}</p>
    </div>
  )
}
