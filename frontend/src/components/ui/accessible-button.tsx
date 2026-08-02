'use client'

import { Button, ButtonProps } from '@/components/ui/button'
import { Loader2 } from 'lucide-react'

interface AccessibleButtonProps extends ButtonProps {
  loading?: boolean
  ariaLabel?: string
  ariaDescribedBy?: string
}

export function AccessibleButton({
  loading = false,
  disabled,
  ariaLabel,
  ariaDescribedBy,
  children,
  ...props
}: AccessibleButtonProps) {
  return (
    <Button
      disabled={disabled || loading}
      aria-label={ariaLabel}
      aria-describedby={ariaDescribedBy}
      aria-busy={loading}
      {...props}
    >
      {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
      {children}
    </Button>
  )
}
