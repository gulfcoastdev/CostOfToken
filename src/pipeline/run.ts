import { randomUUID } from 'node:crypto'
import type { NormalizedModel } from '@/lib/types.ts'
import { type Anomaly, detectAnomalies, hasBlocking } from './anomaly.ts'
import { arbitrate, createOpenAIJudge, diffChanges, PAGE_TEXT_CHARS, type Judge } from './arbiter.ts'
import { enrichModels } from './enrich.ts'
import { getExtractors } from './extractors/index.ts'
import { resetOpenRouterCache } from './extractors/openrouter.ts'
import type { ExtractorContext } from './extractors/types.ts'
import { fetchText } from './http.ts'
import { validateModel } from './normalize.ts'
import {
  canonicalIdsForProvider,
  cheapestByCanonical,
  detectCheapestFlips,
  detectOfferEvents,
  recordMonitoringEvents,
} from './monitor.ts'
import { resolveProviderOffers } from './resolve.ts'
import {
  deactivateMissingModels,
  ensureProviders,
  getProviderBaseline,
  logExtractionRun,
  upsertProviderModels,
} from './upsert.ts'

export interface ProviderResult {
  provider: string
  status: 'ok' | 'partial' | 'failed' | 'skipped' | 'blocked'
  sourceKind: string
  modelsFound: number
  modelsRejected: number
  modelsChanged: number
  durationMs: number
  error?: string
  rejections?: string[]
  anomalies?: Anomaly[]
  /** 011: canonical-identity linking outcome for this provider's offers. */
  resolution?: { linked: number; unresolved: number }
  /** 011: monitoring events written for this provider this run. */
  eventsRecorded?: number
}

export interface RunSummary {
  runId: string
  startedAt: string
  finishedAt: string
  durationMs: number
  dryRun: boolean
  providers: ProviderResult[]
  totalModels: number
  totalChanged: number
  ok: boolean
  /** Providers whose results were rejected by anomaly detection. */
  blocked: number
}

export interface RunOptions {
  /** Restrict the run to these provider slugs. */
  only?: string[]
  /** Extract and validate but write nothing. */
  dryRun?: boolean
  /** Injected for tests. */
  ctx?: ExtractorContext
  /**
   * Write even when anomaly detection blocks. For when a flagged change is
   * genuinely real — a vendor really did halve its prices.
   */
  force?: boolean
  /**
   * Builds the arbiter's judge (010). Injected for tests; production uses
   * createOpenAIJudge, which returns null without an OPENAI_API_KEY so
   * the feature is simply off.
   */
  judgeFactory?: () => Judge | null
}

const defaultContext: ExtractorContext = {
  fetchText: (url, init) => fetchText(url, { headers: init?.headers }),
}

/**
 * Run the daily extraction.
 *
 * Every provider is isolated: an extractor that throws, times out, or returns
 * nothing marks only its own provider failed and leaves that provider's last
 * known prices in place. Yesterday's price is far more useful than a gap, and
 * silently replacing good data with nulls is the worst outcome — so a failed
 * provider writes no rows at all.
 */
