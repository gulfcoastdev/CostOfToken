import type { Metadata } from 'next'
import Link from 'next/link'
import { MODEL_TYPE_LABELS } from '@/components/provider-colors.ts'
import { Breadcrumbs, JsonLd, PageShell } from '@/components/site-chrome.tsx'
import { formatContext, formatPrice } from '@/lib/format.ts'
import { getBrand } from '@/lib/provider-brands.ts'
import { getLastUpdated, getPrices } from '@/lib/queries.ts'
import { absoluteUrl, breadcrumbSchema, modelPath, providerPath } from '@/lib/seo.ts'
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

const TITLE = 'All LLM Models — Every Model We Track, With Prices'
const DESCRIPTION =
  'The complete list of LLM models we price, grouped by provider, with input, cached and output cost per 1M tokens and context window. GPT, Claude, Gemini, Grok, DeepSeek, Qwen, Kimi, GLM, Doubao and ERNIE, updated daily.'

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/models' },
  openGraph: { title: `${TITLE} — CostOfToken`, description: DESCRIPTION, url: '/models' },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
}

/**
 * The complete model index.
 *
 * The home page renders ten popular models and filters the rest in the
 * browser, so the full catalogue existed only as client state — no URL, and
 * nothing in the HTML a crawler or a reader could follow. The provider hubs
 * covered every model between them, but only two hops from the page that
 * carries the site's authority.
 *
 * This is the missing hub: one server-rendered page, one hop from home,
 * linking every model. It is grouped by provider and carries prices rather
 * than being a bare list of links, because a page whose only content is 191
 * anchors deserves to be treated as thin — and because the reader who wanted
 * "show me everything" wants to compare while scanning.
 */
