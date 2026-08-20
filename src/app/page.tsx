import type { Metadata } from 'next'
import Link from 'next/link'
import { PriceExplorer, type ExplorerRow } from '@/components/price-explorer.tsx'
import { JsonLd } from '@/components/site-chrome.tsx'
import { getBrand } from '@/lib/provider-brands.ts'
import { getLastUpdated, getPriceTrends, getPrices, getProviders } from '@/lib/queries.ts'
import {
  datasetSchema,
  faqSchema,
  organizationSchema,
  providerPath,
  websiteSchema,
} from '@/lib/seo.ts'

export const metadata: Metadata = {
  alternates: { canonical: '/' },
}

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
export const revalidate = 300

/**
 * Answers to the questions this page exists to settle. Rendered as visible
 * copy and mirrored into FAQ structured data, so search and answer engines
 * quote the same wording a reader sees.
 */
const HOME_FAQS = [
  {
    question: 'Which LLM API is cheapest?',
    answer:
      'It depends on the mix of input and output tokens, since output is typically 3-5x the price of input. Sort the table by blended cost to rank on a simple mean of the two, or by input alone if your workload is prompt-heavy. Several Zhipu GLM Flash models are genuinely free.',
  },
  {
    question: 'What does "per 1M tokens" mean?',
    answer:
      'Providers bill per token, and a token is roughly 0.75 of an English word. Quoting per 1,000,000 tokens is the industry convention because per-token prices run to eight decimal places. Every price here is normalized to USD per 1M tokens so models are directly comparable.',
  },
  {
    question: 'What is cached input pricing?',
    answer:
      'Most providers charge a reduced rate when a prompt repeats a prefix they have already processed — often 10% of the normal input price. If you send the same system prompt or document on every call, cached input is usually the single largest saving available.',
  },
  {
    question: 'How current are these prices?',
    answer:
      'They are re-read from each provider every day. A price is only recorded when it actually changes, so the history shows real movements rather than daily noise, and every row shows the date it was last confirmed.',
  },
  {
    question: 'Is there an API for this pricing data?',
    answer:
      'Yes. GET /api/v1/prices returns the whole table as JSON, free and without signup, rate limited to 60 requests per hour per IP. /llms-full.txt serves the same data as markdown for LLM ingestion.',
  },
]

export default async function HomePage() {
  let rows: ExplorerRow[] = []
  let providers: Array<{ slug: string; name: string }> = []
  let updatedAt: string | null = null
  let error: string | null = null

  try {
    /*
     * Read sequentially, not with Promise.all.
     *
     * Concurrent unstable_cache calls sharing a single database connection
     * deadlock: the request simply never resolves, with no error logged. This
     * page issues the most reads, which is why it was the one that hung while
     * lighter pages were fine. The cost of doing them in series is about
     * 100ms, since all but the first are served from cache.
     */
    /*
     * Every type is fetched, and the explorer defaults its own view to chat.
     *
     * The filter has to be client-side because the type control switches
     * between kinds without a round trip — the page hands over the full set
     * once, as it already did for provider and price filters. What changed is
     * the default: non-generative models are no longer in the opening view,
     * because ranking an embedding or moderation endpoint by cost-per-token
     * compares nothing. Before this, a moderation endpoint was the 4th
     * cheapest model on the site.
     */
    const page = await getPrices({ limit: 500, offset: 0, sort: 'input', direction: 'asc' })
    const providerRows = await getProviders()
    const lastUpdated = await getLastUpdated()
    const trends = await getPriceTrends()

    rows = page.rows.map((row) => ({ ...row, trend: trends.get(row.model_id) ?? null }))
    // Only offer providers that actually have models to show.
    providers = providerRows
      .filter((p) => p.model_count > 0)
      .map((p) => ({ slug: p.slug, name: p.name }))
    updatedAt = lastUpdated
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause)
  }

  if (error) {
    return <SetupNotice error={error} />
  }

  if (rows.length === 0) {
    return <SetupNotice error={null} />
  }

  return (
    <>
      <JsonLd
        nodes={[
          websiteSchema(),
          organizationSchema(),
          datasetSchema(rows.length, updatedAt),
          faqSchema(HOME_FAQS),
        ]}
      />
      <PriceExplorer
        rows={rows}
        providers={providers}
        updatedAt={updatedAt}
        providerSlugs={providers.map((p) => p.slug)}
      />
      <div className="mx-auto max-w-[1120px] px-5 pb-14">
        <ProviderLinks providers={providers} />
        <HomeFaq />
        {/*
          The home page was the one page without a footer, so the site's most
          visited page was also the only one missing the collection note, the
          attribution, and the links to /sources, llms.txt and the feed. Same
          container width as PageShell, so it lines up with every other page.
        */}
      </div>
    </>
  )
}

