import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  serverExternalPackages: ['postgres'],
  async redirects() {
    return [
      // `/api` is what people type when looking for the docs. This matches the
      // exact path only, so the /api/v1/* route handlers are unaffected.
      { source: '/api', destination: '/api-docs', permanent: true },
      // The network page became the about page; keep the old URL working.
      { source: '/network', destination: '/about', permanent: true },
    ]
  },
}

export default nextConfig
