import { type NextRequest, NextResponse } from 'next/server'

/**
 * Tags each request with the visitor's region so the consent banner can be
 * shown only where it is legally required.
 *
 * The decision is made here, at the edge, rather than in a page: reading
 * request headers inside a Server Component would opt every page out of static
 * rendering, and a pricing site that has to be server-rendered per request to
 * decide whether to show a cookie banner has made a bad trade.
 *
 * Instead the HTML stays identical and cacheable for everyone, and a cookie
 * carries the region for the client to act on.
 */

/** EU 27 plus the rest of the EEA, the UK and Switzerland. */
const CONSENT_REQUIRED = new Set([
  // EU
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR',
  'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK',
  'SI', 'ES', 'SE',
  // EEA
  'IS', 'LI', 'NO',
  // UK (UK GDPR / PECR) and Switzerland (revFADP)
  'GB', 'CH',
])

export const REGION_COOKIE = 'cot-region'

export function middleware(request: NextRequest) {
  const response = NextResponse.next()

  // Set by Vercel's edge network. Absent locally, which is handled on the
  // client by falling back to the browser's timezone.
  const country = request.headers.get('x-vercel-ip-country')?.toUpperCase()

  // Only write when the value would change. Re-sending an identical cookie on
  // every response is pure overhead, and it also means a value already present
  // is left alone rather than being clobbered on each navigation.
  const region = country ? (CONSENT_REQUIRED.has(country) ? 'eu' : 'other') : null
  const existing = request.cookies.get(REGION_COOKIE)?.value

  if (region && region !== existing) {
    response.cookies.set(REGION_COOKIE, region, {
      // Readable by the banner script; it carries no personal data, only a
      // coarse yes/no about which rules apply.
      httpOnly: false,
      sameSite: 'lax',
      secure: true,
      path: '/',
      maxAge: 60 * 60 * 24,
    })
  }

  return response
}

export const config = {
  // Skip assets and API routes — only page requests need the region tag.
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|llms.txt|llms-full.txt).*)'],
}
