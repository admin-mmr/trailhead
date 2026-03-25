/** @type {import('next').NextConfig} */
const nextConfig = {
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
