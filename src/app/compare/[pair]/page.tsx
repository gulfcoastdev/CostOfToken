import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Breadcrumbs, JsonLd, PageShell, SiteFooter } from '@/components/site-chrome.tsx'
import { providerColor, SOURCE_LABELS } from '@/components/provider-colors.ts'
import { formatContext, formatPrice } from '@/lib/format.ts'
import { getBrand } from '@/lib/provider-brands.ts'
import { getModelForProvider } from '@/lib/queries.ts'
import { absoluteUrl, breadcrumbSchema, faqSchema, modelPath, priceText, providerPath } from '@/lib/seo.ts'
import type { PriceRowV1 } from '@/lib/types.ts'
import { COMPARISONS, findComparison } from '../../../../data/comparisons.ts'

/** See src/app/page.tsx — the build must not depend on the database. */
export const dynamic = 'force-dynamic'

export function generateStaticParams() {
  return COMPARISONS.map((pair) => ({ pair: pair.slug }))
}

/** Workloads used to show where each model is actually cheaper. */
const SCENARIOS = [
  { label: 'Chat assistant', input: 1_500, output: 600, requests: 100_000 },
  { label: 'RAG / document Q&A', input: 20_000, output: 500, requests: 30_000 },
  { label: 'Coding agent', input: 30_000, output: 4_000, requests: 20_000 },
]

function monthlyCost(row: PriceRowV1, input: number, output: number, requests: number): number | null {
  if (row.input === null && row.output === null) return null
  const perRequest = ((row.input ?? 0) * input + (row.output ?? 0) * output) / 1_000_000
  return perRequest * requests
}

function money(value: number | null): string {
  if (value === null) return '—'
  if (value === 0) return '$0'
  if (value < 1000) return `$${value.toFixed(2)}`
  if (value < 1_000_000) return `$${(value / 1000).toFixed(1)}K`
  return `$${(value / 1_000_000).toFixed(2)}M`
}

async function load(slug: string) {
  const pair = findComparison(slug)
  if (!pair) return null
  // Sequential, not Promise.all. Concurrent reads sharing one database
  // connection deadlock under production concurrency — the same fault that
  // hung the home page. Two reads in series cost a few hundred milliseconds.
  const a = await getModelForProvider(pair.a.provider, pair.a.model)
  const b = await getModelForProvider(pair.b.provider, pair.b.model)
  if (!a || !b) return null
  return { pair, a, b }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ pair: string }>
}): Promise<Metadata> {
  const { pair: slug } = await params
  let data: Awaited<ReturnType<typeof load>> = null
  try {
    data = await load(slug)
  } catch {
    // fall through
  }
  if (!data) return { title: 'Comparison not found' }

  const { a, b } = data
  const title = `${a.display_name} vs ${b.display_name} — Pricing Compared`
  const description = `${a.display_name} costs ${priceText(a.input)} per 1M input and ${priceText(
    a.output,
  )} output. ${b.display_name} costs ${priceText(b.input)} and ${priceText(
    b.output,
  )}. Which is cheaper depends on your workload — see the numbers side by side.`

  return {
    title,
    description,
    alternates: { canonical: `/compare/${data.pair.slug}` },
    openGraph: {
      title: `${title} — CostOfToken`,
      description,
      url: `/compare/${data.pair.slug}`,
    },
    twitter: { card: 'summary_large_image', title, description },
  }
}

