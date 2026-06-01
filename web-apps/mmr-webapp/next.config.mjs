import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url)))

// Build identity — evaluated once at `next build` time. BUILD_SHA is supplied
// by the deploy workflow (github.sha); falls back to GITHUB_SHA, then 'local'.
const BUILD_SHA = (process.env.BUILD_SHA || process.env.GITHUB_SHA || 'local').slice(0, 7)
const BUILD_TIME = new Date().toISOString()

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
    NEXT_PUBLIC_BUILD_SHA: BUILD_SHA,
    NEXT_PUBLIC_BUILD_TIME: BUILD_TIME,
  },
  // Suppress webpack warnings about missing optional SWC platform binaries
  // (e.g. @next/swc-win32-ia32-msvc on macOS/Linux). These are harmless —
  // Next.js ships binaries for every OS but only installs the relevant one.
  webpack(config) {
    config.infrastructureLogging = {
      ...config.infrastructureLogging,
      // Only show errors, not the "Managed item isn't a directory" warnings
      level: 'error',
    }
    return config
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.blob.core.windows.net' }, // Azure Blob Storage
      { protocol: 'https', hostname: 'lh3.googleusercontent.com' }, // Google profile pics
    ],
  },
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ]
  },
}

export default nextConfig
