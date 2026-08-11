import type { Metadata } from 'next'
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
        {/* In the layout so every route carries the same navigation. */}
        <SiteNav />
        {children}
      </body>
    </html>
  )
}