export default async function ComparePage({ params }: { params: Promise<{ pair: string }> }) {
  const { pair: slug } = await params
  let data: Awaited<ReturnType<typeof load>> = null
  try {
    data = await load(slug)
  } catch {
    data = null
  }
  if (!data) notFound()

  const { pair, a, b } = data
  const brandA = getBrand(a.provider)?.brand ?? a.provider_name
  const brandB = getBrand(b.provider)?.brand ?? b.provider_name

  const scenarios = SCENARIOS.map((scenario) => {
    const costA = monthlyCost(a, scenario.input, scenario.output, scenario.requests)
    const costB = monthlyCost(b, scenario.input, scenario.output, scenario.requests)
    const winner = costA === null || costB === null ? null : costA < costB ? 'a' : costB < costA ? 'b' : 'tie'
    const ratio =
      costA !== null && costB !== null && Math.min(costA, costB) > 0
        ? Math.max(costA, costB) / Math.min(costA, costB)
        : null
    return { ...scenario, costA, costB, winner, ratio }
  })

  const cheaperInput = a.input !== null && b.input !== null ? (a.input < b.input ? a : b) : null
  const cheaperOutput = a.output !== null && b.output !== null ? (a.output < b.output ? a : b) : null
  const biggerContext =
    a.context_window !== null && b.context_window !== null
      ? a.context_window > b.context_window
        ? a
        : b
      : null

  const faqs = [
    {
      question: `Is ${a.display_name} or ${b.display_name} cheaper?`,
      answer: `It depends on the shape of your requests. ${
        cheaperInput ? `${cheaperInput.display_name} has the lower input price (${priceText(cheaperInput.input)} per 1M). ` : ''
      }${
        cheaperOutput ? `${cheaperOutput.display_name} has the lower output price (${priceText(cheaperOutput.output)} per 1M). ` : ''
      }Because output usually costs several times more than input, the cheaper choice flips depending on how much text you generate.`,
    },
    {
      question: `What is the context window on ${a.display_name} and ${b.display_name}?`,
      answer: `${a.display_name} accepts ${
        a.context_window ? `${a.context_window.toLocaleString('en-US')} tokens` : 'an unpublished number of tokens'
      } and ${b.display_name} accepts ${
        b.context_window ? `${b.context_window.toLocaleString('en-US')} tokens` : 'an unpublished number of tokens'
      }.${biggerContext ? ` ${biggerContext.display_name} holds more.` : ''}`,
    },
    {
      question: 'Do these prices include caching discounts?',
      answer: `The table shows standard rates. ${a.display_name} bills cached input at ${priceText(
        a.cached_input,
      )} per 1M and ${b.display_name} at ${priceText(
        b.cached_input,
      )}. If you resend the same system prompt or document, that discount usually matters more than the headline difference.`,
    },
  ]

  return (
    <PageShell>
      <JsonLd
        nodes={[
          breadcrumbSchema([
            { name: 'LLM pricing', path: '/' },
            { name: `${a.display_name} vs ${b.display_name}`, path: `/compare/${pair.slug}` },
          ]),
          {
            '@type': 'WebPage',
            '@id': absoluteUrl(`/compare/${pair.slug}#page`),
            name: `${a.display_name} vs ${b.display_name} pricing`,
            url: absoluteUrl(`/compare/${pair.slug}`),
            dateModified: a.updated_at ?? undefined,
            isPartOf: { '@id': absoluteUrl('/#website') },
          },
          faqSchema(faqs),
        ]}
      />

      <Breadcrumbs
        trail={[
          { name: 'LLM pricing', path: '/' },
          { name: `${a.display_name} vs ${b.display_name}` },
        ]}
      />

      <header className="mb-6">
        <h1 className="m-0 text-3xl font-bold tracking-tight text-neutral-950">
          {a.display_name} vs {b.display_name}
        </h1>
        <p className="mt-2 max-w-3xl text-[15px] leading-relaxed text-neutral-700">{pair.reason}</p>
        <p className="mt-2 text-[13px] text-neutral-500">
          Prices in USD per 1M tokens, standard tier
          {a.updated_at ? `, updated ${a.updated_at.slice(0, 10)}` : ''}.
        </p>
      </header>

      <section className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {[a, b].map((row) => (
          <div key={row.model_id} className="rounded-xl border border-neutral-200 bg-white p-5">
            <div className="flex items-center gap-2">
              <span
                className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: providerColor(row.provider) }}
              />
              <Link
                href={providerPath(row.provider)}
                className="text-[13px] text-neutral-500 underline underline-offset-2 hover:text-neutral-800"
              >
                {row.provider_name}
              </Link>
            </div>
            <h2 className="m-0 mt-1 text-xl font-semibold tracking-tight text-neutral-950">
              <Link
                href={modelPath(row.provider, row.model_id)}
                className="underline underline-offset-2 hover:text-emerald-700"
              >
                {row.display_name}
              </Link>
            </h2>
            <dl className="mt-3 space-y-1.5 text-[14px]">
              <Row label="Input / 1M" value={formatPrice(row.input)} />
              <Row label="Cached input / 1M" value={formatPrice(row.cached_input)} />
              <Row label="Output / 1M" value={formatPrice(row.output)} />
              <Row label="Context window" value={formatContext(row.context_window)} />
              <Row
                label="Source"
                value={SOURCE_LABELS[row.source_kind] ?? row.source_kind}
              />
            </dl>
          </div>
        ))}
      </section>

      <section className="mb-8">
        <h2 className="mb-1 text-xl font-semibold tracking-tight text-neutral-950">
          Which is cheaper depends on the workload
        </h2>
        <p className="mb-3 text-[14px] leading-relaxed text-neutral-600">
          Estimated monthly cost for three common request shapes. This is the part a price list
          cannot answer.
        </p>
        <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
          <table className="w-full min-w-[680px] border-collapse text-sm">
            <caption className="sr-only">
              Estimated monthly cost for {a.display_name} and {b.display_name}
            </caption>
            <thead>
              <tr className="border-b border-neutral-200 text-left text-xs font-semibold text-neutral-500">
                <th scope="col" className="px-4 py-2.5">Workload</th>
                <th scope="col" className="px-4 py-2.5 text-right">{a.display_name}</th>
                <th scope="col" className="px-4 py-2.5 text-right">{b.display_name}</th>
                <th scope="col" className="px-4 py-2.5">Cheaper</th>
              </tr>
            </thead>
            <tbody>
              {scenarios.map((scenario) => (
                <tr key={scenario.label} className="border-b border-neutral-100 last:border-0">
                  <th scope="row" className="px-4 py-3 text-left font-medium text-neutral-800">
                    {scenario.label}
                    <span className="block text-[12px] font-normal text-neutral-500">
                      {scenario.input.toLocaleString('en-US')} in /{' '}
                      {scenario.output.toLocaleString('en-US')} out ×{' '}
                      {scenario.requests.toLocaleString('en-US')}/mo
                    </span>
                  </th>
                  <td
                    className={`px-4 py-3 text-right tabular-nums ${
                      scenario.winner === 'a' ? 'font-semibold text-emerald-700' : 'text-neutral-700'
                    }`}
                  >
                    {money(scenario.costA)}
                  </td>
                  <td
                    className={`px-4 py-3 text-right tabular-nums ${
                      scenario.winner === 'b' ? 'font-semibold text-emerald-700' : 'text-neutral-700'
                    }`}
                  >
                    {money(scenario.costB)}
                  </td>
                  <td className="px-4 py-3 text-[13px] text-neutral-700">
                    {scenario.winner === 'tie' || scenario.winner === null
                      ? '—'
                      : `${scenario.winner === 'a' ? a.display_name : b.display_name}${
                          scenario.ratio ? ` · ${scenario.ratio.toFixed(1)}× cheaper` : ''
                        }`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[12.5px] text-neutral-500">
          Excludes caching discounts, so real bills with repeated prompts are lower.{' '}
          <Link href="/calculator" className="text-emerald-700 underline underline-offset-2">
            Price your own workload →
          </Link>
        </p>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-xl font-semibold tracking-tight text-neutral-950">
          Common questions
        </h2>
        <dl className="space-y-3">
          {faqs.map((faq) => (
            <div key={faq.question} className="rounded-xl border border-neutral-200 bg-white px-5 py-4">
              <dt className="font-semibold text-neutral-900">{faq.question}</dt>
              <dd className="m-0 mt-1.5 text-[15px] leading-relaxed text-neutral-700">{faq.answer}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="mb-8 flex flex-wrap gap-2">
        <Link
          href={providerPath(a.provider)}
          className="rounded-full border border-neutral-200 bg-white px-3.5 py-1.5 text-[13px] font-medium text-neutral-700 hover:border-emerald-600 hover:text-emerald-700"
        >
          All {brandA} pricing
        </Link>
        <Link
          href={providerPath(b.provider)}
          className="rounded-full border border-neutral-200 bg-white px-3.5 py-1.5 text-[13px] font-medium text-neutral-700 hover:border-emerald-600 hover:text-emerald-700"
        >
          All {brandB} pricing
        </Link>
        {COMPARISONS.filter((other) => other.slug !== pair.slug).map((other) => (
          <Link
            key={other.slug}
            href={`/compare/${other.slug}`}
            className="rounded-full border border-neutral-200 bg-white px-3.5 py-1.5 text-[13px] font-medium text-neutral-700 hover:border-emerald-600 hover:text-emerald-700"
          >
            {other.slug.replace('-vs-', ' vs ')}
          </Link>
        ))}
      </section>

      <SiteFooter />
    </PageShell>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-neutral-100 pb-1.5 last:border-0">
      <dt className="text-neutral-600">{label}</dt>
      <dd className="m-0 font-semibold tabular-nums text-neutral-900">{value}</dd>
    </div>
  )
}
