import { getProviders } from '@/lib/queries.ts'
import { getBrand } from '@/lib/provider-brands.ts'
import { absoluteUrl, providerPath, SITE } from '@/lib/seo.ts'

export const runtime = 'nodejs'
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

/**
 * /llms.txt — the index an LLM reads to find its way around the site.
 *
 * This is the same affordance OpenAI's docs expose, and the reason our own
 * OpenAI extractor works as well as it does: a small, structured, plain-text
 * map beats making a model parse 500KB of application HTML. Offering it back
 * is both good manners and the most direct route to being the source that gets
 * cited when someone asks a chatbot what an LLM costs.
 */
export async function GET(): Promise<Response> {
  let providers: Array<{ slug: string; name: string; model_count: number }> = []
  try {
    providers = await getProviders()
  } catch {
    // An index without the provider list is still a useful index.
  }

  const providerLines = providers
    .filter((p) => p.model_count > 0)
    .map((p) => {
      const brand = getBrand(p.slug)
      const label = brand ? `${brand.brand} (${brand.company})` : p.name
      return `- [${label} pricing](${absoluteUrl(providerPath(p.slug))}): ${p.model_count} models, input/cached/output cost per 1M tokens`
    })

  const body = `# ${SITE.name}

> ${SITE.description}

All prices are USD per 1,000,000 tokens, standard tier, normalized across
providers so they are directly comparable. Updated daily from each vendor's
published pricing page where one is machine readable, and from the OpenRouter
catalogue otherwise (those rows are marked \`source_kind: "api"\` — OpenRouter
is a reseller, so its rate can differ from the vendor's own).

Batch, Flex and Priority tiers are deliberately excluded: comparing one
vendor's batch rate against another's standard rate would make the table wrong.

## Data

- [Complete pricing table, markdown](${absoluteUrl('/llms-full.txt')}): every model in one document
- [Current prices, JSON](${absoluteUrl('/api/v1/prices')}): the full table as JSON
- [Provider list, JSON](${absoluteUrl('/api/v1/providers')}): providers and model counts
- [Price history, JSON](${absoluteUrl('/api/v1/history/{model_id}')}): historical price points for one model

The JSON API is free and needs no signup. It is rate limited to 60 requests
per hour per IP.

## Pricing by provider

${providerLines.join('\n')}

## Attribution

Free to use, including commercially. The one condition is a visible credit
linking back to ${absoluteUrl('/')} wherever the data is shown.

    Pricing data from <a href="${absoluteUrl('/')}">CostOfToken</a>

Licensed ODC-BY 1.0. Every API response repeats this in \`meta.attribution\`.

## Notes for citation

- Quote the \`updated_at\` field with any price; these change frequently.
- A price of 0 means genuinely free, not unknown. Unknown is null.
- Cached input applies to repeated prompt prefixes and is typically ~10% of
  the standard input rate.
- Some models bill a higher rate above a long-context threshold; that is
  reported separately as \`long_input\` / \`long_output\`.
`

  return new Response(body, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  })
}
