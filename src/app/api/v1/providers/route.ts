import { errorResponse, gate, jsonResponse } from '@/lib/api.ts'
import { getProviders } from '@/lib/queries.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/v1/providers — provider list with active model counts, for filter UIs. */
export async function GET(request: Request) {
  const gated = await gate(request)
  if ('blocked' in gated) return gated.blocked

  try {
    const providers = await getProviders()
    return jsonResponse(providers, { total: providers.length }, gated.headers)
  } catch (error) {
    console.error('GET /api/v1/providers failed', error)
    return errorResponse(500, 'internal_error', 'Failed to load providers.', gated.headers)
  }
}
