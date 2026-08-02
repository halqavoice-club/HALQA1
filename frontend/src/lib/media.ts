/**
 * media.ts — Shared utility for resolving media/upload URLs
 *
 * Local dev:  files are served from backend at http://localhost:5000/uploads/...
 * Production: files are served from Cloudflare R2 CDN (full https:// URL)
 *
 * Rule: if the stored URL starts with '/', prepend the backend origin.
 *       Otherwise return as-is (already a full URL).
 */

const BACKEND_ORIGIN =
  (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1')
    .replace('/api/v1', '')
    .replace(/\/$/, '')

/**
 * Resolve a stored media URL to a fully-qualified URL safe for <img src> or <video src>.
 *
 * @param url  - The URL stored in the database (e.g. '/uploads/media/uuid.png'
 *               or 'https://cdn.example.com/uuid.png')
 * @returns    A fully-qualified URL string, or empty string if url is falsy.
 */
export function resolveMediaUrl(url: string | null | undefined): string {
  if (!url) return ''
  if (url.startsWith('/')) return `${BACKEND_ORIGIN}${url}`
  return url
}
