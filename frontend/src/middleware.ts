import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Public routes that don't require authentication
const PUBLIC_ROUTES = ['/login', '/forgot-password', '/reset-password', '/register']

// ─── Security headers ─────────────────────────────────────────────────────────
// FE-007: Add security headers to every response.
// Note: 'unsafe-inline' is required by Next.js for styled-jsx and inline scripts.
// A nonce-based CSP would be stronger but requires custom Next.js server setup.
const SECURITY_HEADERS: Record<string, string> = {
  // Prevent MIME type sniffing (FE-006, BE-013)
  'X-Content-Type-Options': 'nosniff',
  // Block clickjacking
  'X-Frame-Options': 'SAMEORIGIN',
  // Prevent XSS reflection in older browsers
  'X-XSS-Protection': '1; mode=block',
  // Enforce HTTPS for 1 year (only in production)
  ...(process.env.NODE_ENV === 'production' && {
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
  }),
  // Restrict Referer leakage on cross-origin navigations
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  // Control browser feature access
  'Permissions-Policy': 'camera=(), microphone=(self), geolocation=()',
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Allow public routes
  if (PUBLIC_ROUTES.some(r => pathname.startsWith(r))) {
    const response = NextResponse.next()
    applySecurityHeaders(response)
    return response
  }

  // Allow static files and API routes
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname.startsWith('/uploads') ||
    pathname.includes('.') // static files
  ) {
    return NextResponse.next()
  }

  // Check for auth token in cookies (set by the backend)
  // Note: Full role-based access control is handled client-side in the layout
  // This middleware only handles the basic auth redirect
  const token = request.cookies.get('refreshToken')

  // If accessing any dashboard route without a token, redirect to login
  const isDashboardRoute =
    !PUBLIC_ROUTES.some(r => pathname.startsWith(r)) &&
    !pathname.startsWith('/_next') &&
    !pathname.startsWith('/api') &&
    !pathname.startsWith('/uploads') &&
    !pathname.includes('.')

  if (!token && isDashboardRoute) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('from', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // Redirect root to dashboard
  if (pathname === '/') {
    const response = NextResponse.redirect(new URL('/dashboard', request.url))
    applySecurityHeaders(response)
    return response
  }

  const response = NextResponse.next()
  applySecurityHeaders(response)
  return response
}

function applySecurityHeaders(response: NextResponse) {
  Object.entries(SECURITY_HEADERS).forEach(([key, value]) => {
    response.headers.set(key, value)
  })
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.json|sw.js|workbox-.*|icon-.*|apple-touch-icon).*)',
  ],
}
