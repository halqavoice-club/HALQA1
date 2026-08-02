'use client'

import { Loader2, AlertCircle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface LoadingStateProps {
  loading?: boolean
  error?: Error | string | null
  onRetry?: () => void
  children: React.ReactNode
  loadingMessage?: string
  errorMessage?: string
}

export function LoadingState({
  loading = false,
  error = null,
  onRetry,
  children,
  loadingMessage = 'Loading...',
  errorMessage,
}: LoadingStateProps) {
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-4" />
        <p className="text-sm text-muted-foreground">{loadingMessage}</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center p-8">
        <AlertCircle className="h-8 w-8 text-destructive mb-4" />
        <p className="text-sm text-muted-foreground mb-4">
          {errorMessage || (typeof error === 'string' ? error : error.message)}
        </p>
        {onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Retry
          </Button>
        )}
      </div>
    )
  }

  return <>{children}</>
}