export default async function ModelsIndexPage() {
  let rows: PriceRowV1[] = []
  let updatedAt: string | null = null

  try {
    // Sequential: concurrent reads sharing one database connection deadlock.
    const page = await getPrices({ limit: 1000, offset: 0, sort: 'provider', direction: 'asc' })
    const lastUpdated = await getLastUpdated()
    rows = page.rows
    updatedAt = lastUpdated
  } catch {
    rows = []
  }

  const groups = groupByProvider(rows)

  return (
    <PageShell>
      <JsonLd
        nodes={[
          breadcrumbSchema([
            { name: 'LLM pricing', path: '/' },
            { name: 'All models', path: '/models' },
          ]),
          {
            '@type': 'CollectionPage',
            '@id': absoluteUrl('/models#page'),
            name: TITLE,
            description: DESCRIPTION,
            url: absoluteUrl('/models'),
            dateModified: updatedAt ?? undefined,
            /*
             * Every model, not a sample. The list is the page's whole reason
             * for existing, so a truncated ItemList would describe a different
             * page from the one being served.
             */
            mainEntity: {
              '@type': 'ItemList',
              numberOfItems: rows.length,
              itemListElement: rows.map((row, index) => ({
                '@type': 'ListItem',
                position: index + 1,
                name: `${row.display_name} pricing`,
                url: absoluteUrl(modelPath(row.provider, row.model_id)),
              })),
            },
          },
        ]}
      />

      <Breadcrumbs trail={[{ name: 'LLM pricing', path: '/' }, { name: 'All models' }]} />

      <header className="mb-6">
        <h1 className="m-0 text-3xl font-bold tracking-tight text-neutral-950">
          All LLM models we track
        </h1>
        <p className="mt-2 max-w-3xl text-[15px] leading-relaxed text-neutral-700">
          Every model in the dataset, grouped by provider. Prices are USD per 1M tokens on the
          standard tier, normalized across providers so they compare directly, and re-read daily.
          Follow any model for its full pricing, cost at real workloads and price history.
        </p>
        {rows.length > 0 && (
          <p className="mt-2 text-[13px] text-neutral-500">
            {rows.length} models across {groups.length} providers
            {updatedAt ? ` · updated ${updatedAt.slice(0, 10)}` : ''} ·{' '}
            <Link href="/" className="underline underline-offset-2 hover:text-neutral-800">
              sort and filter on the home page
            </Link>
          </p>
        )}
      </header>

      {groups.length === 0 ? (
        <p className="text-sm text-neutral-600">Pricing data is temporarily unavailable.</p>
      ) : (
        <>
          {/* An in-page index, so a 191-row page is navigable without a scroll
              hunt — and so each provider section is linkable on its own. */}
          <nav aria-label="Providers on this page" className="mb-8">
            <ul className="flex flex-wrap gap-2 p-0">
              {groups.map((group) => (
                <li key={group.slug} className="list-none">
                  <a
                    href={`#${group.slug}`}
                    className="inline-block rounded-full border border-neutral-200 bg-white px-3.5 py-1.5 text-[13px] font-medium text-neutral-700 hover:border-emerald-600 hover:text-emerald-700"
                  >
                    {group.brandName}{' '}
                    <span className="tabular-nums text-neutral-500">{group.rows.length}</span>
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          {groups.map((group) => (
            <ProviderSection key={group.slug} group={group} />
          ))}
        </>
      )}
    </PageShell>
  )
}

interface ProviderGroup {
  slug: string
  brandName: string
  company: string | null
  rows: PriceRowV1[]
}

/**
 * Providers ordered by how many models they publish, models within a provider
 * by input price.
 *
 * Cheapest first rather than alphabetical: the reader scanning a provider's
 * models is nearly always asking what the floor is. Unpriced models sort last,
 * since a missing price is not a cheap one.
 */
function groupByProvider(rows: PriceRowV1[]): ProviderGroup[] {
  const byProvider = new Map<string, PriceRowV1[]>()
  for (const row of rows) {
    const list = byProvider.get(row.provider) ?? []
    list.push(row)
    byProvider.set(row.provider, list)
  }

  return [...byProvider.entries()]
    .map(([slug, list]) => {
      const brand = getBrand(slug)
      return {
        slug,
        brandName: brand?.brand ?? list[0].provider_name,
        company: brand && brand.brand !== brand.company ? brand.company : null,
        rows: [...list].sort(
          (a, b) =>
            (a.input ?? Number.POSITIVE_INFINITY) - (b.input ?? Number.POSITIVE_INFINITY) ||
            a.display_name.localeCompare(b.display_name),
        ),
      }
    })
    .sort((a, b) => b.rows.length - a.rows.length)
}

function ProviderSection({ group }: { group: ProviderGroup }) {
  return (
    <section id={group.slug} className="mb-10 scroll-mt-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="m-0 text-xl font-semibold tracking-tight text-neutral-950">
          {group.brandName} models
          {group.company && (
            <span className="ml-2 text-[13px] font-normal text-neutral-500">
              by {group.company}
            </span>
          )}
        </h2>
        <Link
          href={providerPath(group.slug)}
          className="text-[13px] font-medium text-emerald-700 underline underline-offset-2"
        >
          All {group.brandName} pricing →
        </Link>
      </div>

      <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <caption className="sr-only">
            {group.brandName} models with input, cached input and output price per 1M tokens
          </caption>
          <thead>
            <tr className="border-b border-neutral-200 text-left text-xs font-semibold text-neutral-500">
              <th scope="col" className="px-3 py-2.5">
                Model
              </th>
              <th scope="col" className="px-3 py-2.5 text-right">
                Input /1M
              </th>
              <th scope="col" className="px-3 py-2.5 text-right">
                Cached /1M
              </th>
              <th scope="col" className="px-3 py-2.5 text-right">
                Output /1M
              </th>
              <th scope="col" className="px-3 py-2.5 text-right">
                Context
              </th>
              <th scope="col" className="px-3 py-2.5">
                Type
              </th>
            </tr>
          </thead>
          <tbody>
            {group.rows.map((row) => (
              <tr key={row.model_id} className="border-b border-neutral-100 last:border-0">
                <th scope="row" className="px-3 py-2.5 text-left font-medium">
                  {/* The whole point of the page: a real link per model, with
                      the model's own name as the anchor text. */}
                  <Link
                    href={modelPath(row.provider, row.model_id)}
                    className="font-semibold text-neutral-900 underline underline-offset-2 hover:text-emerald-700"
                  >
                    {row.display_name}
                  </Link>
                </th>
                <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-neutral-900">
                  {formatPrice(row.input)}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-neutral-700">
                  {formatPrice(row.cached_input)}
                </td>
                <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-neutral-900">
                  {formatPrice(row.output)}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-neutral-700">
                  {formatContext(row.context_window)}
                </td>
                <td className="px-3 py-2.5 text-[12.5px] text-neutral-500">
                  {row.model_type ? (MODEL_TYPE_LABELS[row.model_type] ?? row.model_type) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
