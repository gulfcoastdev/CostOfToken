import type { Metadata } from 'next'
import Link from 'next/link'
import { Breadcrumbs, JsonLd, PageShell } from '@/components/site-chrome.tsx'
import { formatPrice } from '@/lib/format.ts'
import { getBrand, PROVIDER_BRANDS } from '@/lib/provider-brands.ts'
import { getLastUpdated, getPrices } from '@/lib/queries.ts'
import { absoluteUrl, breadcrumbSchema, providerPath } from '@/lib/seo.ts'
import type { PriceRowV1 } from '@/lib/types.ts'

/**
 * Statically rendered and revalidated, not per request.
 *
 * These were forced dynamic to get deploys unblocked while the build hung on
 * data-backed pages. That hang was the same deadlock that hung the runtime —
 * concurrent reads on one database connection — and the build prerenders pages
 * in parallel, which is what triggered it there. With reads now sequential the
 * build succeeds, so the pages go back to being cached: without this every
 * request paid for a database round trip and cold requests timed out.
 */
export const revalidate = 3600

const TITLE = 'LLM API Providers — Pricing by Company'
const DESCRIPTION =
  'Every LLM API provider we track, with model counts and price ranges. OpenAI, Claude, Gemini, Grok, DeepSeek, Qwen, Kimi, GLM, Doubao and ERNIE, updated daily.'

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/providers' },
  openGraph: { title: `${TITLE} — CostOfToken`, description: DESCRIPTION, url: '/providers' },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
}

interface ProviderSummary {
  slug: string
  count: number
  cheapest: PriceRowV1 | null
  priciest: PriceRowV1 | null
}

export default async function ProvidersIndexPage() {
  let summaries: ProviderSummary[] = []
  let updatedAt: string | null = null

  try {
    // Sequential: concurrent reads sharing one database connection deadlock.
    const page = await getPrices({ limit: 1000, offset: 0, sort: 'input', direction: 'asc' })
    const lastUpdated = await getLastUpdated()
    updatedAt = lastUpdated

    const byProvider = new Map<string, PriceRowV1[]>()
    for (const row of page.rows) {
      const list = byProvider.get(row.provider) ?? []
      list.push(row)
      byProvider.set(row.provider, list)
    }

    summaries = Object.keys(PROVIDER_BRANDS)
      .map((slug) => {
        const rows = byProvider.get(slug) ?? []
        const priced = rows.filter((r) => r.input !== null)
        return {
          slug,
          count: rows.length,
          cheapest: priced.at(0) ?? null,
          priciest: priced.at(-1) ?? null,
        }
      })
      .filter((s) => s.count > 0)
      .sort((a, b) => b.count - a.count)
  } catch {
    summaries = []
  }

  return (
    <PageShell>
      <JsonLd
        nodes={[
          breadcrumbSchema([
            { name: 'LLM pricing', path: '/' },
            { name: 'Providers', path: '/providers' },
          ]),
          {
            '@type': 'CollectionPage',
            '@id': absoluteUrl('/providers#page'),
            name: TITLE,
            description: DESCRIPTION,
            url: absoluteUrl('/providers'),
            dateModified: updatedAt ?? undefined,
            mainEntity: {
              '@type': 'ItemList',
              numberOfItems: summaries.length,
              itemListElement: summaries.map((s, index) => ({
                '@type': 'ListItem',
                position: index + 1,
                name: `${getBrand(s.slug)?.brand ?? s.slug} pricing`,
                url: absoluteUrl(providerPath(s.slug)),
              })),
            },
          },
        ]}
      />

      <Breadcrumbs trail={[{ name: 'LLM pricing', path: '/' }, { name: 'Providers' }]} />

      <header className="mb-6">
        <h1 className="m-0 text-3xl font-bold tracking-tight text-neutral-950">
          LLM API providers
        </h1>
        <p className="mt-2 max-w-3xl text-[15px] leading-relaxed text-neutral-700">
          Every provider we track, with how many models each publishes and what they cost. Prices
          are USD per 1M tokens on the standard tier, re-read daily.
        </p>
      </header>

      {summaries.length === 0 ? (
        <p className="text-sm text-neutral-600">Pricing data is temporarily unavailable.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 p-0 sm:grid-cols-2">
          {summaries.map((summary) => {
            const brand = getBrand(summary.slug)
            if (!brand) return null
            return (
              <li key={summary.slug} className="list-none">
                <Link
                  href={providerPath(summary.slug)}
                  className="block h-full rounded-xl border border-neutral-200 bg-white p-5 transition-colors hover:border-emerald-600"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h2 className="m-0 text-lg font-semibold text-neutral-950">
                      {brand.brand} pricing
                    </h2>
                    <span className="text-[13px] text-neutral-500">{summary.count} models</span>
                  </div>
                  {brand.brand !== brand.company && (
                    <p className="m-0 mt-0.5 text-[13px] text-neutral-500">by {brand.company}</p>
                  )}
                  <p className="m-0 mt-2 text-[14px] leading-relaxed text-neutral-700">
                    {brand.summary}
                  </p>
                  {summary.cheapest && summary.priciest && (
                    <p className="m-0 mt-3 text-[13px] text-neutral-600">
                      Input from{' '}
                      <strong className="font-semibold tabular-nums text-emerald-700">
                        {formatPrice(summary.cheapest.input)}
                      </strong>{' '}
                      to{' '}
                      <strong className="font-semibold tabular-nums text-neutral-900">
                        {formatPrice(summary.priciest.input)}
                      </strong>{' '}
                      per 1M tokens
                    </p>
                  )}
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </PageShell>
  )
}
