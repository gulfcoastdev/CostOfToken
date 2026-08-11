import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Breadcrumbs, JsonLd, PageShell, PriceStat, SiteFooter } from '@/components/site-chrome.tsx'
import { formatContext, formatPrice } from '@/lib/format.ts'
import { getBrand } from '@/lib/provider-brands.ts'
import { getAllModelRefs, getHistory, getModelForProvider, getProviderModels } from '@/lib/queries.ts'
import {
  absoluteUrl,
  breadcrumbSchema,
  faqSchema,
  modelDescription,
  modelPath,
  modelSchema,
  priceText,
  providerPath,
} from '@/lib/seo.ts'
import type { HistoryPointV1, PriceRowV1 } from '@/lib/types.ts'

export const revalidate = 3600
/** Unknown model ids render on demand rather than 404ing before the next build. */
export const dynamicParams = true

export async function generateStaticParams() {
  try {
    const refs = await getAllModelRefs()
    return refs.map((ref) => ({ provider: ref.provider, model: ref.modelId }))
  } catch {
    return []
  }
}

async function load(providerSlug: string, modelId: string) {
  const row = await getModelForProvider(providerSlug, decodeURIComponent(modelId))
  return row
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ provider: string; model: string }>
}): Promise<Metadata> {
  const { provider, model } = await params

  let row: PriceRowV1 | null = null
  try {
    row = await load(provider, model)
  } catch {
    // fall through to the not-found title
  }
  if (!row) return { title: 'Model not found' }

  const brand = getBrand(row.provider)
  const title = `${row.display_name} Pricing — ${priceText(row.input)}/1M Input Tokens`
  const description = `${modelDescription(row)} Compare against every other ${
    brand?.brand ?? row.provider_name
  } model and the rest of the market. Updated daily.`

  return {
    title,
    description,
    alternates: { canonical: modelPath(row.provider, row.model_id) },
    openGraph: {
      title: `${title} — CostOfToken`,
      description,
      url: modelPath(row.provider, row.model_id),
      type: 'website',
    },
    twitter: { card: 'summary_large_image', title, description },
  }
}

