import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { LanguageProvider } from '@/lib/i18n/context'
import NavbarServer from '@/components/layout/NavbarServer'
import Footer from '@/components/layout/Footer'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: {
    template: '%s | Misty Mountain Runners · 岚山跑团',
    default:  'Misty Mountain Runners · 岚山跑团',
  },
  description:
    "New York's premier Chinese-American running community. NYRR club team. 501(c)(3) nonprofit.",
  metadataBase: new URL('https://www.mmrunners.org'),
  openGraph: {
    type: 'website',
    siteName: 'Misty Mountain Runners',
    images: ['/images/og-image.jpg'],
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.className} antialiased bg-white text-gray-900`}>
        <LanguageProvider>
          <NavbarServer />
          {children}
          <Footer />
        </LanguageProvider>
      </body>
    </html>
  )
}
