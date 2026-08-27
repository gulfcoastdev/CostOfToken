import { sendAlert } from '@/lib/alert.ts'
import { sql } from '@/lib/db.ts'

/**
 * Rework notifications (012): when the recovery judge ran, someone owes
 * this provider a parser. The operator chose email as the channel (the
 * Resend sender already configured for run alerts), deduplicated so a
 * parser broken for a week sends one notice, not seven. GitHub issue
 * filing (createGitHubPoster below) is built and tested but deliberately
 * unwired — see BACKLOG "GitHub issue filing for source rework".
 */

export interface ReworkReport {
  structure: string
  changeAccount: string
  modelsDerived: number
  confidence: string
}

/** Injected for tests; production posts to the GitHub REST API. */
export type IssuePoster = (title: string, body: string) => Promise<boolean>

const DEDUP_DAYS = 7

export function createGitHubPoster(): IssuePoster | null {
  const token = process.env.GITHUB_TOKEN
  if (!token) return null
  const repo = process.env.GITHUB_REPO || 'gulfcoastdev/CostOfToken'

  return async (title, body) => {
    const response = await fetch(`https://api.github.com/repos/${repo}/issues`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'content-type': 'application/json',
      },
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({ title, body, labels: ['source-rework'] }),
    })
    return response.ok
  }
}

/** Emails the rework report to the operator's alert address. */
export function createEmailPoster(): IssuePoster | null {
  // sendAlert itself reports 'not configured'; probing env here keeps the
  // unconfigured case on the cheap 'noted' path without a network call.
  if (!process.env.RESEND_API_KEY || !process.env.ALERT_EMAIL_TO) return null
  return async (title, body) => {
    const result = await sendAlert({ subject: `[CostOfToken] ${title}`, body })
    return result.sent
  }
}

export type NotifyOutcome = 'sent' | 'deduped' | 'noted' | 'failed'

/**
 * File the rework notification for one provider, respecting the dedup
 * window recorded on the structure memo. Never throws.
 */
export async function notifyRework(
  providerSlug: string,
  report: ReworkReport,
  poster: IssuePoster | null,
): Promise<NotifyOutcome> {
  try {
    const rows = await sql<Array<{ recent: boolean }>>`
      select last_notified_at > now() - make_interval(days => ${DEDUP_DAYS}) as recent
        from source_structures where provider_slug = ${providerSlug}
    `
    if (rows[0]?.recent) return 'deduped'

    if (!poster) return 'noted'

    const title = `${providerSlug}: pricing source changed — parser needs rework`
    const body = [
      `The deterministic parser for **${providerSlug}** failed and the LLM recovery judge ran.`,
      '',
      `**What changed:** ${report.changeAccount || 'not stated'}`,
      '',
      `**Current structure (judge-written):**`,
      report.structure,
      '',
      `**Recovery result:** ${report.modelsDerived} model(s) derived at ${report.confidence} confidence.`,
      report.modelsDerived > 0
        ? 'Derived prices are live with `llm` provenance until the parser is fixed.'
        : 'Nothing was written; the provider is frozen at last known-good prices.',
      '',
      '_Sent automatically by the source-recovery judge (spec 012)._',
    ].join('\n')

    const ok = await poster(title, body)
    if (!ok) return 'failed'

    await sql`
      update source_structures set last_notified_at = now()
       where provider_slug = ${providerSlug}
    `
    return 'sent'
  } catch {
    return 'failed'
  }
}
