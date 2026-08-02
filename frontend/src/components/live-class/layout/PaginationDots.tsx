'use client'

/**
 * PaginationDots.tsx
 *
 * Page indicator with animated active dot and tap-to-jump.
 * Hidden when totalPages <= 1.
 *
 * Requirements: 3.7, 3.8, 12.3
 */

import React from 'react'
import { motion } from 'framer-motion'

export interface PaginationDotsProps {
  totalPages: number
  currentPage: number
  onPageSelect: (page: number) => void
}

export function PaginationDots({
  totalPages,
  currentPage,
  onPageSelect,
}: PaginationDotsProps) {
  if (totalPages <= 1) return null

  return (
    <div
      role="tablist"
      aria-label="Pages"
      style={{
        display: 'flex',
        flexDirection: 'row',
        gap: 6,
        justifyContent: 'center',
        alignItems: 'center',
        padding: '8px 0',
      }}
    >
      {Array.from({ length: totalPages }, (_, i) => {
        const isActive = i === currentPage
        return (
          <button
            key={i}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-label={`Page ${i + 1}`}
            onClick={() => onPageSelect(i)}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '19px 5px',
              minWidth: 44,
              minHeight: 44, // WCAG 2.5.5 — minimum 44×44dp touch target
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <motion.div
              animate={{
                width: isActive ? 16 : 6,
                backgroundColor: isActive ? '#4f46e5' : '#6b7280',
              }}
              transition={{ duration: 0.2 }}
              style={{
                height: 6,
                borderRadius: isActive ? 4 : 3,
              }}
            />
          </button>
        )
      })}
    </div>
  )
}
