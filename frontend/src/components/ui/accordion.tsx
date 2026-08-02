'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

interface AccordionItem {
  id: string
  title: string
  content: React.ReactNode
  badge?: string | number
}

interface AccordionProps {
  items: AccordionItem[]
  defaultOpen?: string[]
  multiple?: boolean
  className?: string
}

export function Accordion({ items, defaultOpen = [], multiple = false, className }: AccordionProps) {
  const [open, setOpen] = useState<string[]>(defaultOpen)

  const toggle = (id: string) => {
    if (multiple) {
      setOpen(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
    } else {
      setOpen(prev => prev.includes(id) ? [] : [id])
    }
  }

  return (
    <div className={cn('divide-y divide-gray-100 border border-gray-200 rounded-xl overflow-hidden', className)}>
      {items.map(item => {
        const isOpen = open.includes(item.id)
        return (
          <div key={item.id}>
            <button
              type="button"
              onClick={() => toggle(item.id)}
              className="w-full flex items-center justify-between px-4 py-3.5 text-left hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-gray-900">{item.title}</span>
                {item.badge !== undefined && (
                  <span className="text-xs bg-halqa-100 text-halqa-700 px-1.5 py-0.5 rounded-full font-medium">
                    {item.badge}
                  </span>
                )}
              </div>
              <ChevronDown className={cn('w-4 h-4 text-gray-400 transition-transform flex-shrink-0', isOpen && 'rotate-180')} />
            </button>
            {isOpen && (
              <div className="px-4 pb-4 pt-1 text-sm text-gray-600 bg-gray-50/50">
                {item.content}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
