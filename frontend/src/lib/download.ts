'use client'

import api from './api'

/**
 * Download a file from the API with proper auth headers.
 * Uses axios (which includes the JWT token) instead of window.open().
 */
export async function downloadFile(
  endpoint: string,
  params: Record<string, string | undefined>,
  filename: string
) {
  try {
    const response = await api.get(endpoint, {
      params,
      responseType: 'blob'
    })

    const blob = new Blob([response.data], {
      type: response.headers['content-type'] || 'application/octet-stream'
    })

    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)

    return true
  } catch (error) {
    if (process.env.NODE_ENV === 'development') {
      console.error('Download failed:', error)
    }
    throw error
  }
}

export function buildFilename(type: string, ext: string, extra?: string) {
  const date = new Date().toISOString().split('T')[0]
  return extra
    ? `${type}-${extra}-${date}.${ext}`
    : `${type}-${date}.${ext}`
}
