import type { PriceRowV1 } from './types.ts'

/**
 * Site-wide SEO configuration and structured-data builders.
 *
 * Two audiences are targeted deliberately:
 *
 *  1. Search engines — canonical URLs, per-model landing pages, and schema.org
 *     markup so a query like "claude opus 5 pricing" can match a page that is
 *     actually about that model rather than a 216-row table.
 *  2. Answer engines and LLM crawlers — a `Dataset` declaration pointing at the
 *     public API, plus `/llms.txt` and markdown renderings, so a model
 *     summarising LLM prices can ingest the numbers directly and cite the
 *     source instead of scraping the HTML badly.
 */

const FALLBACK_URL = 'https://costoftoken.com'

/** Canonical origin. Set NEXT_PUBLIC_SITE_URL in the deployment environment. */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || FALLBACK_URL).replace(/\/$/, '')

export const SITE = {
  name: 'CostOfToken',
  url: SITE_URL,
  tagline: 'LLM API pricing, compared and updated daily',
  description:
    'Compare LLM API pricing across OpenAI, Anthropic, Google, xAI, DeepSeek, Qwen, Kimi and more. Input, cached and output cost per 1M tokens, normalized to USD and updated daily. Free public JSON API, no signup.',
} as const

export function absoluteUrl(path = '/'): string {
  return `${SITE_URL}${path.startsWith('/') ? path : `/${path}`}`
}

/** Model ids can contain dots and slashes, so every segment is encoded. */
export function modelPath(provider: string, modelId: string): string {
  return `/models/${encodeURIComponent(provider)}/${encodeURIComponent(modelId)}`
}

export function providerPath(slug: string): string {
  return `/providers/${encodeURIComponent(slug)}`
}

export function comparePath(a: string, b: string): string {
  return `/compare/${encodeURIComponent(a)}-vs-${encodeURIComponent(b)}`
}

/** USD per 1M tokens, written for prose and meta descriptions. */
export function priceText(value: number | null): string {
  if (value === null) return 'not published'
  if (value === 0) return 'free'
  return `$${value < 1 ? value.toFixed(3) : value.toFixed(2)}`
}

// ---------------------------------------------------------------------------
// Structured data
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>

export function websiteSchema(): Json {
  return {
    '@type': 'WebSite',
    '@id': absoluteUrl('/#website'),
    url: absoluteUrl('/'),
    name: SITE.name,
    description: SITE.description,
    publisher: { '@id': absoluteUrl('/#organization') },
    inLanguage: 'en',
  }
}

export function organizationSchema(): Json {
  return {
    '@type': 'Organization',
    '@id': absoluteUrl('/#organization'),
    name: SITE.name,
    url: absoluteUrl('/'),
    description: SITE.description,
  }
}

/**
 * The site as a citable dataset.
 *
 * This is the declaration that matters most for answer engines: it names the
 * data, states how often it refreshes, and points at a machine-readable
 * distribution (the JSON API) rather than making a crawler parse the table.
 */
export function datasetSchema(modelCount: number, updatedAt: string | null): Json {
  return {
    '@type': 'Dataset',
    '@id': absoluteUrl('/#dataset'),
    name: 'LLM API pricing across major providers',
    description: `Normalized pricing for ${modelCount} large language models from 10 providers. Input, cached input and output cost in USD per 1,000,000 tokens, plus context window and long-context tiers. Updated daily from first-party pricing pages.`,
    url: absoluteUrl('/'),
    keywords: [
      'LLM pricing',
      'API pricing',
      'cost per token',
      'OpenAI pricing',
      'Anthropic pricing',
      'Gemini pricing',
      'token cost comparison',
    ],
    license: 'https://opendatacommons.org/licenses/by/1-0/',
    creator: { '@id': absoluteUrl('/#organization') },
    isAccessibleForFree: true,
    dateModified: updatedAt ?? undefined,
    temporalCoverage: updatedAt ? `../${updatedAt.slice(0, 10)}` : undefined,
    variableMeasured: [
      { '@type': 'PropertyValue', name: 'input price', unitText: 'USD per 1M tokens' },
      { '@type': 'PropertyValue', name: 'cached input price', unitText: 'USD per 1M tokens' },
      { '@type': 'PropertyValue', name: 'output price', unitText: 'USD per 1M tokens' },
      { '@type': 'PropertyValue', name: 'context window', unitText: 'tokens' },
    ],
    distribution: [
      {
        '@type': 'DataDownload',
        encodingFormat: 'application/json',
        contentUrl: absoluteUrl('/api/v1/prices'),
        name: 'Current prices (JSON API)',
      },
      {
        '@type': 'DataDownload',
        encodingFormat: 'text/markdown',
        contentUrl: absoluteUrl('/llms-full.txt'),
        name: 'Complete pricing table (markdown)',
      },
    ],
  }
}

