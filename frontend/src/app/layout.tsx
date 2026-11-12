import type { Metadata, Viewport } from 'next'
import { Inter, Noto_Sans_Arabic } from 'next/font/google'
import './globals.css'
import { Providers } from '@/components/providers'
import { Toaster } from '@/components/ui/toaster'


const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })
const notoArabic = Noto_Sans_Arabic({
  subsets: ['arabic'],
  variable: '--font-arabic',
  weight: ['400', '500', '600', '700'],
  display: 'swap'
})

export const metadata: Metadata = {
  title: {
    default: 'Halqa Management System',
    template: '%s | Halqa Management System'
  },
  description: 'Enterprise School ERP & Student Information System for Quran Academies, Schools, and Educational Institutions',
  manifest: '/manifest.json',
  icons: {
    icon: '/icon-192x192.png',
    apple: '/apple-touch-icon.png'
  },
  keywords: ['school management', 'quran academy', 'student information system', 'attendance', 'grades'],
  authors: [{ name: 'Halqa Team' }]
}

export const viewport: Viewport = {
  themeColor: '#1e40af',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        {/* Standard PWA capability tag (required by modern browsers) */}
        <meta name="mobile-web-app-capable" content="yes" />
        {/* Legacy iOS Safari tag — kept for backward compat with older iOS */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
      </head>
      <body className={`${inter.variable} ${notoArabic.variable} font-sans`}>
        <Providers>
          {children}
          <Toaster />
        </Providers>
      </body>
    </html>
  )
}
