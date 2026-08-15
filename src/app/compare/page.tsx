import type { Metadata } from 'next'
import Link from 'next/link'
import { CompareBuilder } from '@/components/compare-builder.tsx'
import { Breadcrumbs, JsonLd, PageShell } from '@/components/site-chrome.tsx'
import { MAX_COMPARED } from '@/lib/compare.ts'
import { getPrices } from '@/lib/queries.ts'
import { absoluteUrl, breadcrumbSchema, faqSchema } from '@/lib/seo.ts'
import type { PriceRowV1 } from '@/lib/types.ts'
import { COMPARISONS } from '../../../data/comparisons.ts'

/**
 * Statically rendered and revalidated, like every other data-backed page here.
 *
 * The selection lives in the query string and is read on the client, so this
 * page never has to be dynamic — a shared `?models=` link hits the same cached
 * HTML and fills itself in after hydration.
 */
export const revalidate = 3600

const TITLE = `Compare LLM Pricing — Up to ${MAX_COMPARED} Models Side by Side`
const DESCRIPTION = `Pick any ${MAX_COMPARED} language models and compare input, cached and output pricing, context windows and estimated monthly cost for real workloads. Free, no signup, updated daily.`

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/compare' },
  openGraph: { title: `${TITLE} — CostOfToken`, description: DESCRIPTION, url: '/compare' },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
}

const FAQS = [
  {
    question: 'How many models can I compare at once?',
    answer: `Up to ${MAX_COMPARED}. The comparison puts one model per column, and beyond three the table stops fitting on a laptop screen without scrolling — at which point the main pricing table is the better tool.`,
  },
  {
    question: 'Why does the cheaper model change between workloads?',
    answer:
      'Output tokens usually cost three to five times input tokens, so a model that looks expensive on input can be the cheapest choice for a summariser and the most expensive for a chat agent. The workload table prices three common request shapes to show where each model wins.',
  },
  {
    question: 'Can I share a comparison?',
    answer:
      'Yes. The models you pick are stored in the page URL, so copying the link sends the same comparison to anyone else.',
  },
]

export default async function ComparePage() {
  let rows: PriceRowV1[] = []
  let error: string | null = null

  try {
    // One read, sorted by price. Sequential by habit across this codebase:
    // concurrent reads sharing a single database connection deadlock.
    /*
     * Text generators only, so the comparison builder offers models that can
     * actually be compared against each other.
     */
    const page = await getPrices({
      limit: 500,
      offset: 0,
      sort: 'input',
      direction: 'asc',
      modelType: 'chat',
    })
    rows = page.rows
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause)
  }

  const suggestions = COMPARISONS.map((pair) => ({
    slug: pair.slug,
    label: pair.slug.replace('-vs-', ' vs '),
  }))

  return (
    <PageShell>
      <JsonLd
        nodes={[
          breadcrumbSchema([
            { name: 'LLM pricing', path: '/' },
            { name: 'Compare models', path: '/compare' },
          ]),
          {
            '@type': 'WebPage',
            '@id': absoluteUrl('/compare#page'),
            name: 'Compare LLM pricing side by side',
            url: absoluteUrl('/compare'),
            isPartOf: { '@id': absoluteUrl('/#website') },
          },
          faqSchema(FAQS),
        ]}
      />

      <Breadcrumbs trail={[{ name: 'LLM pricing', path: '/' }, { name: 'Compare models' }]} />

      <header className="mb-6">
        <h1 className="m-0 text-3xl font-bold tracking-tight text-neutral-950">
          Compare models side by side
        </h1>
        <p className="mt-2 max-w-3xl text-[15px] leading-relaxed text-neutral-700">
          Pick up to {MAX_COMPARED} models and see their prices, context windows and estimated
          monthly cost in one view. Prices are USD per 1M tokens on the standard tier, updated
          daily.
        </p>
      </header>

      {error || rows.length === 0 ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-5 py-4 text-sm text-amber-900">
          <p className="m-0 font-semibold">Could not load models to compare.</p>
          {error && <p className="mt-2 font-mono text-xs text-amber-800">{error}</p>}
        </div>
      ) : (
        <CompareBuilder rows={rows} suggestions={suggestions} />
      )}

      <section className="mb-8">
        <h2 className="mb-3 text-xl font-semibold tracking-tight text-neutral-950">
          Common questions
        </h2>
        <dl className="space-y-3">
          {FAQS.map((faq) => (
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

      <p className="mb-6 text-[15px]">
        <Link
          href="/calculator"
          className="font-medium text-emerald-700 underline underline-offset-2"
        >
          Price a specific workload across every model →
        </Link>
      </p>
    </PageShell>
  )
}
