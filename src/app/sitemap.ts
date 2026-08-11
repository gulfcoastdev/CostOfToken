import type { MetadataRoute } from 'next'
import { getAllModelRefs, getLastUpdated, getProviders } from '@/lib/queries.ts'
import { absoluteUrl, modelPath, providerPath } from '@/lib/seo.ts'
import { COMPARISONS } from '../../data/comparisons.ts'

/**
 * Generated per request rather than at build time — see src/app/page.tsx.
 * Reading the database during the build is what fails; serving it on demand
 * works, and the response is CDN-cached by its Cache-Control anyway.
 */
export const dynamic = 'force-dynamic'

/**
 * Generated from the database so it reflects what actually exists.
 *
 * `lastModified` comes from each model's price row rather than the build time.
 * A sitemap that claims every page changed on every deploy trains crawlers to
 * ignore the field; one that moves only when a price moves is a real freshness
 * signal, which is the whole point for a daily-updated dataset.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date()

  try {
    // Sequential: concurrent reads sharing one database connection deadlock.
    const models = await getAllModelRefs()
    const providers = await getProviders()
    const lastUpdated = await getLastUpdated()

    const homeModified = lastUpdated ? new Date(lastUpdated) : now

    const entries: MetadataRoute.Sitemap = [
      {
        url: absoluteUrl('/'),
        lastModified: homeModified,
        changeFrequency: 'daily',
        priority: 1,
      },
      {
        url: absoluteUrl('/providers'),
        lastModified: homeModified,
        changeFrequency: 'daily' as const,
        priority: 0.9,
      },
      {
        url: absoluteUrl('/api-docs'),
        lastModified: homeModified,
        changeFrequency: 'weekly' as const,
        priority: 0.7,
      },
      {
        url: absoluteUrl('/calculator'),
        lastModified: homeModified,
        changeFrequency: 'daily' as const,
        priority: 0.9,
      },
      ...COMPARISONS.map((pair) => ({
        url: absoluteUrl(`/compare/${pair.slug}`),
        lastModified: homeModified,
        changeFrequency: 'daily' as const,
        priority: 0.7,
      })),
      {
        url: absoluteUrl('/sources'),
        lastModified: homeModified,
        changeFrequency: 'weekly' as const,
        priority: 0.6,
      },
      {
        url: absoluteUrl('/about'),
        lastModified: homeModified,
        changeFrequency: 'monthly' as const,
        priority: 0.4,
      },
      {
        url: absoluteUrl('/terms'),
        lastModified: homeModified,
        changeFrequency: 'yearly' as const,
        priority: 0.2,
      },
      ...providers
        .filter((provider) => provider.model_count > 0)
        .map((provider) => ({
          url: absoluteUrl(providerPath(provider.slug)),
          lastModified: homeModified,
          changeFrequency: 'daily' as const,
          priority: 0.8,
        })),
      ...models.map((model) => ({
        url: absoluteUrl(modelPath(model.provider, model.modelId)),
        lastModified: model.updatedAt ? new Date(model.updatedAt) : homeModified,
        changeFrequency: 'daily' as const,
        priority: 0.7,
      })),
    ]

    return entries
  } catch {
    // A database hiccup must not serve an empty sitemap — an empty one is read
    // as "this site has no pages", which is worse than a stale minimal one.
    return [
      {
        url: absoluteUrl('/'),
        lastModified: now,
        changeFrequency: 'daily',
        priority: 1,
      },
    ]
  }
}