export async function runPipeline(options: RunOptions = {}): Promise<RunSummary> {
  const {
    only,
    dryRun = false,
    ctx = defaultContext,
    force = false,
    judgeFactory = createOpenAIJudge,
  } = options
  const judge = judgeFactory()

  const runId = randomUUID()
  const startedAt = new Date()
  resetOpenRouterCache()

  const extractors = getExtractors(only)
  const providerIds = dryRun ? new Map<string, string>() : await ensureProviders()
  const results: ProviderResult[] = []

  // Sequential on purpose: a handful of providers per day is not worth the
  // risk of hammering vendor docs sites in parallel from one IP.
  for (const extractor of extractors) {
    const providerStart = Date.now()
    const base: ProviderResult = {
      provider: extractor.providerSlug,
      status: 'failed',
      sourceKind: extractor.sourceKind,
      modelsFound: 0,
      modelsRejected: 0,
      modelsChanged: 0,
      durationMs: 0,
    }

    // Remember the last body this extractor fetched (bounded) so the arbiter
    // can see the page the parser read, without re-fetching or persisting it.
    // Extraction only — enrichment fetches other pages and must not clobber it.
    let lastFetched = ''
    const rememberingCtx: ExtractorContext = {
      fetchText: async (url, init) => {
        const text = await ctx.fetchText(url, init)
        lastFetched = text.slice(0, PAGE_TEXT_CHARS)
        return text
      },
    }

    try {
      const raw = await extractor.extract(rememberingCtx)

      if (raw.length === 0) {
        // An empty result is indistinguishable from a layout change that broke
        // the parser, so it is treated as a failure, not an empty catalogue.
        throw new Error('extractor returned no models (source layout may have changed)')
      }

      const { models: enriched } = await enrichModels(raw, ctx)

      const valid: NormalizedModel[] = []
      const rejections: string[] = []
      for (const model of enriched) {
        const check = validateModel(model)
        if (check.ok) valid.push(model)
        else rejections.push(`${model.modelId}: ${check.reason}`)
      }

      base.modelsFound = valid.length
      base.modelsRejected = rejections.length
      if (rejections.length > 0) base.rejections = rejections.slice(0, 10)

      if (valid.length === 0) {
        throw new Error(`all ${rejections.length} extracted models failed validation`)
      }

      if (!dryRun) {
        const providerId = providerIds.get(extractor.providerSlug)
        if (!providerId) throw new Error(`provider ${extractor.providerSlug} is not registered`)

        // Compare against what's already stored before overwriting it. This is
        // the only place a silent scraper failure is detectable: each
        // individual price looks plausible, and only the shape of the change
        // across the whole provider gives it away.
        const baseline = await getProviderBaseline(providerId)
        const anomalies = detectAnomalies(baseline, valid)
        if (anomalies.length > 0) base.anomalies = anomalies

        if (hasBlocking(anomalies) && !force) {
          // Keep the last known-good prices rather than publishing a result we
          // have concrete reason to distrust. Re-run with force to override.
          base.status = 'blocked'
          base.error = anomalies
            .filter((a) => a.severity === 'block')
            .map((a) => a.message)
            .join(' ')
        } else {
          // 010: judge the changes this write would make before making it.
          // Verdicts arrive as anomalies (rendered by the existing alert);
          // held models keep their stored prices via the upsert filter. An
          // unavailable arbiter degrades to a note — never to a failed run.
          const changes = diffChanges(baseline, valid)
          let holds: ReadonlySet<string> = new Set<string>()
          if (changes.length > 0) {
            const outcome = await arbitrate(changes, judge, lastFetched || null)
            holds = outcome.holds
            if (outcome.anomalies.length > 0) {
              base.anomalies = [...(base.anomalies ?? []), ...outcome.anomalies]
            }
          }

          // 011: capture cheapest-per-canonical before the write, so a flip
          // can be detected against it afterwards. Monitoring must never
          // fail a run that produced good prices.
          let cheapestBefore: Awaited<ReturnType<typeof cheapestByCanonical>> = []
          try {
            cheapestBefore = await cheapestByCanonical(await canonicalIdsForProvider(providerId))
          } catch {
            // Flip detection is skipped this run; offer events still record.
          }

          const { pricesChanged } = await upsertProviderModels(providerId, valid, holds)
          base.modelsChanged = pricesChanged
          await deactivateMissingModels(
            providerId,
            valid.map((m) => m.modelId),
          )

          // 011: link this provider's offers to canonical models. Also the
          // backfill — pre-011 rows are just offers never linked. Resolution
          // failure must not fail a run that produced good prices.
          try {
            base.resolution = await resolveProviderOffers(providerId)
          } catch {
            // Reported by the unresolved-offers report, not by failing the run.
          }

          // 011: durable monitoring events — offer add/remove/change plus
          // cheapest-provider flips across this provider's canonicals.
          try {
            const offerEvents = detectOfferEvents(
              baseline,
              valid.map((m) => ({
                modelId: m.modelId,
                inputPrice: m.pricing.inputPrice,
                cachedInputPrice: m.pricing.cachedInputPrice,
                outputPrice: m.pricing.outputPrice,
              })),
              holds,
            )
            const cheapestAfter = await cheapestByCanonical(
              await canonicalIdsForProvider(providerId),
            )
            const flips = detectCheapestFlips(cheapestBefore, cheapestAfter)
            base.eventsRecorded = await recordMonitoringEvents(runId, providerId, [
              ...offerEvents,
              ...flips,
            ])
          } catch {
            // A lost event is recoverable from history; a failed run is worse.
          }

          base.status = rejections.length > 0 ? 'partial' : 'ok'
        }
      } else {
        base.status = rejections.length > 0 ? 'partial' : 'ok'
      }
    } catch (error) {
      base.status = 'failed'
      base.error = error instanceof Error ? error.message : String(error)
    }

    base.durationMs = Date.now() - providerStart
    results.push(base)

    if (!dryRun) {
      try {
        await logExtractionRun({
          runId,
          providerSlug: base.provider,
          status: base.status,
          sourceKind: base.sourceKind,
          modelsFound: base.modelsFound,
          modelsChanged: base.modelsChanged,
          durationMs: base.durationMs,
          error: base.error ?? null,
          anomalies: base.anomalies,
        })
      } catch {
        // Never let logging failure mask a successful extraction.
      }
    }
  }

  const finishedAt = new Date()

  return {
    runId,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    dryRun,
    providers: results,
    totalModels: results.reduce((sum, r) => sum + r.modelsFound, 0),
    totalChanged: results.reduce((sum, r) => sum + r.modelsChanged, 0),
    ok: results.some((r) => r.status === 'ok' || r.status === 'partial'),
    blocked: results.filter((r) => r.status === 'blocked').length,
  }
}
