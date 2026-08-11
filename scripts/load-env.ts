import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

/** Load .env.local then .env, matching Next's precedence, for standalone CLI scripts. */
export function loadEnv(): void {
  for (const file of ['.env.local', '.env']) {
    const path = resolve(process.cwd(), file)
    if (existsSync(path)) {
      try {
        process.loadEnvFile(path)
      } catch (error) {
        console.warn(`Could not read ${file}:`, error instanceof Error ? error.message : error)
      }
    }
  }
}

/**
 * Human-readable target for a connection string, with credentials stripped.
 *
 * Printed before any write so it is obvious which database is about to be
 * touched. `.env.local` normally points at a local container while production
 * lives in Vercel, but a one-off inline override is exactly the situation
 * where someone seeds the wrong database without noticing.
 */
export function describeDatabase(url: string): string {
  try {
    const parsed = new URL(url)
    const database = parsed.pathname.replace(/^\//, '') || 'postgres'
    const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(parsed.hostname)
    const label = isLocal ? 'LOCAL' : 'REMOTE'
    return `${label}  ${parsed.hostname}:${parsed.port || '5432'}/${database}`
  } catch {
    return 'unparseable connection string'
  }
}
