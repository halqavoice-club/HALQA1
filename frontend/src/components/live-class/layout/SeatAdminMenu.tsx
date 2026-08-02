'use client'

/**
 * SeatAdminMenu.tsx
 *
 * Admin action overlay for a seat. Shown when a host/moderator
 * long-presses (right-clicks) a SeatCard.
 *
 * Requirement: 11.5
 */

import React, { useEffect, useRef } from 'react'
import type { SeatData } from '../../../../../src/lib/layout/layoutTypes'

export interface SeatAdminMenuProps {
  seat: SeatData
  isOpen: boolean
  onClose: () => void
  onLockSeat: () => void
  onReserveSeat: () => void
  onSwapSeat: () => void
  onPinSpeaker: () => void
}

export function SeatAdminMenu({
  seat,
  isOpen,
  onClose,
  onLockSeat,
  onReserveSeat,
  onSwapSeat,
  onPinSpeaker,
}: SeatAdminMenuProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    if (isOpen) {
      dialogRef.current?.showModal()
    } else {
      dialogRef.current?.close()
    }
  }, [isOpen])

  if (!isOpen) return null

  const displayName = seat.displayName || seat.userId.slice(0, 8)

  const actions = [
    { label: seat.isLocked ? '🔓 Unlock Seat' : '🔒 Lock Seat', onClick: onLockSeat },
    { label: '📌 Reserve Seat', onClick: onReserveSeat },
    { label: '🔄 Swap Seat', onClick: onSwapSeat },
    { label: '📍 Pin Speaker', onClick: onPinSpeaker },
  ]

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose()
      }}
      style={{
        border: 'none',
        borderRadius: 12,
        padding: 0,
        backgroundColor: '#1a1a2e',
        color: '#e5e7eb',
        minWidth: 240,
        boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
      }}
    >
      <div style={{ padding: 16 }}>
        <p style={{ margin: '0 0 12px', fontWeight: 700, fontSize: 14 }}>
          {seat.isEmpty ? 'Empty Seat' : displayName}
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {actions.map(({ label, onClick }) => (
            <button
              key={label}
              type="button"
              onClick={() => { onClick(); onClose() }}
              style={{
                background: 'none',
                border: '1px solid #2d2d4e',
                borderRadius: 8,
                padding: '10px 14px',
                color: '#e5e7eb',
                cursor: 'pointer',
                textAlign: 'left',
                fontSize: 13,
                minHeight: 44,
              }}
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              borderRadius: 8,
              padding: '10px 14px',
              color: '#9ca3af',
              cursor: 'pointer',
              fontSize: 13,
              minHeight: 44,
              marginTop: 4,
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </dialog>
  )
}
