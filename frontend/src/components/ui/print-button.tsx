'use client'

import { Printer } from 'lucide-react'
import { Button } from './button'
import { cn } from '@/lib/utils'

interface PrintButtonProps {
  label?: string
  className?: string
  variant?: 'default' | 'outline' | 'ghost'
  size?: 'sm' | 'default' | 'lg'
  targetId?: string   // print specific element by ID
}

export function PrintButton({ label = 'Print', className, variant = 'outline', size = 'sm', targetId }: PrintButtonProps) {
  const handlePrint = () => {
    if (targetId) {
      const el = document.getElementById(targetId)
      if (!el) return
      const win = window.open('', '_blank')
      if (!win) return
      win.document.write(`
        <html>
          <head>
            <title>Print</title>
            <style>
              body { font-family: Arial, sans-serif; margin: 20px; }
              * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            </style>
          </head>
          <body>${el.innerHTML}</body>
        </html>
      `)
      win.document.close()
      win.print()
      win.close()
    } else {
      window.print()
    }
  }

  return (
    <Button
      variant={variant}
      size={size}
      onClick={handlePrint}
      className={cn('gap-2 no-print', className)}
    >
      <Printer className="w-4 h-4" />
      {label}
    </Button>
  )
}
