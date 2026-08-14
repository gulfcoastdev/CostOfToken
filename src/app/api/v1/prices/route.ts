import { errorResponse, gate, jsonResponse, parsePagination } from '@/lib/api.ts'
import { getPrices, isSortKey, type PriceFilters } from '@/lib/queries.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/v1/prices
 *
 * Query params:
 *   provider   repeatable, or comma-separated  (?provider=openai,anthropic)
 *   modality   text | vision | audio | video | image (unreliable — see docs)
 *   tag        flagship | fast | reasoning | ...
 *   q          substring match on model id or display name
 *   min_input, max_input, min_context
 *   sort       provider|model|input|cached_input|output|context|updated
 *   order      asc | desc
 *   limit      1..500 (default 100)
 *   offset     >= 0
 *   include_inactive  "true" to include delisted models
 */
export async function GET(request: Request) {
  const gated = await gate(request)
  if ('blocked' in gated) return gated.blocked

  const params = new URL(request.url).searchParams

  const pagination = parsePagination(params)
  if ('error' in pagination) {
    return errorResponse(400, 'invalid_parameter', pagination.error, gated.headers)
  }

  const numeric = (name: string): number | undefined | null => {
    const raw = params.get(name)
    if (raw === null) return undefined
    const parsed = Number(raw)
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
  }

  const minInput = numeric('min_input')
  const maxInput = numeric('max_input')
  const minContext = numeric('min_context')
  for (const [name, value] of [
    ['min_input', minInput],
    ['max_input', maxInput],
    ['min_context', minContext],
  ] as const) {
    if (value === null) {
      return errorResponse(
        400,
        'invalid_parameter',
        `${name} must be a non-negative number`,
        gated.headers,
      )
    }
  }

  const sortParam = params.get('sort')
  if (sortParam && !isSortKey(sortParam)) {
    return errorResponse(
      400,
      'invalid_parameter',
      `Unknown sort key "${sortParam}". Valid: provider, model, input, cached_input, output, context, updated.`,
      gated.headers,
    )
  }

  const providers = params
    .getAll('provider')
    .flatMap((value) => value.split(','))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)

  const filters: PriceFilters = {
    provider: providers.length > 0 ? providers : undefined,
    modality: params.get('modality')?.trim().toLowerCase() || undefined,
    tag: params.get('tag')?.trim().toLowerCase() || undefined,
    search: params.get('q')?.trim() || undefined,
    minInput: minInput ?? undefined,
    maxInput: maxInput ?? undefined,
    minContext: minContext ?? undefined,
    includeInactive: params.get('include_inactive') === 'true',
    sort: sortParam && isSortKey(sortParam) ? sortParam : 'input',
    direction: params.get('order') === 'desc' ? 'desc' : 'asc',
    limit: pagination.limit,
    offset: pagination.offset,
  }

  try {
    const { rows, total, lastUpdated } = await getPrices(filters)
    return jsonResponse(
      rows,
      { total, limit: filters.limit, offset: filters.offset, updated_at: lastUpdated },
      gated.headers,
    )
  } catch (error) {
    console.error('GET /api/v1/prices failed', error)
    return errorResponse(500, 'internal_error', 'Failed to load prices.', gated.headers)
  }
}
