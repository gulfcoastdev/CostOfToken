import type { Metadata } from 'next'
import Link from 'next/link'
import { Breadcrumbs, JsonLd, PageShell, SiteFooter } from '@/components/site-chrome.tsx'
import { ALL_EXTRACTORS } from '@/pipeline/extractors/index.ts'
import { PROVIDER_BY_SLUG } from '@/pipeline/providers.ts'
import { getBrand } from '@/lib/provider-brands.ts'
import { getLastUpdated, getProviders } from '@/lib/queries.ts'
import { absoluteUrl, breadcrumbSchema, providerPath } from '@/lib/seo.ts'

/**
 * Rendered per request, not prerendered.
 *
 * Production builds were failing because this page reads pricing, and the
 * build environment cannot reach the database — every data-backed page hung
 * for 60 seconds and the export aborted, while the same queries answer in
 * under a second at runtime. Until that is understood (see scripts/db-probe.ts,
 * which reports connectivity in the build log), the build must not depend on
 * the database at all: a deploy that cannot ship is worse than a page that
 * renders on demand.
 */
export const dynamic = 'force-dynamic'

const TITLE = 'Where This Pricing Data Comes From'
const DESCRIPTION =
  'Every source behind CostOfToken: which page each provider’s pricing is read from, how it is parsed, how often, and what is deliberately excluded.'

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/sources' },
  openGraph: { title: `${TITLE} — CostOfToken`, description: DESCRIPTION, url: '/sources' },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
}

/** How each extractor reads its source, in plain language. */
const METHOD: Record<string, string> = {
  openai: 'Markdown rendering of the docs page (`.md` suffix)',
  anthropic: 'Markdown rendering of the docs page (`.md` suffix)',
  zhipu: 'Markdown rendering of the international docs (`.md` suffix)',
  google: 'HTML pricing tables, one per model',
  xai: 'Structured JSON embedded in the docs page',
  deepseek: 'OpenRouter catalogue',
  alibaba: 'OpenRouter catalogue',
  moonshot: 'OpenRouter catalogue',
  bytedance: 'OpenRouter catalogue',
  baidu: 'OpenRouter catalogue',
}

