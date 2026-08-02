const withPWA = require('next-pwa')({
  dest: 'public',
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === 'development',
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
};

module.exports = withPWA(nextConfig);