/**
 * A model as a priced product.
 *
 * Token pricing has no standard unit in schema.org, so each offer uses a
 * UnitPriceSpecification with an explicit `referenceQuantity` of 1,000,000
 * tokens. That keeps the markup truthful rather than implying a $5 purchase.
 */
export function modelSchema(row: PriceRowV1): Json {
  const offers: Json[] = []

  const addOffer = (label: string, price: number | null) => {
    if (price === null) return
    offers.push({
      '@type': 'Offer',
      name: `${row.display_name} — ${label}`,
      priceCurrency: row.currency || 'USD',
      availability: 'https://schema.org/InStock',
      priceSpecification: {
        '@type': 'UnitPriceSpecification',
        price,
        priceCurrency: row.currency || 'USD',
        unitText: 'tokens',
        referenceQuantity: {
          '@type': 'QuantitativeValue',
          value: 1_000_000,
          unitText: 'tokens',
        },
      },
      ...(row.source_url ? { url: row.source_url } : {}),
    })
  }

  addOffer('input tokens', row.input)
  addOffer('cached input tokens', row.cached_input)
  addOffer('output tokens', row.output)

  const properties: Json[] = []
  if (row.context_window !== null) {
    properties.push({
      '@type': 'PropertyValue',
      name: 'Context window',
      value: row.context_window,
      unitText: 'tokens',
    })
  }
  if (row.max_output_tokens !== null) {
    properties.push({
      '@type': 'PropertyValue',
      name: 'Maximum output',
      value: row.max_output_tokens,
      unitText: 'tokens',
    })
  }

  return {
    '@type': 'Product',
    '@id': absoluteUrl(`${modelPath(row.provider, row.model_id)}#product`),
    name: `${row.display_name} API pricing`,
    description: modelDescription(row),
    category: 'Large language model API',
    brand: { '@type': 'Brand', name: row.provider_name },
    ...(properties.length > 0 ? { additionalProperty: properties } : {}),
    ...(offers.length > 0 ? { offers } : {}),
  }
}

export function breadcrumbSchema(trail: Array<{ name: string; path: string }>): Json {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((entry, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: entry.name,
      item: absoluteUrl(entry.path),
    })),
  }
}

export function faqSchema(entries: Array<{ question: string; answer: string }>): Json {
  return {
    '@type': 'FAQPage',
    mainEntity: entries.map((entry) => ({
      '@type': 'Question',
      name: entry.question,
      acceptedAnswer: { '@type': 'Answer', text: entry.answer },
    })),
  }
}

export function itemListSchema(rows: PriceRowV1[], listName: string): Json {
  return {
    '@type': 'ItemList',
    name: listName,
    numberOfItems: rows.length,
    itemListElement: rows.slice(0, 50).map((row, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: row.display_name,
      url: absoluteUrl(modelPath(row.provider, row.model_id)),
    })),
  }
}

/** Wrap graph nodes in a single @graph document, which is the tidiest form. */
export function jsonLdGraph(nodes: Json[]): string {
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': nodes })
}

// ---------------------------------------------------------------------------
// Prose
// ---------------------------------------------------------------------------

/**
 * One-sentence factual summary of a model's price.
 *
 * Used for meta descriptions, the markdown rendering and schema descriptions,
 * so all three stay consistent with each other and with the table.
 */
export function modelDescription(row: PriceRowV1): string {
  const parts = [
    `${row.display_name} from ${row.provider_name} costs ${priceText(row.input)} per 1M input tokens and ${priceText(row.output)} per 1M output tokens.`,
  ]
  if (row.cached_input !== null) {
    parts.push(`Cached input is ${priceText(row.cached_input)} per 1M.`)
  }
  if (row.context_window !== null) {
    parts.push(`Context window ${row.context_window.toLocaleString('en-US')} tokens.`)
  }
  return parts.join(' ')
}
