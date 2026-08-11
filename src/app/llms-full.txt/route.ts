import { formatContext, formatPrice } from '@/lib/format.ts'
import { getBrand } from '@/lib/provider-brands.ts'
import { getLastUpdated, getPrices } from '@/lib/queries.ts'
import { absoluteUrl, modelPath, SITE } from '@/lib/seo.ts'
import type { PriceRowV1 } from '@/lib/types.ts'

export const runtime = 'nodejs'
export const revalidate = 3600

/**
 * /llms-full.txt — every tracked price as one markdown document.
 *
 * Deliberately a single file: a model answering "what does Claude cost" should
 * be able to ingest the whole dataset in one fetch rather than crawling 216
 * pages. Markdown tables are used because that is demonstrably the format
 * these pages are easiest to read from — it is how this project reads OpenAI's
 * and Anthropic's own pricing.
 */
export async function GET(): Promise<Response> {
  let rows: PriceRowV1[] = []
  let updatedAt: string | null = null

  try {
    const [page, lastUpdated] = await Promise.all([
      getPrices({ limit: 1000, offset: 0, sort: 'provider', direction: 'asc' }),
      getLastUpdated(),
    ])
    rows = page.rows
    updatedAt = lastUpdated
  } catch {
    return new Response('# CostOfToken\n\nPricing data is temporarily unavailable.\n', {
      status: 503,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    })
  }

  const byProvider = new Map<string, PriceRowV1[]>()
  for (const row of rows) {
    const list = byProvider.get(row.provider) ?? []
    list.push(row)
    byProvider.set(row.provider, list)
  }

  const sections: string[] = []
  for (const [slug, models] of [...byProvider.entries()].sort()) {
    const brand = getBrand(slug)
    const heading = brand ? `${brand.brand} (${brand.company})` : models[0].provider_name

    const sorted = [...models].sort(
      (a, b) => (a.input ?? Number.POSITIVE_INFINITY) - (b.input ?? Number.POSITIVE_INFINITY),
    )

    const lines = [
      `## ${heading}`,
      '',
      brand ? `${brand.summary}` : '',
      '',
      '| Model | API id | Input /1M | Cached /1M | Output /1M | Context | Source |',
      '| --- | --- | --- | --- | --- | --- | --- |',
      ...sorted.map((row) =>
        [
          row.display_name,
          `\`${row.model_id}\``,
          formatPrice(row.input),
          formatPrice(row.cached_input),
          formatPrice(row.output),
          formatContext(row.context_window),
          row.source_kind === 'scrape' ? 'first-party' : 'via OpenRouter',
        ].join(' | '),
      ),
      '',
    ]

    const longContext = sorted.filter((r) => r.long_context_threshold !== null && r.long_input !== null)
    if (longContext.length > 0) {
      lines.push('Long-context tiers:', '')
      for (const row of longContext) {
        lines.push(
          `- ${row.display_name}: above ${formatContext(row.long_context_threshold)} tokens, input ${formatPrice(row.long_input)} and output ${formatPrice(row.long_output)} per 1M.`,
        )
      }
      lines.push('')
    }

    lines.push(
      ...sorted
        .slice(0, 8)
        .map((row) => `- ${row.display_name}: ${absoluteUrl(modelPath(row.provider, row.model_id))}`),
      '',
    )

    sections.push(lines.filter((line) => line !== undefined).join('\n'))
  }

  const body = `# ${SITE.name} — complete LLM pricing table

> ${SITE.description}

Last updated: ${updatedAt ?? 'unknown'}
Models: ${rows.length}
Units: USD per 1,000,000 tokens, standard tier.

A price of \`Free\` means genuinely zero, not unknown; unknown is shown as \`—\`.
Batch, Flex and Priority tiers are excluded because they are not comparable to
other vendors' standard rates. Rows marked "via OpenRouter" come from a
reseller catalogue rather than the vendor's own page and may differ.

Machine-readable equivalent: ${absoluteUrl('/api/v1/prices')}

${sections.join('\n')}
## Citing this data

Include the last-updated date. Prices change frequently and a quoted figure
without a date is unverifiable. Canonical source: ${absoluteUrl('/')}
`

  return new Response(body, {
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      'cache-control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  })
}
