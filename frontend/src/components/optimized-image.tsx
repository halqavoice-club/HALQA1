'use client'

import Image, { ImageProps } from 'next/image'
import { useState } from 'react'
import { Loader2 } from 'lucide-react'

interface OptimizedImageProps extends Omit<ImageProps, 'onLoad' | 'onError'> {
  fallback?: string
  showLoader?: boolean
}

export function OptimizedImage({
  fallback = '/placeholder.png',
  showLoader = true,
  alt,
  ...props
}: OptimizedImageProps) {
  const [isLoading, setIsLoading] = useState(true)
  const [hasError, setHasError] = useState(false)

  return (
    <div className="relative overflow-hidden">
      {isLoading && showLoader && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )}
      <Image
        {...props}
        alt={alt}
        onLoad={() => setIsLoading(false)}
        onError={() => {
          setIsLoading(false)
          setHasError(true)
        }}
        src={hasError ? fallback : props.src}
      />
    </div>
  )
}
