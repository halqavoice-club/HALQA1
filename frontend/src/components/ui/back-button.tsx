'use client'

import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import Link from 'next/link'

interface BackButtonProps {
  href?: string
  label?: string
  className?: string
}

export function BackButton({ href, label = 'Back', className }: BackButtonProps) {
  const router = useRouter()

  const cls = cn(
    'inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors',
    className
  )

  if (href) {
    return (
      <Link href={href} className={cls}>
        <ArrowLeft className="w-4 h-4" />
        {label}
      </Link>
    )
  }

  return (
    <button type="button" onClick={() => router.back()} className={cls}>
      <ArrowLeft className="w-4 h-4" />
      {label}
    </button>
  )
}
