import { timingSafeEqual } from 'node:crypto'
import { revalidatePath, revalidateTag } from 'next/cache'
import { buildAlert, sendAlert, shouldAlert } from '@/lib/alert.ts'
import type { RunSummary } from '@/pipeline/run.ts'
import { NextResponse } from 'next/server'
import { env } from '@/lib/env.ts'
import { pruneRateLimitWindows } from '@/lib/rate-limit.ts'
import { runPipeline } from '@/pipeline/run.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
/**
 * 60 was generous when ten providers finished in ~4s. The platform work
 * (013/014-era) made it the outage: OpenRouter's full catalogue, Together,
 * DeepInfra, canonical resolution, monitoring, and LLM judge calls that can
 * legitimately take up to 60s alone pushed a run to 1–4 minutes, so Vercel
 * killed the cron at 60s before it could log a single provider — prod
 * silently stopped updating on 2026-08-27. 300 is the ceiling Vercel's
 * Fluid compute allows on every plan today.
 *
 * Running out of time is survivable by design: providers are written one at
 * a time, so a truncated run leaves the ones already processed updated and
 * the rest on their last known-good prices until tomorrow.
 */
export const maxDuration = 300

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
/**
 * A stand-in run summary for `?test_alert=true`.
 *
 * Deliberately shaped like a real finding rather than "hello world", so the
 * test also shows what a genuine alert will look like in the inbox.
 */
function sampleSummary(): RunSummary {
  return {
    runId: 'test-alert',
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: 0,
    dryRun: true,
    totalModels: 0,
    totalChanged: 0,
    ok: true,
    blocked: 0,
    providers: [
      {
        provider: 'test',
        status: 'ok',
        sourceKind: 'test',
        modelsFound: 0,
        modelsRejected: 0,
        modelsChanged: 0,
        durationMs: 0,
        anomalies: [
          {
            code: 'unsettled_price',
            severity: 'warn',
            message:
              'This is a test alert. No pipeline ran and nothing was written. ' +
              'A real one looks like this.',
            details: {
              count: 1,
              exactMultiples: 1,
              models: [
                {
                  modelId: 'example-model',
                  before: 0.44,
                  after: 0.22,
                  hours: 9,
                  ratio: 0.5,
                  exactMultiple: true,
                },
              ],
            },
          },
        ],
      },
    ],
  }
}

async function handle(request: Request): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    return NextResponse.json(
      { error: { code: 'unauthorized', message: 'Invalid or missing cron secret.' } },
      { status: 401, headers: { 'cache-control': 'no-store' } },
    )
  }

  const params = new URL(request.url).searchParams

  // `?test_alert=true` proves the notification path end to end without running
  // the pipeline or writing anything. Configuring email means setting secrets
  // in a dashboard, and the only way to find out whether that worked used to
  // be waiting for a real fault. Authenticated like everything else here.
  if (params.get('test_alert') === 'true') {
    const result = await sendAlert(buildAlert(sampleSummary()))
    return NextResponse.json(
      { test: true, ...result },
      { status: result.sent ? 200 : 503, headers: { 'cache-control': 'no-store' } },
    )
  }
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
          // Drop cached query results first, or revalidated pages would
          // rebuild from the same stale data.
          revalidateTag('prices')
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

    // Tell a human. Best-effort for the same reason as the housekeeping
    // above: a notifier that can fail a good run is worse than no notifier.
    // Only from here, never from runPipeline — the CLI shares that code and
    // must stay silent.
    if (!summary.dryRun && shouldAlert(summary)) {
      try {
        const result = await sendAlert(buildAlert(summary))
        if (!result.sent) console.warn('price alert not sent:', result.reason)
      } catch (error) {
        console.error('price alert failed', error)
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
