'use client'

import { useRef, useState } from 'react'
import { Upload, X, FileText, Image, Music, File } from 'lucide-react'
import { cn } from '@/lib/utils'

interface FileUploadZoneProps {
  accept?: string
  maxSizeMB?: number
  multiple?: boolean
  onFiles: (files: File[]) => void
  label?: string
  hint?: string
  className?: string
  disabled?: boolean
}

function getFileIcon(type: string) {
  if (type.startsWith('image/')) return Image
  if (type.startsWith('audio/')) return Music
  if (type.includes('pdf') || type.includes('document')) return FileText
  return File
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function FileUploadZone({
  accept, maxSizeMB = 10, multiple = false,
  onFiles, label = 'Drop files here or click to browse',
  hint, className, disabled = false
}: FileUploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [error, setError] = useState('')

  const validate = (files: File[]): File[] => {
    const valid: File[] = []
    const maxBytes = maxSizeMB * 1024 * 1024
    for (const f of files) {
      if (f.size > maxBytes) {
        setError(`"${f.name}" exceeds ${maxSizeMB}MB limit`)
        continue
      }
      valid.push(f)
    }
    return valid
  }

  const handleFiles = (files: FileList | null) => {
    if (!files) return
    setError('')
    const arr = Array.from(files)
    const valid = validate(arr)
    if (valid.length === 0) return
    const next = multiple ? [...selectedFiles, ...valid] : valid
    setSelectedFiles(next)
    onFiles(next)
  }

  const removeFile = (i: number) => {
    const next = selectedFiles.filter((_, idx) => idx !== i)
    setSelectedFiles(next)
    onFiles(next)
  }

  return (
    <div className={cn('space-y-3', className)}>
      <div
        onDragOver={e => { e.preventDefault(); if (!disabled) setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); if (!disabled) handleFiles(e.dataTransfer.files) }}
        onClick={() => !disabled && inputRef.current?.click()}
        className={cn(
          'border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all',
          dragOver ? 'border-halqa-500 bg-halqa-50' : 'border-gray-300 hover:border-halqa-400 hover:bg-gray-50',
          disabled && 'opacity-50 cursor-not-allowed'
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          className="hidden"
          onChange={e => handleFiles(e.target.files)}
          disabled={disabled}
        />
        <div className="w-12 h-12 bg-gray-100 rounded-xl flex items-center justify-center mx-auto mb-3">
          <Upload className="w-6 h-6 text-gray-400" />
        </div>
        <p className="text-sm font-medium text-gray-700">{label}</p>
        {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
        {!hint && <p className="text-xs text-gray-400 mt-1">Max {maxSizeMB}MB{accept ? ` · ${accept}` : ''}</p>}
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}

      {selectedFiles.length > 0 && (
        <div className="space-y-2">
          {selectedFiles.map((f, i) => {
            const Icon = getFileIcon(f.type)
            return (
              <div key={i} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
                <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center border border-gray-200 flex-shrink-0">
                  <Icon className="w-4 h-4 text-gray-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{f.name}</p>
                  <p className="text-xs text-gray-400">{formatSize(f.size)}</p>
                </div>
                <button onClick={() => removeFile(i)} className="text-gray-400 hover:text-red-500 transition-colors flex-shrink-0">
                  <X className="w-4 h-4" />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
