'use client'

import { createElement } from 'react'
import { FileText, Image, Music, Video, File, X, Download, Eye } from 'lucide-react'
import { cn } from '@/lib/utils'

interface FilePreviewProps {
  name: string
  size?: number
  type?: string
  url?: string
  onRemove?: () => void
  className?: string
}

function getIcon(type?: string) {
  if (!type) return File
  if (type.startsWith('image/')) return Image
  if (type.startsWith('audio/')) return Music
  if (type.startsWith('video/')) return Video
  if (type.includes('pdf') || type.includes('document') || type.includes('text')) return FileText
  return File
}

function formatSize(bytes?: number) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function FilePreview({ name, size, type, url, onRemove, className }: FilePreviewProps) {
  const iconType = getIcon(type)
  const isImage = type?.startsWith('image/')

  return (
    <div className={cn(
      'flex items-center gap-3 p-3 rounded-xl border border-gray-200 bg-gray-50 group',
      className
    )}>
      {/* Thumbnail or icon */}
      <div className="w-10 h-10 rounded-lg overflow-hidden flex-shrink-0 bg-white border border-gray-200 flex items-center justify-center">
        {isImage && url ? (
          <img src={url} alt={name} className="w-full h-full object-cover" />
        ) : (
          createElement(iconType, { className: 'w-5 h-5 text-gray-400' })
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">{name}</p>
        {size && <p className="text-xs text-gray-400">{formatSize(size)}</p>}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1.5 rounded-lg hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors"
            title="Preview"
          >
            <Eye className="w-4 h-4" />
          </a>
        )}
        {url && (
          <a
            href={url}
            download={name}
            className="p-1.5 rounded-lg hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors"
            title="Download"
          >
            <Download className="w-4 h-4" />
          </a>
        )}
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
            title="Remove"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  )
}

// List of file previews
interface FilePreviewListProps {
  files: { name: string; size?: number; type?: string; url?: string }[]
  onRemove?: (index: number) => void
  className?: string
}

export function FilePreviewList({ files, onRemove, className }: FilePreviewListProps) {
  if (files.length === 0) return null
  return (
    <div className={cn('space-y-2', className)}>
      {files.map((file, i) => (
        <FilePreview
          key={i}
          {...file}
          onRemove={onRemove ? () => onRemove(i) : undefined}
        />
      ))}
    </div>
  )
}
