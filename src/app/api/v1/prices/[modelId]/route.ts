import { errorResponse, gate, jsonResponse } from '@/lib/api.ts'
import { getModel } from '@/lib/queries.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/v1/prices/:model_id — single model with its latest price. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ modelId: string }> },
) {
  const gated = await gate(request)
  if ('blocked' in gated) return gated.blocked

  const { modelId } = await params
  const decoded = decodeURIComponent(modelId)

  try {
    const model = await getModel(decoded)
    if (!model) {
      return errorResponse(404, 'not_found', `No model with id "${decoded}".`, gated.headers)
    }
    return jsonResponse([model], { updated_at: model.updated_at }, gated.headers)
  } catch (error) {
    console.error('GET /api/v1/prices/[modelId] failed', error)
    return errorResponse(500, 'internal_error', 'Failed to load model.', gated.headers)
  }
}
