import {
  PriceExplorer,
  type ExplorerRow,
  type InitialFilters,
} from '@/components/price-explorer.tsx'
import { getLastUpdated, getPriceTrends, getPrices, getProviders } from '@/lib/queries.ts'

/**
 * The comparison table.
 *
 * Data is read on the server straight from Postgres and handed to a client
 * component for filtering and sorting. The whole set is sent at once — 150-odd
 * rows is a few tens of KB — so every filter and sort is instant with no
 * round trip, which is the interaction the design calls for.
 */
export const revalidate = 300

type SortKey = 'value' | 'input' | 'output' | 'context' | 'provider'
const SORT_KEYS: SortKey[] = ['value', 'input', 'output', 'context', 'provider']
const MODALITIES = ['text', 'vision', 'audio', 'video', 'image']

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams

  let rows: ExplorerRow[] = []
  let providers: Array<{ slug: string; name: string }> = []
  let updatedAt: string | null = null
  let error: string | null = null

  try {
    const [page, trends, providerRows, lastUpdated] = await Promise.all([
      getPrices({ limit: 500, offset: 0, sort: 'input', direction: 'asc' }),
      getPriceTrends(),
      getProviders(),
      getLastUpdated(),
    ])

    rows = page.rows.map((row) => ({ ...row, trend: trends.get(row.model_id) ?? null }))
    // Only offer providers that actually have models to show.
    providers = providerRows.filter((p) => p.model_count > 0).map((p) => ({ slug: p.slug, name: p.name }))
    updatedAt = lastUpdated
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause)
  }

  if (error) {
    return <SetupNotice error={error} />
  }

  if (rows.length === 0) {
    return <SetupNotice error={null} />
  }

  return (
    <PriceExplorer
      rows={rows}
      providers={providers}
      updatedAt={updatedAt}
      initial={parseFilters(params, providers.map((p) => p.slug))}
    />
  )
}

/** Read shareable filter state out of the URL so a copied link restores the view. */
function parseFilters(
  params: Record<string, string | string[] | undefined>,
  knownProviders: string[],
): InitialFilters {
  const single = (key: string): string => {
    const value = params[key]
    return (Array.isArray(value) ? value[0] : value) ?? ''
  }

  const providerSet = new Set(knownProviders)
  const providers = single('providers')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => providerSet.has(s))

  const modality = single('modality').toLowerCase()
  const sort = single('sort') as SortKey

  return {
    providers,
    flagship: single('flagship') === '1',
    under1: single('under1') === '1',
    million: single('million') === '1',
    modality: MODALITIES.includes(modality) ? modality : '',
    search: single('q'),
    sort: SORT_KEYS.includes(sort) ? sort : 'value',
  }
}

function SetupNotice({ error }: { error: string | null }) {
  return (
    <main className="mx-auto max-w-3xl px-5 py-16">
      <h1 className="text-2xl font-bold tracking-tight text-neutral-950">CostOfToken</h1>
      <div className="mt-6 rounded-xl border border-amber-300 bg-amber-50 p-5 text-sm text-amber-900">
        <p className="font-semibold">
          {error ? 'Could not load prices.' : 'No pricing data yet.'}
        </p>
        {error && <p className="mt-2 font-mono text-xs text-amber-800">{error}</p>}
        <ol className="mt-3 list-decimal space-y-1 pl-5">
          <li>
            Set <code className="font-semibold">DATABASE_URL</code> in{' '}
            <code className="font-semibold">.env.local</code>
          </li>
          <li>
            Run <code className="font-semibold">npm run db:push</code>
          </li>
          <li>
            Run <code className="font-semibold">npm run pipeline:run</code>
          </li>
        </ol>
      </div>
    </main>
  )
}