/**
 * Hub links to each provider page.
 *
 * Rendered on the server so they are in the initial HTML: these are the links
 * that let a crawler reach the per-provider and per-model pages at all, and
 * they carry the brand wording people actually search for.
 */
function ProviderLinks({ providers }: { providers: Array<{ slug: string; name: string }> }) {
  return (
    <section className="mb-10">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="m-0 text-xl font-semibold tracking-tight text-neutral-950">
          Pricing by provider
        </h2>
        {/* The table's "Show all" is a client-side toggle with no URL, so this
            is the only link on the page that reaches the whole catalogue —
            for a reader who wants to browse and for a crawler alike. */}
        <Link
          href="/models"
          className="text-[14px] font-medium text-emerald-700 underline underline-offset-2 hover:text-emerald-800"
        >
          Browse every model we track →
        </Link>
      </div>
      <ul className="grid grid-cols-2 gap-2 p-0 sm:grid-cols-3 lg:grid-cols-5">
        {providers.map((provider) => {
          const brand = getBrand(provider.slug)
          return (
            <li key={provider.slug} className="list-none">
              <Link
                href={providerPath(provider.slug)}
                className="block rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm font-medium text-neutral-800 hover:border-emerald-600 hover:text-emerald-700"
              >
                {brand?.brand ?? provider.name} pricing
                {brand && brand.brand !== brand.company && (
                  <span className="block text-xs font-normal text-neutral-500">
                    {brand.company}
                  </span>
                )}
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function HomeFaq() {
  return (
    <section>
      <h2 className="mb-3 text-xl font-semibold tracking-tight text-neutral-950">
        LLM pricing questions
      </h2>
      <dl className="space-y-3">
        {HOME_FAQS.map((faq) => (
          <div
            key={faq.question}
            className="rounded-xl border border-neutral-200 bg-white px-5 py-4"
          >
            <dt className="font-semibold text-neutral-900">{faq.question}</dt>
            <dd className="m-0 mt-1.5 text-[15px] leading-relaxed text-neutral-700">
              {faq.answer}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

function SetupNotice({ error }: { error: string | null }) {
  return (
    <main className="mx-auto max-w-3xl px-5 py-16">
      <h1 className="text-2xl font-bold tracking-tight text-neutral-950">CostOfToken</h1>
      <div className="mt-6 rounded-xl border border-amber-300 bg-amber-50 p-5 text-sm text-amber-900">
        <p className="font-semibold">{error ? 'Could not load prices.' : 'No pricing data yet.'}</p>
        {error && <p className="mt-2 font-mono text-xs text-amber-800">{error}</p>}
        <ol className="mt-3 list-decimal space-y-1 pl-5">
          <li>
            Set <code className="font-semibold">DATABASE_URL</code> in{' '}
            <code className="font-semibold">.env.local</code>
          </li>
          <li>
            Run <code className="font-semibold">npm run db:push</code>
          </li>
          <li>
            Run <code className="font-semibold">npm run pipeline:run</code>
          </li>
        </ol>
      </div>
    </main>
  )
}
