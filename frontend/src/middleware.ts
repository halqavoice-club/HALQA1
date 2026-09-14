import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Public routes that don't require authentication
const PUBLIC_ROUTES = ['/login', '/forgot-password', '/reset-password', '/register', '/change-password']

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
  // camera=* — required for LiveKit camera in live classes (top-level page access)
  // microphone=* — required for LiveKit audio in voice club and live classes
  // geolocation=() — not used, deny it
  'Permissions-Policy': 'camera=*, microphone=*, geolocation=()',
  // Step 9 — CSP (Report-Only mode): collects violations without blocking anything.
  // This allows us to discover any sources we need to allow before switching to
  // enforcing mode. Review the report-uri endpoint and gradually tighten the policy.
  // Switch to Content-Security-Policy (enforcing) once no violations are reported.
  //
  // Current policy:
  //   default-src 'self'       — block unknown sources by default
  //   script-src  'self' + unsafe-inline/eval — required by Next.js (move to nonce later)
  //   style-src   'self' + unsafe-inline — required by Tailwind/styled-jsx
  //   img-src     'self' data: blob: https: — allow images from any https source
  //   font-src    'self' data:             — allow embedded fonts
  //   connect-src 'self' wss: ws:          — allow WebSocket connections
  //   media-src   'self' blob: https:      — allow audio/video
  //   frame-src   'none'                   — no iframes
  'Content-Security-Policy-Report-Only': [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' wss: ws: https:",
    "media-src 'self' blob: https:",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; '),
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

  // Redirect root to feed
  if (pathname === '/') {
    const response = NextResponse.redirect(new URL('/feed', request.url))
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
