import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, permanentRedirect } from 'next/navigation'
import { Breadcrumbs, JsonLd, PageShell, PriceStat, SiteFooter } from '@/components/site-chrome.tsx'
import { formatContext, formatPrice } from '@/lib/format.ts'
import { getBrand, PROVIDER_ALIAS_MAP, PROVIDER_BRANDS } from '@/lib/provider-brands.ts'
import { getLastUpdated, getProviderModels, getProviders } from '@/lib/queries.ts'
import {
  absoluteUrl,
  breadcrumbSchema,
  faqSchema,
  itemListSchema,
  modelPath,
  priceText,
  providerPath,
} from '@/lib/seo.ts'
import type { PriceRowV1 } from '@/lib/types.ts'

export const revalidate = 3600

export async function generateStaticParams() {
  return Object.keys(PROVIDER_BRANDS).map((slug) => ({ slug }))
}

/** Resolve an alias to its canonical slug, or null if the segment is unknown. */
function resolve(slug: string): { canonical: string; isAlias: boolean } | null {
  const lower = slug.toLowerCase()
  if (PROVIDER_BRANDS[lower]) return { canonical: lower, isAlias: false }
  const aliased = PROVIDER_ALIAS_MAP[lower]
  if (aliased) return { canonical: aliased, isAlias: true }
  return null
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const resolved = resolve(slug)
  if (!resolved) return { title: 'Provider not found' }

  const brand = getBrand(resolved.canonical)
  if (!brand) return { title: 'Provider not found' }

  let models: PriceRowV1[] = []
  try {
    models = await getProviderModels(resolved.canonical)
  } catch {
    // Metadata must still render if the database is unreachable.
  }

  const priced = models.filter((m) => m.input !== null)
  const cheapest = priced.at(0)
  const count = models.length

  const title = `${brand.brand} API Pricing — Cost per 1M Tokens`
  const description =
    count > 0
      ? `${brand.brand} API pricing for all ${count} ${brand.company} models. ${
          cheapest
            ? `From ${priceText(cheapest.input)} per 1M input tokens (${cheapest.display_name}). `
            : ''
        }Input, cached and output cost side by side, updated daily.`
      : `${brand.brand} API pricing from ${brand.company}, updated daily.`

  return {
    title,
    description,
    alternates: { canonical: providerPath(resolved.canonical) },
    openGraph: {
      title: `${title} — CostOfToken`,
      description,
      url: providerPath(resolved.canonical),
      type: 'website',
    },
    twitter: { card: 'summary_large_image', title, description },
  }
}

