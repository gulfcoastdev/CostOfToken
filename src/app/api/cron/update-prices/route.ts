import { timingSafeEqual } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { env } from '@/lib/env.ts'
import { pruneRateLimitWindows } from '@/lib/rate-limit.ts'
import { runPipeline } from '@/pipeline/run.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
/**
 * Ten providers fetched sequentially complete in about 4 seconds, so 60 is
 * generous — and 60 is the ceiling on Vercel's Hobby plan, so this deploys
 * anywhere. Raise it if you add many more providers; paid plans allow more.
 *
 * Running out of time is survivable by design: providers are written one at a
 * time, so a truncated run leaves the ones already processed updated and the
 * rest on their last known-good prices until tomorrow.
 */
export const maxDuration = 60

/**
 * POST|GET /api/cron/update-prices
 *
 * Triggered daily by Vercel Cron, which sends `Authorization: Bearer $CRON_SECRET`.
 * Returns 200 with a per-provider report whenever at least one provider
 * succeeded — a single broken vendor page must not turn the whole job red.
 * Returns 502 if every provider failed, and 409 if any provider's result was
 * blocked by anomaly detection. Both are worth alerting on: 409 means the
 * scrape ran but produced something we have concrete reason to distrust, so
 * the previous prices were kept.
 */
async function handle(request: Request): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    return NextResponse.json(
      { error: { code: 'unauthorized', message: 'Invalid or missing cron secret.' } },
      { status: 401, headers: { 'cache-control': 'no-store' } },
    )
  }

  const params = new URL(request.url).searchParams
  const only = params
    .getAll('provider')
    .flatMap((v) => v.split(','))
    .map((v) => v.trim())
    .filter(Boolean)

  try {
    const summary = await runPipeline({
      only: only.length > 0 ? only : undefined,
      dryRun: params.get('dry_run') === 'true',
      // Opt-in override for when a flagged change is genuinely real.
      force: params.get('force') === 'true',
    })

    if (!summary.dryRun) {
      // Housekeeping is best-effort and must not fail the run.
      await pruneRateLimitWindows().catch(() => {})

      // Drop the cached pages so a price change is visible immediately.
      // Without this, pages keep serving the previous day's numbers until
      // their revalidate window elapses — up to an hour on model pages, which
      // is a long time for a site whose entire claim is up-to-date pricing.
      // The route-pattern form invalidates every instance of a dynamic route.
      if (summary.totalChanged > 0) {
        try {
          revalidatePath('/', 'page')
          revalidatePath('/providers/[slug]', 'page')
          revalidatePath('/models/[provider]/[model]', 'page')
          revalidatePath('/llms-full.txt')
          revalidatePath('/sitemap.xml')
        } catch (error) {
          // Never fail a good run because cache invalidation misbehaved.
          console.error('revalidate after price update failed', error)
        }
      }
    }

    // A blocked provider is a real alert: extraction worked, but the result
    // was rejected as untrustworthy and nothing was written. Surface it as a
    // failure status so monitoring notices, rather than burying it in the body.
    const status = !summary.ok ? 502 : summary.blocked > 0 ? 409 : 200

    return NextResponse.json(summary, {
      status,
      headers: { 'cache-control': 'no-store' },
    })
  } catch (error) {
    console.error('cron/update-prices failed', error)
    return NextResponse.json(
      {
        error: {
          code: 'pipeline_error',
          message: error instanceof Error ? error.message : String(error),
        },
      },
      { status: 500, headers: { 'cache-control': 'no-store' } },
    )
  }
}

/**
 * Constant-time comparison so the secret can't be recovered by timing the
 * endpoint. Length is compared first because timingSafeEqual throws on a
 * length mismatch.
 */
function isAuthorized(request: Request): boolean {
  const header = request.headers.get('authorization') ?? ''
  const presented = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : ''
  if (!presented) return false

  let expected: string
  try {
    expected = env.cronSecret
  } catch {
    // No secret configured — refuse rather than run unauthenticated.
    return false
  }

  const a = Buffer.from(presented)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export const GET = handle
export const POST = handle
