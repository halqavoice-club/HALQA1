'use client'

import { useState } from 'react'
import { Share2, Copy, Check, Link } from 'lucide-react'
import { Button } from './button'
import { cn } from '@/lib/utils'

interface ShareButtonProps {
  title?: string
  text?: string
  url?: string
  label?: string
  className?: string
}

export function ShareButton({ title, text, url, label = 'Share', className }: ShareButtonProps) {
  const [copied, setCopied] = useState(false)

  const shareUrl = url || (typeof window !== 'undefined' ? window.location.href : '')

  const handleShare = async () => {
    // Use native share API if available (mobile)
    if (navigator.share) {
      try {
        await navigator.share({ title, text, url: shareUrl })
        return
      } catch {}
    }

    // Fallback: copy to clipboard
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Last resort: select text
      const el = document.createElement('input')
      el.value = shareUrl
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleShare}
      className={cn('gap-2', className)}
    >
      {copied ? (
        <><Check className="w-4 h-4 text-green-500" /> Copied!</>
      ) : (
        <><Share2 className="w-4 h-4" /> {label}</>
      )}
    </Button>
  )
}
