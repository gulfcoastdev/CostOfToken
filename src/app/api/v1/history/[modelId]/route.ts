import { errorResponse, gate, jsonResponse, parsePagination } from '@/lib/api.ts'
import { getHistory, getModel } from '@/lib/queries.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/v1/history/:model_id — historical price points, newest first.
 *
 * History rows are written only when a price actually changes, so an
 * unchanged model returns a single point (its first recording) rather than one
 * row per day.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ modelId: string }> },
) {
  const gated = await gate(request)
  if ('blocked' in gated) return gated.blocked

  const { modelId } = await params
  const decoded = decodeURIComponent(modelId)

  const pagination = parsePagination(new URL(request.url).searchParams, {
    defaultLimit: 365,
    maxLimit: 1000,
  })
  if ('error' in pagination) {
    return errorResponse(400, 'invalid_parameter', pagination.error, gated.headers)
  }

  try {
    const model = await getModel(decoded)
    if (!model) {
      return errorResponse(404, 'not_found', `No model with id "${decoded}".`, gated.headers)
    }

    const points = await getHistory(decoded, pagination.limit)
    return jsonResponse(
      points,
      { limit: pagination.limit, updated_at: points[0]?.recorded_at ?? null },
      gated.headers,
    )
  } catch (error) {
    console.error('GET /api/v1/history/[modelId] failed', error)
    return errorResponse(500, 'internal_error', 'Failed to load history.', gated.headers)
  }
}
