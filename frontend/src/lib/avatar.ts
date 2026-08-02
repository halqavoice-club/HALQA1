/**
 * Resolves an avatar URL to an absolute URL.
 * Relative paths (e.g. /uploads/avatars/...) are prefixed with the API base.
 */
const API_BASE =
  (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1').replace('/api/v1', '')

export function getAvatarUrl(url: string | null | undefined): string {
  if (!url) return ''
  if (url.startsWith('http')) return url
  return `${API_BASE}${url}`
}

/** Alias — use for any uploaded file path (cover images, logos, etc.) */
export const getFileUrl = getAvatarUrl