export default async function ModelPage({
  params,
}: {
  params: Promise<{ provider: string; model: string }>
}) {
  const { provider, model } = await params

  let row: PriceRowV1 | null = null
  try {
    row = await load(provider, model)
  } catch {
    row = null
  }
  if (!row) notFound()

  const brand = getBrand(row.provider)
  const brandName = brand?.brand ?? row.provider_name

  const [siblings, history] = await Promise.all([
    getProviderModels(row.provider).catch((): PriceRowV1[] => []),
    getHistory(row.model_id, 12).catch((): HistoryPointV1[] => []),
  ])

  const cheaper = siblings.filter(
    (s) => s.model_id !== row.model_id && s.input !== null && row.input !== null && s.input < row.input,
  )
  const faqs = buildFaqs(row, brandName, cheaper.at(-1) ?? null)

  return (
    <PageShell>
      <JsonLd
        nodes={[
          breadcrumbSchema([
            { name: 'LLM pricing', path: '/' },
            { name: `${brandName} pricing`, path: providerPath(row.provider) },
            { name: row.display_name, path: modelPath(row.provider, row.model_id) },
          ]),
          modelSchema(row),
          {
            '@type': 'WebPage',
            '@id': absoluteUrl(`${modelPath(row.provider, row.model_id)}#page`),
            name: `${row.display_name} pricing`,
            url: absoluteUrl(modelPath(row.provider, row.model_id)),
            dateModified: row.updated_at ?? undefined,
            primaryImageOfPage: undefined,
          },
          faqSchema(faqs),
        ]}
      />

      <Breadcrumbs
        trail={[
          { name: 'LLM pricing', path: '/' },
          { name: `${brandName} pricing`, path: providerPath(row.provider) },
          { name: row.display_name },
        ]}
      />

      <header className="mb-6">
        <h1 className="m-0 text-3xl font-bold tracking-tight text-neutral-950">
          {row.display_name} pricing
        </h1>
        <p className="mt-2 max-w-3xl text-[15px] leading-relaxed text-neutral-700">
          {modelDescription(row)}
        </p>
        <p className="mt-2 text-[13px] text-neutral-500">
          API id <code className="rounded bg-neutral-200 px-1.5 py-0.5 font-mono text-xs">{row.model_id}</code>{' '}
          · {row.provider_name} ·{' '}
          {row.source_url ? (
            <a
              href={row.source_url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="underline underline-offset-2 hover:text-neutral-800"
            >
              source
            </a>
          ) : (
            'source unavailable'
          )}
          {row.updated_at ? ` · updated ${row.updated_at.slice(0, 10)}` : ''}
        </p>
      </header>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <PriceStat label="Input / 1M tokens" value={formatPrice(row.input)} accent />
        <PriceStat label="Output / 1M tokens" value={formatPrice(row.output)} />
        <PriceStat label="Cached input / 1M" value={formatPrice(row.cached_input)} />
        <PriceStat label="Context window" value={formatContext(row.context_window)} />
      </div>

      {row.long_context_threshold !== null && row.long_input !== null && (
        <section className="mb-6 rounded-xl border border-amber-300 bg-amber-50 px-5 py-4 text-[15px] text-amber-900">
          <h2 className="m-0 text-base font-semibold">Long-context pricing</h2>
          <p className="m-0 mt-1.5">
            Prompts over {formatContext(row.long_context_threshold)} tokens are billed at{' '}
            <strong>{formatPrice(row.long_input)}</strong> per 1M input and{' '}
            <strong>{formatPrice(row.long_output)}</strong> per 1M output — roughly{' '}
            {row.input ? `${(row.long_input / row.input).toFixed(1)}×` : 'more than'} the standard
            input rate. Budget for this if you send large documents.
          </p>
        </section>
      )}

      <section className="mb-8">
        <h2 className="mb-3 text-xl font-semibold tracking-tight text-neutral-950">
          What {row.display_name} costs in practice
        </h2>
        <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
          <table className="w-full min-w-[520px] border-collapse text-sm">
            <caption className="sr-only">Estimated cost at common usage volumes</caption>
            <thead>
              <tr className="border-b border-neutral-200 text-left text-xs font-semibold text-neutral-500">
                <th scope="col" className="px-3 py-2.5">Workload</th>
                <th scope="col" className="px-3 py-2.5 text-right">Input tokens</th>
                <th scope="col" className="px-3 py-2.5 text-right">Output tokens</th>
                <th scope="col" className="px-3 py-2.5 text-right">Estimated cost</th>
              </tr>
            </thead>
            <tbody>
              {USAGE_SCENARIOS.map((scenario) => (
                <tr key={scenario.label} className="border-b border-neutral-100 last:border-0">
                  <th scope="row" className="px-3 py-2.5 text-left font-medium text-neutral-800">
                    {scenario.label}
                  </th>
                  <td className="px-3 py-2.5 text-right tabular-nums text-neutral-700">
                    {scenario.input.toLocaleString('en-US')}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-neutral-700">
                    {scenario.output.toLocaleString('en-US')}
                  </td>
                  <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-neutral-900">
                    {estimateCost(row, scenario.input, scenario.output)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[12.5px] text-neutral-500">
          Estimates use the standard tier and ignore caching discounts, so real bills with repeated
          prompt prefixes are typically lower.
        </p>
      </section>

      {history.length > 1 && (
        <section className="mb-8">
          <h2 className="mb-3 text-xl font-semibold tracking-tight text-neutral-950">
            {row.display_name} price history
          </h2>
          <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
            <table className="w-full min-w-[420px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-left text-xs font-semibold text-neutral-500">
                  <th scope="col" className="px-3 py-2.5">Recorded</th>
                  <th scope="col" className="px-3 py-2.5 text-right">Input /1M</th>
                  <th scope="col" className="px-3 py-2.5 text-right">Output /1M</th>
                </tr>
              </thead>
              <tbody>
                {history.map((point) => (
                  <tr key={point.recorded_at} className="border-b border-neutral-100 last:border-0">
                    <td className="px-3 py-2.5 text-neutral-700">
                      {point.recorded_at.slice(0, 10)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{formatPrice(point.input)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{formatPrice(point.output)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="mb-8">
        <h2 className="mb-3 text-xl font-semibold tracking-tight text-neutral-950">
          Common questions
        </h2>
        <dl className="space-y-4">
          {faqs.map((faq) => (
            <div key={faq.question} className="rounded-xl border border-neutral-200 bg-white px-5 py-4">
              <dt className="font-semibold text-neutral-900">{faq.question}</dt>
              <dd className="m-0 mt-1.5 text-[15px] leading-relaxed text-neutral-700">{faq.answer}</dd>
            </div>
          ))}
        </dl>
      </section>

      {siblings.length > 1 && (
        <section className="mb-8">
          <h2 className="mb-3 text-xl font-semibold tracking-tight text-neutral-950">
            Other {brandName} models
          </h2>
          <ul className="flex flex-wrap gap-2 p-0">
            {siblings
              .filter((s) => s.model_id !== row.model_id)
              .slice(0, 16)
              .map((sibling) => (
                <li key={sibling.model_id} className="list-none">
                  <Link
                    href={modelPath(sibling.provider, sibling.model_id)}
                    className="inline-block rounded-full border border-neutral-200 bg-white px-3.5 py-1.5 text-[13px] text-neutral-700 hover:border-emerald-600 hover:text-emerald-700"
                  >
                    {sibling.display_name}{' '}
                    <span className="tabular-nums text-neutral-500">{formatPrice(sibling.input)}</span>
                  </Link>
                </li>
              ))}
          </ul>
          <p className="mt-3 text-[14px]">
            <Link
              href={providerPath(row.provider)}
              className="font-medium text-emerald-700 underline underline-offset-2"
            >
              See all {brandName} pricing →
            </Link>
          </p>
        </section>
      )}

      <SiteFooter />
    </PageShell>
  )
}

const USAGE_SCENARIOS = [
  { label: 'Short chat turn', input: 1_000, output: 500 },
  { label: 'Document summary', input: 50_000, output: 2_000 },
  { label: '1M tokens in, 200K out', input: 1_000_000, output: 200_000 },
]

function estimateCost(row: PriceRowV1, inputTokens: number, outputTokens: number): string {
  if (row.input === null && row.output === null) return '—'
  const cost =
    ((row.input ?? 0) * inputTokens) / 1_000_000 + ((row.output ?? 0) * outputTokens) / 1_000_000
  if (cost === 0) return 'Free'
  if (cost < 0.01) return `$${cost.toFixed(4)}`
  return `$${cost.toFixed(2)}`
}

function buildFaqs(
  row: PriceRowV1,
  brandName: string,
  cheaperSibling: PriceRowV1 | null,
): Array<{ question: string; answer: string }> {
  const faqs: Array<{ question: string; answer: string }> = [
    {
      question: `How much does ${row.display_name} cost per 1M tokens?`,
      answer: `${row.display_name} costs ${priceText(row.input)} per 1M input tokens and ${priceText(
        row.output,
      )} per 1M output tokens on the standard tier.${
        row.cached_input !== null
          ? ` Cached input is ${priceText(row.cached_input)} per 1M.`
          : ''
      }`,
    },
    {
      question: `What is ${row.display_name}'s context window?`,
      answer:
        row.context_window !== null
          ? `${row.display_name} accepts up to ${row.context_window.toLocaleString('en-US')} tokens in a single request${
              row.max_output_tokens !== null
                ? `, and can return up to ${row.max_output_tokens.toLocaleString('en-US')} output tokens`
                : ''
            }.`
          : `${row.provider_name} does not publish a context window for ${row.display_name} on its pricing page.`,
    },
  ]

  if (cheaperSibling) {
    faqs.push({
      question: `Is there a cheaper ${brandName} model than ${row.display_name}?`,
      answer: `Yes. ${cheaperSibling.display_name} is ${priceText(
        cheaperSibling.input,
      )} per 1M input tokens versus ${priceText(row.input)} for ${row.display_name}${
        cheaperSibling.context_window !== null
          ? `, with a ${cheaperSibling.context_window.toLocaleString('en-US')} token context window`
          : ''
      }.`,
    })
  }

  faqs.push({
    question: `Where does this ${row.display_name} price come from?`,
    answer:
      row.source_kind === 'scrape'
        ? `Directly from ${row.provider_name}'s published pricing page, re-read every day and normalized to USD per 1,000,000 tokens.`
        : `From the OpenRouter catalogue, because ${row.provider_name} does not publish machine-readable pricing. OpenRouter is a reseller, so its rate can differ from ${row.provider_name}'s own — verify before committing spend.`,
  })

  return faqs
}
