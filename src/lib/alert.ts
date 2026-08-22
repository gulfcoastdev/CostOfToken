import type { RunSummary } from '@/pipeline/run.ts'

/**
 * Tell a human when a collection run found something worth a second look.
 *
 * Bulk plausibility checking already existed and already blocked correctly.
 * What it never did was say so: a finding was recorded and then sat there.
 * Two faults reached readers this fortnight — one provider published at eight
 * times its real price for eleven days, and a model was recorded at half its
 * price nine hours after being catalogued — and in both cases the system
 * behaved as though nothing had happened.
 *
 * Deliberately small. One message per run, derived entirely from the run
 * summary, nothing stored, no deduplication, no history. If the same flag
 * appears on consecutive runs the operator sees it twice; suppressing that
 * needs state, and state is what would turn this into a system.
 */

export interface Alert {
  subject: string
  body: string
}

/**
 * Whether this run is worth an email.
 *
 * Warnings alone count. An earlier draft stayed quiet unless something
 * blocked, on the reasoning that a warning should not wake anyone — but the
 * operator's instruction was the opposite, and it is the right call here:
 * "model changes happen. Just monitor them and let me know." The system does
 * not decide which price changes are wrong; it reports and a human judges.
 */
export function shouldAlert(summary: RunSummary): boolean {
  if (!summary.ok) return true
  if (summary.blocked > 0) return true
  return summary.providers.some(
    (p) => p.status === 'failed' || p.status === 'blocked' || (p.anomalies?.length ?? 0) > 0,
  )
}

/** Findings listed per provider before the message says "and N more". */
const MAX_MODELS_LISTED = 8

/**
 * Anything echoed from a run can carry a connection string, because a driver
 * error message includes the URL it failed to reach. Redact before rendering,
 * not after — the message is an outbound surface and Principle VII applies to
 * it exactly as it does to the feed.
 */
function redact(text: string): string {
  return text
    .replace(/\b[a-z]+:\/\/[^\s]*/gi, '[redacted-url]')
    .replace(/\b[\w.-]+\.(supabase|amazonaws|vercel)\.\w+(:\d+)?\b/gi, '[redacted-host]')
    .replace(/\b(password|secret|key|token)\s*[=:]\s*\S+/gi, '$1=[redacted]')
}

/** Vendor-scraped text is hostile: strip markup and cap length. */
function clean(text: string, max = 300): string {
  const stripped = redact(String(text))
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return stripped.length > max ? `${stripped.slice(0, max)}…` : stripped
}

interface FlaggedModel {
  modelId?: string
  before?: number | null
  after?: number | null
  hours?: number
  ratio?: number | null
}

/** Build the message. Pure — no configuration reaches it, so nothing can leak. */
export function buildAlert(summary: RunSummary): Alert {
  const failed = summary.providers.filter((p) => p.status === 'failed')
  const blocked = summary.providers.filter((p) => p.status === 'blocked')
  const flagged = summary.providers.filter(
    (p) => p.status !== 'blocked' && (p.anomalies?.length ?? 0) > 0,
  )

  const headline = !summary.ok
    ? 'run failed'
    : blocked.length > 0
      ? `${blocked.length} provider${blocked.length === 1 ? '' : 's'} blocked`
      : failed.length > 0
        ? `${failed.length} provider${failed.length === 1 ? '' : 's'} failed`
        : 'prices flagged for review'

  const lines: string[] = [
    `CostOfToken price run — ${headline}`,
    '',
    `Run ${summary.runId} finished ${summary.finishedAt} in ${Math.round(summary.durationMs / 1000)}s.`,
    `${summary.totalModels} models, ${summary.totalChanged} price changes.`,
    '',
  ]

  for (const group of [
    { label: 'BLOCKED — nothing written, last known-good prices kept', items: blocked },
    { label: 'FAILED', items: failed },
    { label: 'FLAGGED — written, worth a look', items: flagged },
  ]) {
    if (group.items.length === 0) continue
    lines.push(group.label, '')

    for (const p of group.items) {
      lines.push(`  ${p.provider} (${p.modelsFound} models, ${p.modelsChanged} changed)`)
      if (p.error) lines.push(`    error: ${clean(p.error)}`)

      for (const anomaly of p.anomalies ?? []) {
        lines.push(`    [${anomaly.severity}] ${anomaly.code}: ${clean(anomaly.message)}`)

        const models = (anomaly.details as { models?: FlaggedModel[] })?.models
        if (!Array.isArray(models)) continue

        for (const m of models.slice(0, MAX_MODELS_LISTED)) {
          const ratio = typeof m.ratio === 'number' ? ` (${m.ratio}x)` : ''
          const when = typeof m.hours === 'number' ? ` after ${m.hours}h` : ''
          // An exact commercial multiple is the fingerprint of a tier or
          // parser fault rather than a repricing — worth pointing at.
          const suspicious = m.ratio === 0.5 || m.ratio === 2 || m.ratio === 0.25 || m.ratio === 4
          const note = suspicious ? '  <- exact multiple, check the parser' : ''
          lines.push(`      ${clean(String(m.modelId), 60)}: ${m.before} -> ${m.after}${ratio}${when}${note}`)
        }
        if (models.length > MAX_MODELS_LISTED) {
          lines.push(`      … and ${models.length - MAX_MODELS_LISTED} more not listed`)
        }
      }
      lines.push('')
    }
  }

  lines.push('A blocked provider keeps its previous prices. Re-run with force=true to accept.')

  return { subject: `[CostOfToken] ${headline}`, body: lines.join('\n') }
}

export interface SendResult {
  sent: boolean
  reason?: string
}

/**
 * Send via Resend's HTTP API.
 *
 * `fetch` rather than the SDK: Principle V asks that a dependency be justified
 * against the simplest correct alternative, and one JSON POST is it.
 *
 * Absent configuration this does nothing and says so, so a fresh clone and
 * every local run stay silent without a flag to remember.
 */
export async function sendAlert(alert: Alert): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY
  const to = process.env.ALERT_EMAIL_TO
  const from = process.env.ALERT_EMAIL_FROM ?? 'alerts@costoftoken.com'

  if (!apiKey || !to) return { sent: false, reason: 'not configured' }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject: alert.subject, text: alert.body }),
  })

  if (!response.ok) return { sent: false, reason: `resend returned ${response.status}` }
  return { sent: true }
}
