import { NextResponse } from 'next/server'
import { checkRateLimit, rateLimitHeaders } from './rate-limit.ts'

/** Shared response envelope and rate-limit gate for every /api/v1 route. */

export const API_VERSION = 'v1'

export interface ApiMeta {
  version: string
  count: number
  total?: number
  limit?: number
  offset?: number
  updated_at?: string | null
}

export function jsonResponse<T>(
  data: T[],
  meta: Omit<ApiMeta, 'version' | 'count'>,
  headers: Record<string, string> = {},
): NextResponse {
  return NextResponse.json(
    { meta: { version: API_VERSION, count: data.length, ...meta }, data },
    {
      headers: {
        'cache-control': 'public, s-maxage=300, stale-while-revalidate=3600',
        ...headers,
      },
    },
  )
}

export function errorResponse(
  status: number,
  code: string,
  message: string,
  headers: Record<string, string> = {},
): NextResponse {
  return NextResponse.json(
    { error: { code, message }, meta: { version: API_VERSION } },
    { status, headers: { 'cache-control': 'no-store', ...headers } },
  )
}

/**
 * Apply the rate limit. Returns a 429 response to return immediately, or the
 * headers to merge into a successful response.
 */
export async function gate(
  request: Request,
): Promise<{ blocked: NextResponse } | { headers: Record<string, string> }> {
  const result = await checkRateLimit(request)
  const headers = rateLimitHeaders(result)

  if (!result.allowed) {
    return {
      blocked: errorResponse(
        429,
        'rate_limited',
        `Rate limit of ${result.limit} requests/hour exceeded. Retry in ${result.retryAfterSeconds}s.`,
        { ...headers, 'retry-after': String(result.retryAfterSeconds) },
      ),
    }
  }

  return { headers }
}

/** Parse and clamp pagination, rejecting garbage rather than silently defaulting. */
export function parsePagination(
  params: URLSearchParams,
  { defaultLimit = 100, maxLimit = 500 } = {},
): { limit: number; offset: number } | { error: string } {
  const rawLimit = params.get('limit')
  const rawOffset = params.get('offset')

  let limit = defaultLimit
  if (rawLimit !== null) {
    const parsed = Number(rawLimit)
    if (!Number.isInteger(parsed) || parsed < 1) {
      return { error: `limit must be an integer >= 1, got "${rawLimit}"` }
    }
    limit = Math.min(parsed, maxLimit)
  }

  let offset = 0
  if (rawOffset !== null) {
    const parsed = Number(rawOffset)
    if (!Number.isInteger(parsed) || parsed < 0) {
      return { error: `offset must be an integer >= 0, got "${rawOffset}"` }
    }
    offset = parsed
  }

  return { limit, offset }
}
