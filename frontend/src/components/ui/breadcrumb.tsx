'use client'

import Link from 'next/link'
import { ChevronRight, Home } from 'lucide-react'
import { cn } from '@/lib/utils'

interface BreadcrumbItem {
  label: string
  href?: string
}

interface BreadcrumbProps {
  items: BreadcrumbItem[]
  showHome?: boolean
  className?: string
}

export function Breadcrumb({ items, showHome = true, className }: BreadcrumbProps) {
  return (
    <nav className={cn('flex items-center gap-1 text-sm', className)} aria-label="Breadcrumb">
      {showHome && (
        <>
          <Link href="/dashboard" className="text-gray-400 hover:text-halqa-600 transition-colors">
            <Home className="w-3.5 h-3.5" />
          </Link>
          {items.length > 0 && <ChevronRight className="w-3.5 h-3.5 text-gray-300 flex-shrink-0" />}
        </>
      )}
      {items.map((item, i) => {
        const isLast = i === items.length - 1
        return (
          <div key={i} className="flex items-center gap-1">
            {item.href && !isLast ? (
              <Link href={item.href} className="text-gray-500 hover:text-halqa-600 transition-colors truncate max-w-[120px]">
                {item.label}
              </Link>
            ) : (
              <span className={cn('truncate max-w-[160px]', isLast ? 'text-gray-900 font-medium' : 'text-gray-500')}>
                {item.label}
              </span>
            )}
            {!isLast && <ChevronRight className="w-3.5 h-3.5 text-gray-300 flex-shrink-0" />}
          </div>
        )
      })}
    </nav>
  )
}
