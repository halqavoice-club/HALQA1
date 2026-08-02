'use client'

import { useRef, useState } from 'react'
import { Camera, Loader2, X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface AvatarUploadProps {
  currentUrl?: string | null
  name?: string
  size?: 'sm' | 'md' | 'lg'
  uploading?: boolean
  onFileSelect: (file: File) => void
  onRemove?: () => void
  className?: string
}

const sizeMap = { sm: 'w-12 h-12', md: 'w-20 h-20', lg: 'w-28 h-28' }
const textMap = { sm: 'text-sm', md: 'text-xl', lg: 'text-3xl' }
const btnMap  = { sm: 'w-5 h-5 -bottom-0.5 -right-0.5', md: 'w-7 h-7 -bottom-1 -right-1', lg: 'w-8 h-8 -bottom-1 -right-1' }

export function AvatarUpload({ currentUrl, name = '', size = 'md', uploading, onFileSelect, onRemove, className }: AvatarUploadProps) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<string | null>(null)

  const initials = name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || '?'
  const src = preview || currentUrl

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setPreview(URL.createObjectURL(file))
    onFileSelect(file)
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <div className={cn('relative inline-block', className)}>
      <div className={cn('rounded-full overflow-hidden bg-halqa-100 flex items-center justify-center ring-4 ring-white shadow-md', sizeMap[size])}>
        {src ? (
          <img src={src} alt={name} className="w-full h-full object-cover" />
        ) : (
          <span className={cn('font-bold text-halqa-700', textMap[size])}>{initials}</span>
        )}
        {uploading && (
          <div className="absolute inset-0 bg-black/40 flex items-center justify-center rounded-full">
            <Loader2 className="w-5 h-5 text-white animate-spin" />
          </div>
        )}
      </div>

      {/* Camera button */}
      {!uploading && (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className={cn('absolute bg-halqa-700 hover:bg-halqa-800 text-white rounded-full flex items-center justify-center shadow-md transition-colors', btnMap[size])}
          title="Change photo"
        >
          <Camera className="w-3 h-3" />
        </button>
      )}

      {/* Remove button */}
      {src && !uploading && onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center shadow-md transition-colors"
          title="Remove photo"
        >
          <X className="w-2.5 h-2.5" />
        </button>
      )}

      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={handleChange} />
    </div>
  )
}
