import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'

/**
 * TEMPORARY. Delete once the cron secret mismatch is resolved.
 *
 * Reports a non-reversible fingerprint of the deployment's CRON_SECRET so it
 * can be compared against a local copy without either being transmitted. Twelve
 * hex characters of a SHA-256 is not reversible and is useless on its own.
 *
 * Length is included because it separates the three failure modes at a glance:
 * absent, present-but-different, and present-with-quotes-included.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function GET(): NextResponse {
  const secret = process.env.CRON_SECRET

  return NextResponse.json(
    {
      set: typeof secret === 'string' && secret.length > 0,
      length: secret?.length ?? 0,
      startsWithQuote: secret?.startsWith('"') ?? false,
      hasWhitespace: secret ? /\s/.test(secret) : false,
      sha12: secret ? createHash('sha256').update(secret).digest('hex').slice(0, 12) : null,
    },
    { headers: { 'cache-control': 'no-store' } },
  )
}
