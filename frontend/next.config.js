const withPWA = require('next-pwa')({
  dest: 'public',
  register: true,
  skipWaiting: true,
  // Disable PWA in development AND in Docker/CI builds (DISABLE_PWA=true).
  // next-pwa 5.x has a known incompatibility with output: 'standalone' when
  // running inside a Docker container — the CopyPlugin fails to resolve the
  // correct output paths. Disable it at build time in those environments.
  disable: process.env.NODE_ENV === 'development' || process.env.DISABLE_PWA === 'true',
  buildExcludes: ['middleware-manifest.json'],
  // REQ-14.6: Serve offline fallback page when the document request fails
  fallbacks: {
    document: '/offline',
  },
})

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  images: {
    domains: ['localhost', 'res.cloudinary.com', 's3.amazonaws.com'],
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
  swcMinify: true,
  compress: true,
  // Code splitting
  experimental: {
    optimizePackageImports: ['lucide-react', '@radix-ui/react-icons'],
  },
  // ── Permissions-Policy header for camera/mic/screen share ───────────────────
  // Use camera=* — this allows camera access for both the top-level page AND
  // same-origin iframes (LiveKit embeds).
  //
  // WHY NOT camera=(self):
  //   In the Permissions Policy spec, allowlist tokens like `self` ONLY apply to
  //   embedded browsing contexts (iframes). For the TOP-LEVEL document, any
  //   non-`*` allowlist results in the policy being "not delegated to the top
  //   level" in some Chrome versions — effectively blocking camera.
  //   This is the root cause of NotAllowedError even when the browser shows
  //   camera as "Allowed" in site settings.
  //
  // chrome://flags/#enable-experimental-web-platform-features confirmed:
  //   camera=(self)  →  top-level page camera BLOCKED by policy
  //   camera=*       →  top-level page camera ALLOWED
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Permissions-Policy',
            value: 'camera=*, microphone=*, display-capture=*',
          },
        ],
      },
    ]
  },
};

module.exports = withPWA(nextConfig);
