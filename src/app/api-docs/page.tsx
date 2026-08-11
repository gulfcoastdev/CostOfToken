import type { Metadata } from 'next'
import Link from 'next/link'
import { Breadcrumbs, JsonLd, PageShell, SiteFooter } from '@/components/site-chrome.tsx'
import { getLastUpdated, getPrices } from '@/lib/queries.ts'
import { absoluteUrl, breadcrumbSchema, faqSchema, SITE } from '@/lib/seo.ts'

export const revalidate = 3600

const TITLE = 'Free LLM Pricing API — JSON, No Signup'
const DESCRIPTION =
  'A free public JSON API for LLM pricing across 10 providers. Current prices, per-model detail and price history. No signup, no key required, 60 requests per hour.'

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/api-docs' },
  openGraph: { title: `${TITLE} — CostOfToken`, description: DESCRIPTION, url: '/api-docs' },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
}

const FAQS = [
  {
    question: 'Is the CostOfToken API free?',
    answer:
      'Yes. No signup and no API key. Anonymous callers get 60 requests per hour per IP; responses carry X-RateLimit headers and a 429 includes Retry-After.',
  },
  {
    question: 'How often does the pricing data change?',
    answer:
      'Prices are re-read from each provider once a day. A value is only recorded when it actually changes, so the history endpoint returns real price movements rather than one row per day.',
  },
  {
    question: 'Can I use this data commercially?',
    answer:
      'Yes, and attribution is appreciated. Always confirm a price against the provider before committing spend — rows sourced from a reseller are marked source_kind "api" and can differ from the vendor’s own rate.',
  },
]

