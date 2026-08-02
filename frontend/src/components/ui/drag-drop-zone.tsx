'use client'

import { useState, useCallback } from 'react'
import { UploadCloud, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/use-toast'

interface DragDropZoneProps {
  onDrop: (files: File[]) => void
  accept?: string
  multiple?: boolean
  maxSize?: number // in bytes
  maxFiles?: number
  disabled?: boolean
  className?: string
}

export function DragDropZone({
  onDrop,
  accept = '*/*',
  multiple = false,
  maxSize = 10 * 1024 * 1024, // 10MB default
  maxFiles = 10,
  disabled = false,
  className = '',
}: DragDropZoneProps) {
  const [isDragging, setIsDragging] = useState(false)
  const [files, setFiles] = useState<File[]>([])
  const { toast } = useToast()

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!disabled) setIsDragging(true)
  }, [disabled])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragging(false)

      if (disabled) return

      const droppedFiles = Array.from(e.dataTransfer.files)
      const validFiles = droppedFiles.filter((file) => {
        // Check file type
        if (accept !== '*/*') {
          const acceptedTypes = accept.split(',').map((t) => t.trim())
          const isAccepted = acceptedTypes.some((type) => {
            if (type.startsWith('.')) {
              return file.name.toLowerCase().endsWith(type.toLowerCase())
            }
            return file.type.match(type.replace('*', '.*'))
          })
          if (!isAccepted) return false
        }

        // Check file size
        if (file.size > maxSize) return false

        return true
      })

      // Check max files
      if (maxFiles && validFiles.length > maxFiles) {
        toast({
          title: 'Too many files',
          description: `Maximum ${maxFiles} files allowed`,
          variant: 'destructive',
        })
        return
      }

      if (validFiles.length === 0) {
        toast({
          title: 'Invalid files',
          description: 'Please check file type and size requirements',
          variant: 'destructive',
        })
        return
      }

      setFiles(validFiles)
      onDrop(validFiles)
    },
    [accept, maxSize, maxFiles, disabled, onDrop, toast]
  )

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const selectedFiles = Array.from(e.target.files || [])
      setFiles(selectedFiles)
      onDrop(selectedFiles)
    },
    [onDrop]
  )

  const removeFile = useCallback(
    (index: number) => {
      setFiles((prev) => {
        const newFiles = prev.filter((_, i) => i !== index)
        onDrop(newFiles)
        return newFiles
      })
    },
    [onDrop]
  )

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i]
  }

  return (
    <div className={`space-y-4 ${className}`}>
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`
          relative border-2 border-dashed rounded-lg p-8 text-center transition-colors
          ${isDragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-muted-foreground/50'}
          ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
        `}
      >
        <input
          type="file"
          accept={accept}
          multiple={multiple}
          onChange={handleFileInput}
          disabled={disabled}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        />
        <UploadCloud className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
        <p className="text-sm font-medium mb-2">
          {isDragging ? 'Drop files here' : 'Drag and drop files here'}
        </p>
        <p className="text-xs text-muted-foreground mb-4">
          or click to browse
        </p>
        <p className="text-xs text-muted-foreground">
          {accept !== '*/*' && `Accepted: ${accept}`}
          {maxSize && ` • Max size: ${formatFileSize(maxSize)}`}
          {maxFiles && ` • Max files: ${maxFiles}`}
        </p>
      </div>

      {files.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">Selected files:</p>
          {files.map((file, index) => (
            <div
              key={index}
              className="flex items-center justify-between p-3 border rounded bg-card"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{file.name}</p>
                <p className="text-xs text-muted-foreground">
                  {formatFileSize(file.size)}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => removeFile(index)}
                disabled={disabled}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
