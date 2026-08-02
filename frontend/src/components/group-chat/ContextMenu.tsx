'use client'
/**
 * ContextMenu — long-press / right-click action menu for message bubbles
 * Requirements: 9.1–9.10
 */
import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Reply, Smile, Copy, Forward, Trash2 } from 'lucide-react'

interface Props {
  position: { x: number; y: number }
  isMe:     boolean
  onReply:  () => void
  onReact:  () => void
  onCopy:   () => void
  onForward:() => void
  onDelete: () => void
  onClose:  () => void
}

export function ContextMenu({ position, isMe, onReply, onReact, onCopy, onForward, onDelete, onClose }: Props) {
  // Close on outside click/tap (Requirement 9.10)
  useEffect(() => {
    const handler = (e: MouseEvent | TouchEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('[data-context-menu]')) onClose()
    }
    document.addEventListener('mousedown', handler)
    document.addEventListener('touchstart', handler)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('touchstart', handler)
    }
  }, [onClose])

  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      data-context-menu
      className="fixed z-[9999] bg-white rounded-2xl shadow-xl border border-gray-100 py-1.5 min-w-[160px] animate-in fade-in zoom-in-95 duration-100"
      style={{ top: position.y, left: position.x }}
    >
      {/* Always present */}
      <MenuItem icon={<Reply className="w-4 h-4 text-indigo-500" />} label="Reply"
        onClick={() => { onReply(); onClose() }} />
      <MenuItem icon={<Smile className="w-4 h-4 text-yellow-500" />} label="React"
        onClick={() => { onReact(); onClose() }} />
      <MenuItem icon={<Copy className="w-4 h-4 text-blue-500" />} label="Copy"
        onClick={() => { onCopy(); onClose() }} />

      {/* Own messages only (Requirement 9.3) */}
      {isMe && (
        <>
          <MenuItem icon={<Forward className="w-4 h-4 text-green-500" />} label="Forward"
            onClick={() => { onForward(); onClose() }} />
          <div className="h-px bg-gray-100 mx-3 my-0.5" />
          <MenuItem icon={<Trash2 className="w-4 h-4 text-red-500" />} label="Delete"
            onClick={() => { onDelete(); onClose() }}
            className="text-red-500 hover:bg-red-50" />
        </>
      )}
    </div>,
    document.body
  )
}

function MenuItem({ icon, label, onClick, className }: {
  icon: React.ReactNode; label: string; onClick: () => void; className?: string
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors ${className ?? ''}`}
    >
      {icon}
      {label}
    </button>
  )
}