export default async function ProviderPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const resolved = resolve(slug)
  if (!resolved) notFound()

  // Aliases redirect rather than render, so "claude", "gemini" and the
  // canonical page never compete with each other for the same query.
  if (resolved.isAlias) permanentRedirect(providerPath(resolved.canonical))

  const brand = getBrand(resolved.canonical)
  if (!brand) notFound()

  let models: PriceRowV1[] = []
  let updatedAt: string | null = null
  try {
    ;[models, updatedAt] = await Promise.all([
      getProviderModels(resolved.canonical),
      getLastUpdated(),
    ])
  } catch {
    models = []
  }

  if (models.length === 0) notFound()

  const priced = models.filter((m) => m.input !== null)
  const cheapest = priced.at(0)
  const flagship = [...priced].sort((a, b) => (b.input ?? 0) - (a.input ?? 0)).at(0)
  const largestContext = [...models]
    .filter((m) => m.context_window !== null)
    .sort((a, b) => (b.context_window ?? 0) - (a.context_window ?? 0))
    .at(0)

  const otherProviders = (await getProviders().catch(() => []))
    .filter((p) => p.model_count > 0 && p.slug !== resolved.canonical)
    .slice(0, 12)

  const faqs = buildFaqs(brand.brand, models, cheapest, flagship)

  return (
    <PageShell>
      <JsonLd
        nodes={[
          breadcrumbSchema([
            { name: 'LLM pricing', path: '/' },
            { name: `${brand.brand} pricing`, path: providerPath(resolved.canonical) },
          ]),
          {
            '@type': 'CollectionPage',
            '@id': absoluteUrl(`${providerPath(resolved.canonical)}#page`),
            name: `${brand.brand} API pricing`,
            url: absoluteUrl(providerPath(resolved.canonical)),
            dateModified: updatedAt ?? undefined,
            about: { '@type': 'Organization', name: brand.company },
          },
          itemListSchema(models, `${brand.brand} models and prices`),
          faqSchema(faqs),
        ]}
      />

      <Breadcrumbs
        trail={[{ name: 'LLM pricing', path: '/' }, { name: `${brand.brand} pricing` }]}
      />

      <header className="mb-6">
        <h1 className="m-0 text-3xl font-bold tracking-tight text-neutral-950">
          {brand.brand} API pricing
        </h1>
        <p className="mt-2 max-w-3xl text-[15px] leading-relaxed text-neutral-700">
          Every {brand.brand} model {brand.company === brand.brand ? '' : `from ${brand.company} `}
          we track, with input, cached input and output cost in USD per 1M tokens.{' '}
          {brand.summary}
        </p>
        <p className="mt-2 text-[13px] text-neutral-500">
          {models.length} models · updated{' '}
          {updatedAt ? new Date(updatedAt).toISOString().slice(0, 10) : 'daily'} · prices in USD per
          1,000,000 tokens
        </p>
      </header>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <PriceStat label="Models tracked" value={String(models.length)} />
        {cheapest && (
          <PriceStat label={`Cheapest input — ${cheapest.display_name}`} value={formatPrice(cheapest.input)} accent />
        )}
        {flagship && (
          <PriceStat label={`Priciest input — ${flagship.display_name}`} value={formatPrice(flagship.input)} />
        )}
        {largestContext && (
          <PriceStat
            label={`Largest context — ${largestContext.display_name}`}
            value={formatContext(largestContext.context_window)}
          />
        )}
      </div>

      <section className="mb-8 overflow-x-auto rounded-xl border border-neutral-200 bg-white">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <caption className="sr-only">
            {brand.brand} models with input, cached input and output pricing per million tokens
          </caption>
          <thead>
            <tr className="border-b border-neutral-200 text-left text-xs font-semibold text-neutral-500">
              <th scope="col" className="px-3 py-2.5">Model</th>
              <th scope="col" className="px-3 py-2.5 text-right">Input /1M</th>
              <th scope="col" className="px-3 py-2.5 text-right">Cached /1M</th>
              <th scope="col" className="px-3 py-2.5 text-right">Output /1M</th>
              <th scope="col" className="px-3 py-2.5 text-right">Context</th>
            </tr>
          </thead>
          <tbody>
            {models.map((model) => (
              <tr key={model.model_id} className="border-b border-neutral-100 last:border-0">
                <th scope="row" className="px-3 py-2.5 text-left font-medium">
                  <Link
                    href={modelPath(model.provider, model.model_id)}
                    className="font-semibold text-neutral-900 underline underline-offset-2 hover:text-emerald-700"
                  >
                    {model.display_name}
                  </Link>
                </th>
                <td className="px-3 py-2.5 text-right font-semibold tabular-nums">
                  {formatPrice(model.input)}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-neutral-700">
                  {formatPrice(model.cached_input)}
                </td>
                <td className="px-3 py-2.5 text-right font-semibold tabular-nums">
                  {formatPrice(model.output)}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-neutral-700">
                  {formatContext(model.context_window)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-xl font-semibold tracking-tight text-neutral-950">
          {brand.brand} pricing questions
        </h2>
        <dl className="space-y-4">
          {faqs.map((faq) => (
            <div key={faq.question} className="rounded-xl border border-neutral-200 bg-white px-5 py-4">
              <dt className="font-semibold text-neutral-900">{faq.question}</dt>
              <dd className="m-0 mt-1.5 text-[15px] leading-relaxed text-neutral-700">
                {faq.answer}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-xl font-semibold tracking-tight text-neutral-950">
          Compare with other providers
        </h2>
        <ul className="flex flex-wrap gap-2 p-0">
          {otherProviders.map((other) => {
            const otherBrand = getBrand(other.slug)
            return (
              <li key={other.slug} className="list-none">
                <Link
                  href={providerPath(other.slug)}
                  className="inline-block rounded-full border border-neutral-200 bg-white px-3.5 py-1.5 text-[13px] font-medium text-neutral-700 hover:border-emerald-600 hover:text-emerald-700"
                >
                  {otherBrand?.brand ?? other.name} pricing
                </Link>
              </li>
            )
          })}
        </ul>
      </section>

      <SiteFooter />
    </PageShell>
  )
}

/**
 * Answers written from the row data, so they cannot drift from the table.
 *
 * These target the phrasing people actually search ("how much does X cost",
 * "what is the cheapest X model") and are the content most likely to be quoted
 * verbatim by an answer engine.
 */
function buildFaqs(
  brand: string,
  models: PriceRowV1[],
  cheapest: PriceRowV1 | undefined,
  flagship: PriceRowV1 | undefined,
): Array<{ question: string; answer: string }> {
  const faqs: Array<{ question: string; answer: string }> = []

  if (flagship) {
    faqs.push({
      question: `How much does the ${brand} API cost?`,
      answer: `${brand} pricing runs from ${priceText(cheapest?.input ?? null)} to ${priceText(
        flagship.input,
      )} per 1M input tokens depending on the model. ${flagship.display_name} costs ${priceText(
        flagship.input,
      )} per 1M input and ${priceText(flagship.output)} per 1M output tokens.`,
    })
  }

  if (cheapest) {
    faqs.push({
      question: `What is the cheapest ${brand} model?`,
      answer: `${cheapest.display_name} is the cheapest ${brand} model we track, at ${priceText(
        cheapest.input,
      )} per 1M input tokens and ${priceText(cheapest.output)} per 1M output tokens.`,
    })
  }

  const cached = models.find((m) => m.cached_input !== null && m.input !== null && m.input > 0)
  if (cached && cached.cached_input !== null && cached.input) {
    const discount = Math.round((1 - cached.cached_input / cached.input) * 100)
    faqs.push({
      question: `Does ${brand} charge less for cached tokens?`,
      answer: `Yes. Cached input is billed at a lower rate than fresh input — for ${cached.display_name} it is ${priceText(
        cached.cached_input,
      )} per 1M versus ${priceText(cached.input)}, about ${discount}% cheaper. Caching applies to repeated prompt prefixes.`,
    })
  }

  faqs.push({
    question: `How often is this ${brand} pricing updated?`,
    answer:
      'Every day. Prices are read directly from the published pricing page, normalized to USD per 1,000,000 tokens, and only recorded when a number actually changes — so the history shows real price movements rather than daily noise.',
  })

  return faqs
}
