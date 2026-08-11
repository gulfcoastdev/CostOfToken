import { NextResponse } from 'next/server'

export const runtime = 'edge'
export const dynamic = 'force-dynamic'

/**
 * Whether the caller is somewhere that requires consent before analytics
 * cookies are set.
 *
 * This exists as a tiny endpoint rather than middleware on purpose. Middleware
 * that sets a cookie makes Next mark the page response `no-store`, which
 * silently disables CDN caching for every page it touches — the home page
 * stopped being cacheable and re-rendered against the database on every
 * request. Keeping the region check out of the page response means every page
 * stays fully cacheable, and only visitors who still need to be asked make
 * this one small call.
 */
const CONSENT_REQUIRED = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR',
  'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK',
  'SI', 'ES', 'SE',
  'IS', 'LI', 'NO',
  'GB', 'CH',
])

export function GET(request: Request): NextResponse {
  const country = request.headers.get('x-vercel-ip-country')?.toUpperCase() ?? null

  return NextResponse.json(
    {
      // null when the header is absent (local development), which tells the
      // client to fall back to its own timezone rather than guess.
      consentRequired: country ? CONSENT_REQUIRED.has(country) : null,
    },
    { headers: { 'cache-control': 'no-store' } },
  )
}