export default async function ApiDocsPage() {
  let modelCount = 0
  let updatedAt: string | null = null
  try {
    const [page, lastUpdated] = await Promise.all([
      getPrices({ limit: 1, offset: 0, sort: 'input', direction: 'asc' }),
      getLastUpdated(),
    ])
    modelCount = page.total
    updatedAt = lastUpdated
  } catch {
    // The documentation is useful even if the live counts are unavailable.
  }

  return (
    <PageShell>
      <JsonLd
        nodes={[
          breadcrumbSchema([
            { name: 'LLM pricing', path: '/' },
            { name: 'API', path: '/api-docs' },
          ]),
          {
            '@type': 'WebAPI',
            '@id': absoluteUrl('/api-docs#api'),
            name: `${SITE.name} pricing API`,
            description: DESCRIPTION,
            documentation: absoluteUrl('/api-docs'),
            termsOfService: absoluteUrl('/api-docs'),
            provider: { '@id': absoluteUrl('/#organization') },
            isAccessibleForFree: true,
          },
          faqSchema(FAQS),
        ]}
      />

      <Breadcrumbs trail={[{ name: 'LLM pricing', path: '/' }, { name: 'API' }]} />

      <header className="mb-6">
        <h1 className="m-0 text-3xl font-bold tracking-tight text-neutral-950">Pricing API</h1>
        <p className="mt-2 max-w-3xl text-[15px] leading-relaxed text-neutral-700">
          Every price on this site is available as JSON. Free, no signup, no key.{' '}
          {modelCount > 0 && (
            <>
              Currently {modelCount} models across 10 providers
              {updatedAt ? `, last updated ${updatedAt.slice(0, 10)}` : ''}.
            </>
          )}
        </p>
      </header>

      <section className="mb-8">
        <h2 className="mb-3 text-xl font-semibold tracking-tight text-neutral-950">Try it</h2>
        <pre className="overflow-x-auto rounded-xl border border-neutral-200 bg-neutral-900 p-4 text-[13px] leading-relaxed text-neutral-100">
          <code>{`curl '${SITE.url}/api/v1/prices?provider=anthropic&sort=input'`}</code>
        </pre>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-xl font-semibold tracking-tight text-neutral-950">Endpoints</h2>
        <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-xs font-semibold text-neutral-500">
                <th scope="col" className="px-4 py-2.5">Endpoint</th>
                <th scope="col" className="px-4 py-2.5">Returns</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['/api/v1/prices', 'Current prices for every model'],
                ['/api/v1/prices/:model_id', 'One model with its latest price'],
                ['/api/v1/history/:model_id', 'Historical price points, newest first'],
                ['/api/v1/providers', 'Providers with active model counts'],
              ].map(([path, desc]) => (
                <tr key={path} className="border-b border-neutral-100 last:border-0">
                  <td className="px-4 py-2.5">
                    <a
                      href={path}
                      className="font-mono text-[13px] text-emerald-700 underline underline-offset-2"
                    >
                      {path}
                    </a>
                  </td>
                  <td className="px-4 py-2.5 text-neutral-700">{desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-xl font-semibold tracking-tight text-neutral-950">
          Query parameters for <code className="font-mono text-[15px]">/prices</code>
        </h2>
        <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-xs font-semibold text-neutral-500">
                <th scope="col" className="px-4 py-2.5">Parameter</th>
                <th scope="col" className="px-4 py-2.5">Values</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['provider', 'Slug, repeatable or comma-separated: openai,anthropic'],
                ['modality', 'text · vision · audio · video · image'],
                ['tag', 'flagship · fast · reasoning · coding · vision'],
                ['q', 'Substring match on model id or display name'],
                ['min_input, max_input', 'Bounds on input price per 1M tokens'],
                ['min_context', 'Minimum context window in tokens'],
                ['sort', 'provider · model · input · cached_input · output · context · updated'],
                ['order', 'asc (default) · desc'],
                ['limit, offset', '1–500 (default 100), offset ≥ 0'],
              ].map(([param, values]) => (
                <tr key={param} className="border-b border-neutral-100 last:border-0">
                  <td className="px-4 py-2.5 font-mono text-[13px] text-neutral-900">{param}</td>
                  <td className="px-4 py-2.5 text-neutral-700">{values}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-xl font-semibold tracking-tight text-neutral-950">
          Fields worth knowing
        </h2>
        <ul className="space-y-2 pl-5 text-[15px] leading-relaxed text-neutral-700">
          <li>
            All prices are <strong>USD per 1,000,000 tokens</strong> on the standard tier. Batch,
            Flex and Priority tiers are excluded — they are not comparable across vendors.
          </li>
          <li>
            <code className="font-mono text-[13px]">0</code> means genuinely free.{' '}
            <code className="font-mono text-[13px]">null</code> means the provider publishes no such
            tier. They are different.
          </li>
          <li>
            <code className="font-mono text-[13px]">source_kind</code> is{' '}
            <code className="font-mono text-[13px]">scrape</code> for a vendor&apos;s own page or{' '}
            <code className="font-mono text-[13px]">api</code> for the OpenRouter catalogue — a
            reseller whose price can differ. Check it before treating a figure as authoritative.
          </li>
          <li>
            <code className="font-mono text-[13px]">long_input</code> and{' '}
            <code className="font-mono text-[13px]">long_context_threshold</code> describe the
            higher rate some models charge above a prompt-size threshold.
          </li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-xl font-semibold tracking-tight text-neutral-950">Rate limits</h2>
        <p className="m-0 text-[15px] leading-relaxed text-neutral-700">
          60 requests per hour per IP. Every response carries{' '}
          <code className="font-mono text-[13px]">X-RateLimit-Limit</code>,{' '}
          <code className="font-mono text-[13px]">X-RateLimit-Remaining</code> and{' '}
          <code className="font-mono text-[13px]">X-RateLimit-Reset</code>; exceeding the quota
          returns <code className="font-mono text-[13px]">429</code> with{' '}
          <code className="font-mono text-[13px]">Retry-After</code>. Windows are fixed and reset on
          the hour.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-xl font-semibold tracking-tight text-neutral-950">
          For LLMs and agents
        </h2>
        <p className="m-0 text-[15px] leading-relaxed text-neutral-700">
          <a href="/llms-full.txt" className="text-emerald-700 underline underline-offset-2">
            /llms-full.txt
          </a>{' '}
          serves every tracked price as a single markdown document, so a model can ingest the whole
          dataset in one fetch.{' '}
          <a href="/llms.txt" className="text-emerald-700 underline underline-offset-2">
            /llms.txt
          </a>{' '}
          indexes the site. Please quote the last-updated date alongside any price.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-xl font-semibold tracking-tight text-neutral-950">Questions</h2>
        <dl className="space-y-3">
          {FAQS.map((faq) => (
            <div key={faq.question} className="rounded-xl border border-neutral-200 bg-white px-5 py-4">
              <dt className="font-semibold text-neutral-900">{faq.question}</dt>
              <dd className="m-0 mt-1.5 text-[15px] leading-relaxed text-neutral-700">{faq.answer}</dd>
            </div>
          ))}
        </dl>
      </section>

      <p className="mb-6 text-[15px]">
        <Link href="/providers" className="font-medium text-emerald-700 underline underline-offset-2">
          Browse pricing by provider →
        </Link>
      </p>

      <SiteFooter />
    </PageShell>
  )
}
