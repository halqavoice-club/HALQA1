/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',

  // ── Backend API proxy ──────────────────────────────────────────────────────
  // Rewrites /api/v1/* → backend at NEXT_PUBLIC_API_URL.
  // This solves the SameSite=strict cookie problem: the backend sets the
  // httpOnly refreshToken cookie with SameSite=strict, which the browser
  // only sends to the same origin. By proxying auth/refresh through the
  // Next.js server (same origin as the frontend), the cookie is forwarded
  // correctly on page reload — allowing silent token refresh to work.
  async rewrites() {
    const apiBase = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1')
      .replace(/\/$/, '')
    // Strip the /api/v1 suffix — rewrite destination includes it already
    const backendOrigin = apiBase.replace(/\/api\/v1$/, '')
    return [
      {
        source: '/api/v1/:path*',
        destination: `${backendOrigin}/api/v1/:path*`,
      },
    ]
  },
  images: {
    // REQ-14.5: Explicit R2 / Cloudflare remote patterns so Next.js Image
    // does not emit "hostname not configured" warnings for those domains.
    remotePatterns: [
      // R2 public bucket URLs
      { protocol: 'https', hostname: '*.r2.cloudflarestorage.com' },
      // Cloudflare Images / CDN
      { protocol: 'https', hostname: '*.cloudflare.com' },
      // Custom public hostname configured per deployment (e.g. cdn.example.com)
      ...(process.env.NEXT_PUBLIC_R2_PUBLIC_HOSTNAME
        ? [{ protocol: 'https', hostname: process.env.NEXT_PUBLIC_R2_PUBLIC_HOSTNAME }]
        : []),
      // Wildcard fallback for any other HTTPS sources
      { protocol: 'https', hostname: '**' },
    ].filter(p => p.hostname),
  },
  env: {
    NEXT_PUBLIC_API_URL:     process.env.NEXT_PUBLIC_API_URL     || 'http://localhost:5000/api/v1',
    NEXT_PUBLIC_SOCKET_URL:  process.env.NEXT_PUBLIC_SOCKET_URL  || 'http://localhost:5000',
    NEXT_PUBLIC_LIVEKIT_URL: process.env.NEXT_PUBLIC_LIVEKIT_URL || '',
  },
  // Performance optimizations
  compress: true,
  // Code splitting
  experimental: {
    optimizePackageImports: ['lucide-react', '@radix-ui/react-icons'],
  },
  // ── Permissions-Policy header ────────────────────────────────────────────────
  // AUDIT-043-SEC FIX: Removed the duplicate headers() block that was setting
  // Permissions-Policy from next.config.js.
  //
  // This caused TWO Permissions-Policy headers to be delivered to the browser:
  //   1. next.config.js headers(): camera=*, microphone=*, display-capture=*
  //   2. frontend/src/proxy.ts:  camera=*, microphone=*, geolocation=()
  //
  // The canonical Permissions-Policy is now set exclusively in
  // frontend/src/proxy.ts so there is one authoritative source and
  // no risk of conflicting values accumulating across layers.
  //
  // The policy required by LiveKit (camera=*, microphone=*) is preserved there.
  // display-capture=* is included in proxy.ts if screen sharing is needed.
};

module.exports = nextConfig;
