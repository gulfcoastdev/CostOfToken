import { createHash } from 'node:crypto'
import { sql } from './db.ts'
import { env } from './env.ts'

/**
 * Fixed-window rate limiting backed by Postgres.
 *
 * Chosen over Redis so the whole stack stays on Supabase + Vercel with nothing
 * else to provision. The counter is incremented by a single atomic
 * `insert ... on conflict do update ... returning`, so concurrent lambdas
 * can't race past the limit. If traffic ever outgrows this, swap the body of
 * `consume()` for an Upstash call — the interface is the seam.
 */

export interface RateLimitResult {
  allowed: boolean
  limit: number
  remaining: number
  /** Unix seconds when the current window resets. */
  reset: number
  retryAfterSeconds: number
  subject: string
}

const WINDOW_MS = 60 * 60 * 1000 // 1 hour

/**
 * Identify the caller.
 *
 * Only the first entry of x-forwarded-for is used, and only because Vercel
 * overwrites that header at the edge — behind a proxy that doesn't, a client
 * could spoof it to dodge the limit.
 */
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()
    if (first) return first
  }
  return request.headers.get('x-real-ip')?.trim() || 'unknown'
}

function presentedApiKey(request: Request): string | null {
  const header = request.headers.get('authorization')
  if (header?.toLowerCase().startsWith('bearer ')) {
    const token = header.slice(7).trim()
    if (token) return token
  }
  const direct = request.headers.get('x-api-key')?.trim()
  return direct || null
}

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

/** Start of the caller's current window, aligned to the hour. */
function currentWindowStart(now = Date.now()): Date {
  return new Date(Math.floor(now / WINDOW_MS) * WINDOW_MS)
}

export async function checkRateLimit(request: Request): Promise<RateLimitResult> {
  const presented = presentedApiKey(request)

  let subject: string
  let limit = env.anonRateLimitPerHour

  if (presented) {
    const [row] = await sql<Array<{ id: string; rate_limit: number }>>`
      select id, rate_limit from api_keys
       where key_hash = ${hashApiKey(presented)} and is_active
       limit 1
    `
    if (row) {
      subject = `key:${row.id}`
      limit = row.rate_limit
      // Fire-and-forget: last_used_at is diagnostic, not worth blocking on.
      void sql`update api_keys set last_used_at = now() where id = ${row.id}`.catch(() => {})
    } else {
      // An unrecognised key falls back to anonymous limits rather than being
      // rejected, so a rotated key degrades instead of hard-failing.
      subject = `ip:${getClientIp(request)}`
    }
  } else {
    subject = `ip:${getClientIp(request)}`
  }

  const windowStart = currentWindowStart()
  const reset = Math.floor((windowStart.getTime() + WINDOW_MS) / 1000)
  const retryAfterSeconds = Math.max(1, reset - Math.floor(Date.now() / 1000))

  let count: number
  try {
    const [row] = await sql<Array<{ consume_rate_limit: number }>>`
      select consume_rate_limit(${subject}, ${windowStart}) as consume_rate_limit
    `
    count = row?.consume_rate_limit ?? 1
  } catch {
    // Fail open. A rate limiter that 500s takes the whole public API down with
    // it, which is a worse outcome than briefly not enforcing the cap.
    return { allowed: true, limit, remaining: limit, reset, retryAfterSeconds, subject }
  }

  return {
    allowed: count <= limit,
    limit,
    remaining: Math.max(0, limit - count),
    reset,
    retryAfterSeconds,
    subject,
  }
}

export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    'x-ratelimit-limit': String(result.limit),
    'x-ratelimit-remaining': String(result.remaining),
    'x-ratelimit-reset': String(result.reset),
  }
}

/**
 * Delete counters from windows that have already elapsed. Called opportunistically
 * by the cron job so the table doesn't grow without bound.
 */
export async function pruneRateLimitWindows(): Promise<number> {
  const rows = await sql<Array<{ subject: string }>>`
    delete from api_rate_limits
     where window_start < now() - interval '2 hours'
    returning subject
  `
  return rows.length
}
