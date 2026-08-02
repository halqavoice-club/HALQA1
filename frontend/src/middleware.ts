import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Public routes that don't require authentication
const PUBLIC_ROUTES = ['/login', '/forgot-password', '/reset-password', '/register']

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Allow public routes
  if (PUBLIC_ROUTES.some(r => pathname.startsWith(r))) {
    return NextResponse.next()
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
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.json|sw.js|workbox-.*|icon-.*|apple-touch-icon).*)',
  ],
}
