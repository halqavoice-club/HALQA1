'use client'

import { useState } from 'react'
import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Skeleton } from './skeleton'

export interface Column<T> {
  key: string
  header: string
  sortable?: boolean
  className?: string
  render?: (row: T, index: number) => React.ReactNode
}

interface DataTableProps<T> {
  columns: Column<T>[]
  data: T[]
  isLoading?: boolean
  emptyMessage?: string
  onRowClick?: (row: T) => void
  className?: string
  stickyHeader?: boolean
}

export function DataTable<T extends Record<string, any>>({
  columns, data, isLoading = false,
  emptyMessage = 'No data found',
  onRowClick, className, stickyHeader = false
}: DataTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const sorted = [...data].sort((a, b) => {
    if (!sortKey) return 0
    const av = a[sortKey]
    const bv = b[sortKey]
    if (av == null) return 1
    if (bv == null) return -1
    const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true })
    return sortDir === 'asc' ? cmp : -cmp
  })

  return (
    <div className={cn('overflow-x-auto rounded-xl border border-gray-100', className)}>
      <table className="w-full text-sm">
        <thead className={cn('bg-gray-50 border-b border-gray-100', stickyHeader && 'sticky top-0 z-10')}>
          <tr>
            {columns.map(col => (
              <th
                key={col.key}
                className={cn(
                  'text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap',
                  col.sortable && 'cursor-pointer select-none hover:text-gray-900',
                  col.className
                )}
                onClick={() => col.sortable && handleSort(col.key)}
              >
                <div className="flex items-center gap-1">
                  {col.header}
                  {col.sortable && (
                    <span className="text-gray-400">
                      {sortKey === col.key
                        ? sortDir === 'asc'
                          ? <ChevronUp className="w-3.5 h-3.5 text-halqa-600" />
                          : <ChevronDown className="w-3.5 h-3.5 text-halqa-600" />
                        : <ChevronsUpDown className="w-3.5 h-3.5" />
                      }
                    </span>
                  )}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {isLoading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <tr key={i}>
                {columns.map(col => (
                  <td key={col.key} className="px-4 py-3">
                    <Skeleton className="h-4 rounded" />
                  </td>
                ))}
              </tr>
            ))
          ) : sorted.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-12 text-center text-gray-400 text-sm">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            sorted.map((row, i) => (
              <tr
                key={i}
                onClick={() => onRowClick?.(row)}
                className={cn(
                  'hover:bg-gray-50 transition-colors',
                  onRowClick && 'cursor-pointer'
                )}
              >
                {columns.map(col => (
                  <td key={col.key} className={cn('px-4 py-3 text-gray-700', col.className)}>
                    {col.render ? col.render(row, i) : row[col.key] ?? '—'}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