export default async function SourcesPage() {
  let counts = new Map<string, number>()
  let updatedAt: string | null = null
  try {
    // Sequential: concurrent reads sharing one database connection deadlock.
    const providers = await getProviders()
    const lastUpdated = await getLastUpdated()
    counts = new Map(providers.map((p) => [p.slug, p.model_count]))
    updatedAt = lastUpdated
  } catch {
    // The provenance table is accurate without live counts.
  }

  const rows = ALL_EXTRACTORS.map((extractor) => {
    const brand = getBrand(extractor.providerSlug)
    const provider = PROVIDER_BY_SLUG.get(extractor.providerSlug)
    return {
      slug: extractor.providerSlug,
      brand: brand?.brand ?? extractor.providerSlug,
      company: brand?.company ?? '',
      firstParty: extractor.sourceKind === 'scrape',
      method: METHOD[extractor.providerSlug] ?? 'Automated extraction',
      // The document actually fetched, which is not always the vendor's
      // marketing page — DeepSeek's documented pricing URL now redirects
      // elsewhere, which is precisely why that provider falls back.
      fetchedUrl: extractor.sourceUrl,
      vendorUrl: provider?.pricingUrl ?? null,
      count: counts.get(extractor.providerSlug) ?? 0,
    }
  })

  const firstPartyCount = rows.filter((r) => r.firstParty).length

  return (
    <PageShell>
      <JsonLd
        nodes={[
          breadcrumbSchema([
            { name: 'LLM pricing', path: '/' },
            { name: 'Data sources', path: '/sources' },
          ]),
          {
            '@type': 'WebPage',
            '@id': absoluteUrl('/sources#page'),
            name: TITLE,
            description: DESCRIPTION,
            url: absoluteUrl('/sources'),
            dateModified: updatedAt ?? undefined,
            isPartOf: { '@id': absoluteUrl('/#website') },
          },
        ]}
      />

      <Breadcrumbs trail={[{ name: 'LLM pricing', path: '/' }, { name: 'Data sources' }]} />

      <header className="mb-6">
        <h1 className="m-0 text-3xl font-bold tracking-tight text-neutral-950">Data sources</h1>
        <p className="mt-2 max-w-3xl text-[15px] leading-relaxed text-neutral-700">
          Prices are read automatically from the pages below once a day, normalized to USD per 1M
          tokens, and only recorded when a number actually changes. {firstPartyCount} of{' '}
          {rows.length} providers are read from their own published pricing; the rest have no
          machine-readable page and come from a reseller catalogue, which is marked on every row it
          produces.
        </p>
      </header>

      <section className="mb-8">
        <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <caption className="sr-only">Pricing source and extraction method per provider</caption>
            <thead>
              <tr className="border-b border-neutral-200 text-left text-xs font-semibold text-neutral-500">
                <th scope="col" className="px-4 py-2.5">Provider</th>
                <th scope="col" className="px-4 py-2.5">Source</th>
                <th scope="col" className="px-4 py-2.5">How it is read</th>
                <th scope="col" className="px-4 py-2.5 text-right">Models</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.slug} className="border-b border-neutral-100 last:border-0">
                  <th scope="row" className="px-4 py-3 text-left font-medium">
                    <Link
                      href={providerPath(row.slug)}
                      className="font-semibold text-neutral-900 underline underline-offset-2 hover:text-emerald-700"
                    >
                      {row.brand}
                    </Link>
                    {row.company && row.company !== row.brand && (
                      <span className="block text-[12px] font-normal text-neutral-500">
                        {row.company}
                      </span>
                    )}
                  </th>
                  <td className="px-4 py-3">
                    {row.firstParty ? (
                      <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                        First-party
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                        Via OpenRouter
                      </span>
                    )}
                    <a
                      href={row.fetchedUrl}
                      target="_blank"
                      rel="noopener nofollow"
                      className="mt-1 block max-w-[300px] truncate text-[12px] text-neutral-500 underline underline-offset-2 hover:text-neutral-800"
                      title={row.fetchedUrl}
                    >
                      {row.fetchedUrl.replace(/^https?:\/\//, '')}
                    </a>
                    {!row.firstParty && row.vendorUrl && (
                      <span className="mt-0.5 block max-w-[300px] truncate text-[11px] text-neutral-400">
                        vendor page not machine-readable
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-[13.5px] text-neutral-700">{row.method}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-neutral-700">
                    {row.count || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-xl font-semibold tracking-tight text-neutral-950">
          What is deliberately excluded
        </h2>
        <ul className="space-y-2 pl-5 text-[15px] leading-relaxed text-neutral-700">
          <li>
            <strong>Batch, Flex and Priority tiers.</strong> Batch is typically half price and
            asynchronous. Comparing one vendor&apos;s batch rate against another&apos;s standard rate
            would make the whole table wrong, so only standard pricing is shown.
          </li>
          <li>
            <strong>Non-token pricing.</strong> Per-image, per-minute and per-character rates use
            different units and are not comparable to a cost per million tokens.
          </li>
          <li>
            <strong>Free tiers and trial credits.</strong> A price of <code>Free</code> means the
            model itself is billed at zero, not that a free allowance exists.
          </li>
          <li>
            <strong>Negotiated and committed-use discounts.</strong> Only public list pricing is
            tracked.
          </li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-xl font-semibold tracking-tight text-neutral-950">
          How accuracy is protected
        </h2>
        <ul className="space-y-2 pl-5 text-[15px] leading-relaxed text-neutral-700">
          <li>
            A value must look like money to be stored, so a token count sitting in a price column is
            rejected rather than published as a price.
          </li>
          <li>
            A provider whose model count collapses, or whose prices all shift by the same exact
            factor, is blocked automatically — that pattern means a parser latched onto the wrong
            table, not that a vendor repriced. The previous prices stand until a human looks.
          </li>
          <li>
            A failed extraction writes nothing. Yesterday&apos;s verified price is better than a
            blank or a guess.
          </li>
          <li>
            Every row records the page it came from and when it was last confirmed, both of which
            are shown on the model page and returned by the API.
          </li>
        </ul>
      </section>

      <section className="mb-8 rounded-xl border border-amber-300 bg-amber-50 px-5 py-4">
        <h2 className="m-0 text-base font-semibold text-amber-950">Verify before you commit spend</h2>
        <p className="m-0 mt-1.5 text-[15px] leading-relaxed text-amber-900">
          This is an automated reading of pages that change without notice, and rows marked{' '}
          <em>Via OpenRouter</em> come from a reseller whose rate can differ from the vendor&apos;s
          own. For anything financially material, confirm against the provider&apos;s page — every
          model page links to the exact source used.
        </p>
      </section>

      <p className="mb-6 text-[15px]">
        <Link href="/api-docs" className="font-medium text-emerald-700 underline underline-offset-2">
          Use this data via the API →
        </Link>
      </p>

      <SiteFooter />
    </PageShell>
  )
}
