import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Public routes that don't require authentication
const PUBLIC_ROUTES = ['/login', '/forgot-password', '/reset-password', '/register', '/change-password']

// ─── Security headers (non-CSP) ───────────────────────────────────────────────
// FE-007: Add security headers to every response.
// CSP is built dynamically per-request below (nonce-based) and therefore
// cannot be defined as a static constant here.
const STATIC_SECURITY_HEADERS: Record<string, string> = {
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
}

// ─── Per-request nonce + enforcing CSP ────────────────────────────────────────
// FE-R-002/003: Replace the static Report-Only CSP with a per-request nonce-
// based enforcing CSP. A fresh cryptographic nonce is generated for every
// request so that only scripts explicitly tagged with that nonce may execute.
// This eliminates 'unsafe-inline' and 'unsafe-eval' from script-src.
//
// Next.js 14 App Router:
//   - Reads the 'x-nonce' response header set here and automatically applies it
//     to its own inline bootstrap scripts (__NEXT_DATA__, etc.).
//   - Explicit <Script> components in layout.tsx should receive nonce={nonce}
//     by reading headers().get('x-nonce') in the Server Component.
//
// Google Sign-In:
//   - accounts.google.com/gsi/client is allowed via its origin in script-src.
//   - Its inline styles are served via accounts.google.com/gsi/style (style-src).
//
// font-src includes data: because Next.js inlines some font data URIs.
// frame-src allows accounts.google.com/gsi/ for the Google One-Tap iframe.
function buildCspHeader(nonce: string): string {
  return [
    "default-src 'self'",
    // nonce covers Next.js bootstrap scripts and any explicit <Script nonce> tags.
    // Google GSI client is loaded from its own origin (no unsafe-inline needed).
    `script-src 'self' 'nonce-${nonce}' https://accounts.google.com/gsi/client`,
    // unsafe-inline kept for style-src only — required by Tailwind, styled-jsx,
    // and CSS-in-JS. Nonce-based style CSP is a future improvement.
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com/gsi/style",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data: https://fonts.gstatic.com",
    "connect-src 'self' wss: ws: https: https://accounts.google.com/gsi/",
    "media-src 'self' blob: https:",
    "frame-src 'none' https://accounts.google.com/gsi/",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ')
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Generate a fresh cryptographic nonce for every request (FE-R-002/003).
  // Buffer.from encodes the UUID as base64, producing a ~44-char string that
  // is safe to embed in an HTTP header and in HTML attribute values.
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')

  // Allow public routes
  if (PUBLIC_ROUTES.some(r => pathname.startsWith(r))) {
    const response = NextResponse.next()
    applySecurityHeaders(response, nonce, false) // Report-Only on public pages
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
    applySecurityHeaders(response, nonce)
    return response
  }

  const response = NextResponse.next()
  applySecurityHeaders(response, nonce)
  return response
}

function applySecurityHeaders(response: NextResponse, nonce: string, enforcing = true) {
  // Apply all static headers
  Object.entries(STATIC_SECURITY_HEADERS).forEach(([key, value]) => {
    response.headers.set(key, value)
  })

  // Enforcing nonce-based CSP is only applied in production.
  // In development and test (NODE_ENV !== 'production'), Next.js uses
  // static build chunks that don't carry the per-request nonce, so an
  // enforcing CSP would block hydration. We use Report-Only there so
  // the policy is visible in DevTools without blocking anything.
  const isProduction = process.env.NODE_ENV === 'production'

  if (enforcing && isProduction) {
    // Production authenticated routes: enforcing nonce-based CSP.
    response.headers.set('Content-Security-Policy', buildCspHeader(nonce))
    response.headers.set('x-nonce', nonce)
  } else {
    // Non-production OR public routes: Report-Only CSP (observe, don't block).
    response.headers.set('Content-Security-Policy-Report-Only', buildCspHeader(nonce))
  }
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.json|sw.js|workbox-.*|icon-.*|apple-touch-icon).*)',
  ],
}
