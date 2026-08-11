import type { Metadata } from 'next'
import Link from 'next/link'
import { Breadcrumbs, JsonLd, PageShell, SiteFooter } from '@/components/site-chrome.tsx'
import { WorkloadCalculator } from '@/components/workload-calculator.tsx'
import { getPrices } from '@/lib/queries.ts'
import { absoluteUrl, breadcrumbSchema, faqSchema } from '@/lib/seo.ts'
import type { PriceRowV1 } from '@/lib/types.ts'

/** See src/app/page.tsx — the build must not depend on the database. */
export const dynamic = 'force-dynamic'

const TITLE = 'LLM Cost Calculator — Price Your Actual Workload'
const DESCRIPTION =
  'Enter your tokens per request and monthly volume to see what every LLM API would cost you, ranked cheapest first. Accounts for cached input and context limits.'

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/calculator' },
  openGraph: { title: `${TITLE} — CostOfToken`, description: DESCRIPTION, url: '/calculator' },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
}

const FAQS = [
  {
    question: 'Why does the cheapest model change when I change the workload?',
    answer:
      'Because output tokens usually cost three to five times what input tokens cost. A model with cheap input and expensive output wins for retrieval-style work with short answers and loses badly for anything that generates long text. Ranking on list price alone hides that.',
  },
  {
    question: 'What does the cached input percentage do?',
    answer:
      'Most providers bill a reduced rate — often around a tenth of the normal input price — when a prompt repeats a prefix they have already processed. If you send the same system prompt or document on every call, that share is billed at the cheaper rate. It is usually the single largest saving available.',
  },
  {
    question: 'Why are some rows greyed out?',
    answer:
      'Their context window is smaller than the tokens you entered, so they cannot hold your prompt. They are shown rather than hidden, because a model that cannot do the job is not a cheaper option.',
  },
  {
    question: 'How accurate are these numbers?',
    answer:
      'They use standard-tier list prices updated daily, and assume every request is the same shape. They exclude batch discounts, committed-use agreements and free allowances. Treat the ranking as sound and the absolute totals as an estimate.',
  },
]

export default async function CalculatorPage() {
  let rows: PriceRowV1[] = []
  try {
    const page = await getPrices({ limit: 500, offset: 0, sort: 'input', direction: 'asc' })
    rows = page.rows
  } catch {
    rows = []
  }

  return (
    <PageShell>
      <JsonLd
        nodes={[
          breadcrumbSchema([
            { name: 'LLM pricing', path: '/' },
            { name: 'Cost calculator', path: '/calculator' },
          ]),
          {
            '@type': 'WebApplication',
            '@id': absoluteUrl('/calculator#app'),
            name: 'LLM cost calculator',
            description: DESCRIPTION,
            url: absoluteUrl('/calculator'),
            applicationCategory: 'BusinessApplication',
            operatingSystem: 'Any',
            isAccessibleForFree: true,
            offers: { '@type': 'Offer', price: 0, priceCurrency: 'USD' },
          },
          faqSchema(FAQS),
        ]}
      />

      <Breadcrumbs trail={[{ name: 'LLM pricing', path: '/' }, { name: 'Cost calculator' }]} />

      <header className="mb-6">
        <h1 className="m-0 text-3xl font-bold tracking-tight text-neutral-950">
          LLM cost calculator
        </h1>
        <p className="mt-2 max-w-3xl text-[15px] leading-relaxed text-neutral-700">
          Describe the requests you actually send and every model is priced against them, cheapest
          first. Output typically costs several times more than input, so the cheapest model for a
          summariser is rarely the cheapest for a chat agent — which a per-token price list cannot
          tell you.
        </p>
      </header>

      {rows.length === 0 ? (
        <p className="text-sm text-neutral-600">Pricing data is temporarily unavailable.</p>
      ) : (
        <WorkloadCalculator rows={rows} />
      )}

      <section className="mt-10">
        <h2 className="mb-3 text-xl font-semibold tracking-tight text-neutral-950">
          Questions about these estimates
        </h2>
        <dl className="space-y-3">
          {FAQS.map((faq) => (
            <div key={faq.question} className="rounded-xl border border-neutral-200 bg-white px-5 py-4">
              <dt className="font-semibold text-neutral-900">{faq.question}</dt>
              <dd className="m-0 mt-1.5 text-[15px] leading-relaxed text-neutral-700">{faq.answer}</dd>
            </div>
          ))}
        </dl>
      </section>

      <p className="mt-6 text-[15px]">
        <Link href="/" className="font-medium text-emerald-700 underline underline-offset-2">
          Compare all {rows.length} models by list price →
        </Link>
      </p>

      <SiteFooter />
    </PageShell>
  )
}
