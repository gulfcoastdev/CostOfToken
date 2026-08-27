import type { Metadata } from 'next'
import Link from 'next/link'
import { Breadcrumbs, PageShell } from '@/components/site-chrome.tsx'
import { formatContext, formatPrice } from '@/lib/format.ts'
import { getFreeRoutes } from '@/lib/queries.ts'
import { modelPath } from '@/lib/seo.ts'

export const revalidate = 3600

const TITLE = 'Free AI Model Routes'
const DESCRIPTION =
  'Every model with a genuinely free API route we track right now — who serves it, its context window, when we last saw it free, and the cheapest paid fallback for when it rotates away.'

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/free' },
  openGraph: { title: `${TITLE} — CostOfToken`, description: DESCRIPTION, url: '/free' },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
}

export default async function FreePage() {
  const routes = await getFreeRoutes().catch(() => [])

  return (
    <PageShell>
      <Breadcrumbs trail={[{ name: 'Home', path: '/' }, { name: 'Free routes' }]} />
      <h1 className="mb-2 text-3xl font-bold tracking-tight text-neutral-950">
        Where models are free right now
      </h1>
      <p className="mb-2 max-w-3xl text-[15px] text-neutral-600">
        Free API routes we can verify today, mostly OpenRouter&apos;s rotating
        <code className="mx-1 rounded bg-neutral-100 px-1 py-0.5 font-mono text-xs">:free</code>
        roster. A model that is not listed has no production free API we know
        of — the frontier commercial models (Claude, GPT, Gemini Pro) almost
        never do. For those, the honest answer is the cheapest paid route on
        the model&apos;s own page.
      </p>
      <p className="mb-6 max-w-3xl text-sm text-neutral-500">
        Free routes are rate-limited, rotate without notice, and can differ
        from the paid door in context, tools and caching. Prices and rosters
        move — always confirm with the provider before depending on one.
      </p>

      {routes.length === 0 ? (
        <p className="text-neutral-600">
          No free routes in the current catalogue — check back after the next
          daily update.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
                <th className="px-4 py-3 font-medium">Model</th>
                <th className="px-4 py-3 font-medium">Free door</th>
                <th className="px-4 py-3 font-medium">Context</th>
                <th className="px-4 py-3 font-medium">Last checked</th>
                <th className="px-4 py-3 font-medium">Paid fallback</th>
              </tr>
            </thead>
            <tbody>
              {routes.map((route) => (
                <tr
                  key={`${route.providerSlug}:${route.modelId}`}
                  className="border-b border-neutral-100 last:border-0"
                >
                  <td className="px-4 py-3 font-medium text-neutral-900">
                    {route.canonicalName}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={modelPath(route.providerSlug, route.modelId)}
                      className="text-emerald-700 underline underline-offset-2"
                    >
                      {route.providerName}
                    </Link>{' '}
                    <code className="rounded bg-neutral-100 px-1 py-0.5 font-mono text-xs">
                      {route.modelId}
                    </code>
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {route.contextWindow ? formatContext(route.contextWindow) : '—'}
                  </td>
                  <td className="px-4 py-3 tabular-nums">{route.lastChecked ?? '—'}</td>
                  <td className="px-4 py-3">
                    {route.fallback ? (
                      <>
                        <Link
                          href={modelPath(route.fallback.providerSlug, route.fallback.modelId)}
                          className="text-emerald-700 underline underline-offset-2"
                        >
                          {route.fallback.providerName}
                        </Link>{' '}
                        <span className="tabular-nums text-neutral-600">
                          {formatPrice(route.fallback.inputPrice)} /{' '}
                          {formatPrice(route.fallback.outputPrice)} per 1M
                        </span>
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PageShell>
  )
}
