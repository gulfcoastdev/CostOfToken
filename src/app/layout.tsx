import type { Metadata } from 'next'
import { Analytics } from '@/components/analytics.tsx'
import { ConsentBanner } from '@/components/consent-banner.tsx'
import { SiteFooter } from '@/components/site-chrome.tsx'
import { SiteNav } from '@/components/site-nav.tsx'
import { SITE, SITE_URL } from '@/lib/seo.ts'
import './globals.css'

export const metadata: Metadata = {
  // Makes every relative canonical/OG URL in child pages absolute.
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE.name} — ${SITE.tagline}`,
    // Child pages supply only their own subject; the brand is appended here so
    // no page has to repeat it and titles stay within a sensible length.
    template: `%s — ${SITE.name}`,
  },
  description: SITE.description,
  applicationName: SITE.name,
  keywords: [
    'LLM pricing',
    'LLM API pricing',
    'cost per token',
    'token pricing comparison',
    'OpenAI API pricing',
    'Anthropic Claude pricing',
    'Gemini API pricing',
    'Grok API pricing',
    'DeepSeek pricing',
    'cheapest LLM API',
  ],
  alternates: {
    canonical: '/',
    types: {
      'application/json': [{ url: '/api/v1/prices', title: 'Current prices (JSON API)' }],
      'text/markdown': [{ url: '/llms-full.txt', title: 'Complete pricing table (markdown)' }],
      // Feed autodiscovery. A reader handed only the site address finds the
      // changelog through this, which is the only way most subscriptions ever
      // start — nobody types /feed.xml.
      'application/rss+xml': [
        { url: '/feed.xml', title: 'CostOfToken — new models and price changes' },
      ],
    },
  },
  openGraph: {
    type: 'website',
    siteName: SITE.name,
    title: `${SITE.name} — ${SITE.tagline}`,
    description: SITE.description,
    url: '/',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary_large_image',
    title: `${SITE.name} — ${SITE.tagline}`,
    description: SITE.description,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-snippet': -1,
      'max-image-preview': 'large',
      'max-video-preview': -1,
    },
  },
  category: 'technology',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      {/*
        Light page, white cards. The page sits a shade off pure white so the
        cards read as raised surfaces against it rather than dissolving into
        the background. Body text colour is set explicitly rather than left to
        inherit, so anything added outside a card is legible by default.
      */}
      <body className="min-h-screen bg-[#F7F6F4] text-neutral-900 antialiased">
        {/*
          Feed autodiscovery, declared here rather than in `metadata.alternates`
          because a page that sets its own `alternates` (every page does, for
          its canonical URL) replaces the layout's entry wholesale — which
          silently dropped this link from all of them. Rendered as an element,
          React hoists it into <head> on every route instead.
        */}
        <link
          rel="alternate"
          type="application/rss+xml"
          title={`${SITE.name} — new models and price changes`}
          href="/feed.xml"
        />
        {/* In the layout so every route carries the same navigation. */}
        <SiteNav />
        {/* Operator-requested WIP banner (2026-08-29): the cross-provider
            comparison relaunch is live but still growing. Remove when the
            full version ships. */}
        <div className="border-b border-amber-200 bg-amber-50 px-5 py-2 text-center text-[13px] text-amber-900">
          <span aria-hidden="true">🚧</span> Fresh paint, wet floors — we&apos;re
          rebuilding CostOfToken into a cross-provider price comparison.
          Some corners are still under construction; the full version is
          coming up soon. <span aria-hidden="true">🚀</span>
        </div>
        {children}
        {/*
          The footer is here for the same reason the nav is, learned the hard
          way: it used to be rendered by each page individually, so the home
          page grew a smaller variant of its own and the error state had none
          at all — leaving a reader who hit a failed page with no way onward.
          Rendered once, "every page has exactly one footer" stops depending on
          each new page remembering to add it.

          It supplies its own container because it no longer sits inside
          PageShell, which is where it used to inherit its width and padding.
        */}
        <div className="mx-auto max-w-[1120px] px-5 pb-14">
          <SiteFooter />
        </div>
        <Analytics />
        <ConsentBanner />
      </body>
    </html>
  )
}
