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

/**
 * Pick the database to act on.
 *
 * `DATABASE_URL` is the local development database and the default for every
 * command. The remote is held under a *different* name and only selected by an
 * explicit `--remote` flag, so no command can reach production by accident.
 *
 * Defining `DATABASE_URL` twice in one env file does not merge the two — the
 * last definition silently wins — so keeping the two under separate names is
 * what actually prevents the mix-up.
 */
export function resolveDatabaseUrl(argv: string[] = process.argv): {
  url: string | undefined
  remote: boolean
} {
  const remote = argv.includes('--remote')

  if (remote) {
    return {
      url:
        process.env.SUPABASE_DB_URL ||
        process.env.PRODUCTION_DATABASE_URL ||
        // Fall back to the injected names so this works on Vercel too.
        process.env.POSTGRES_URL ||
        process.env.POSTGRES_PRISMA_URL,
      remote,
    }
  }

  return {
    url:
      process.env.DATABASE_URL ||
      process.env.POSTGRES_URL ||
      process.env.POSTGRES_PRISMA_URL ||
      process.env.SUPABASE_DB_URL,
    remote,
  }
}
