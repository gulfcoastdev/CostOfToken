/**
 * Diagnose database reachability from wherever the build runs, and refuse to
 * build code whose columns the database does not have.
 *
 * The reachability half never blocks a deploy. It exists because production
 * builds were failing with pages hanging for 60 seconds against a database that
 * answers in under a second at runtime, and guessing at the cause cost more
 * than measuring it would have. A build host that cannot see the database is
 * a fact about the build host, not a reason to stop shipping.
 *
 * The schema half does block, and the distinction between the two is the whole
 * point: **"I could not check" is not "I checked and it is fine."** Only a
 * successful query that comes back missing a required column fails this script.
 * Everything else — no connection string, unresolvable host, refused socket,
 * query error — reports and exits 0, exactly as before.
 *
 * It blocks because of what happens otherwise. The classification code was
 * deployed while production still lacked its columns; `toPriceRow` coalesces a
 * missing column to null rather than erroring, so the site served 219 models
 * with `model_type: null`, the default filter matched none of them, and the
 * home page rendered "No models" for real users. Nothing failed loudly at any
 * point. A build that had simply asked "does `v_current_prices` have
 * `model_type`?" would have stopped it before anyone saw it.
 */
import { lookup, resolve4, resolve6 } from 'node:dns/promises'
import { connect } from 'node:net'
import postgres from 'postgres'
import { loadEnv } from './load-env.ts'

// Vercel injects the connection string into the environment, but a local
// `npm run build` gets nothing unless .env.local is read — so without this the
// schema gate silently checked nothing on the one machine where a developer
// could still fix the migration before pushing it.
loadEnv()

/**
 * Columns the application reads that a migration must have added first.
 *
 * Add to this whenever code starts depending on a new column — that is the
 * step which, skipped, produces the outage described above. It deliberately
 * does not list every column in the schema: an exhaustive mirror drifts, stops
 * being trusted, and gets deleted. These are the ones whose absence is silent
 * rather than loud.
 */
const REQUIRED_COLUMNS: Record<string, string[]> = {
  v_current_prices: ['model_type', 'classification_status', 'capabilities'],
}

const url =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_PRISMA_URL ||
  process.env.SUPABASE_DB_URL

console.log('[db-probe] DATABASE_URL present:', Boolean(process.env.DATABASE_URL))
console.log('[db-probe] any connection string:', Boolean(url))
if (!url) process.exit(0)

let host = ''
let port = 5432
try {
  const parsed = new URL(url)
  host = parsed.hostname
  port = Number(parsed.port || 5432)
  console.log(`[db-probe] target: ${host}:${port}`)
} catch (error) {
  console.log('[db-probe] connection string is not parseable:', String(error))
  process.exit(0)
}

async function timed<T>(label: string, fn: () => Promise<T>, ms = 8000): Promise<void> {
  const started = Date.now()
  try {
    const result = await Promise.race([
      fn(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timed out')), ms)),
    ])
    console.log(`[db-probe] ${label}: ok in ${Date.now() - started}ms`, JSON.stringify(result))
  } catch (error) {
    console.log(
      `[db-probe] ${label}: FAILED after ${Date.now() - started}ms —`,
      error instanceof Error ? error.message : String(error),
    )
  }
}

await timed('dns.lookup', () => lookup(host))
await timed('dns.resolve4', () => resolve4(host))
await timed('dns.resolve6', () => resolve6(host).catch(() => ['none']))

await timed(
  'tcp connect',
  () =>
    new Promise<string>((resolve, reject) => {
      const socket = connect({ host, port, timeout: 7000 })
      socket.on('connect', () => {
        socket.destroy()
        resolve('connected')
      })
      socket.on('timeout', () => {
        socket.destroy()
        reject(new Error('socket timeout'))
      })
      socket.on('error', (error) => reject(error))
    }),
)

/*
 * The schema gate.
 *
 * `missing` stays null unless a query actually succeeded, so an unreachable
 * database can never be mistaken for a mismatched one. Short timeouts
 * throughout: a build host that cannot connect should find that out in seconds
 * and move on, which is the behaviour this script was written for.
 */
let missing: string[] | null = null

try {
  const sql = postgres(url, {
    prepare: false,
    max: 1,
    connect_timeout: 8,
    idle_timeout: 5,
    onnotice: () => {},
  })

  try {
    const found: string[] = []
    for (const [relation, columns] of Object.entries(REQUIRED_COLUMNS)) {
      const rows = await sql<Array<{ column_name: string }>>`
        select column_name from information_schema.columns
         where table_schema = 'public' and table_name = ${relation}
      `
      // No rows means the relation itself is absent — a first deploy against an
      // empty database. Report it as missing columns rather than crashing, so
      // the message names the fix instead of the symptom.
      if (rows.length === 0) {
        found.push(`${relation} (relation does not exist)`)
        continue
      }
      const present = new Set(rows.map((row) => row.column_name))
      for (const column of columns) {
        if (!present.has(column)) found.push(`${relation}.${column}`)
      }
    }
    missing = found
  } finally {
    await sql.end({ timeout: 5 })
  }
} catch (error) {
  console.log(
    '[db-probe] schema check: could not run —',
    error instanceof Error ? error.message : String(error),
  )
  console.log('[db-probe] schema check: SKIPPED (not treated as a failure)')
}

if (missing === null) {
  process.exit(0)
}

if (missing.length > 0) {
  console.error('\n[db-probe] schema check: FAILED — the database is missing:')
  for (const item of missing) console.error(`  - ${item}`)
  console.error(
    '\nThe deployed code reads these. Without them every row comes back null,\n' +
      'which the UI cannot tell apart from genuinely absent data — that is how\n' +
      'a site with a full catalogue renders an empty table.\n\n' +
      'Apply the migration first, then build:\n' +
      '  npm run db:push -- --remote   # production\n' +
      '  npm run db:push               # local\n',
  )
  process.exit(1)
}

console.log('[db-probe] schema check: ok — all required columns present')
process.exit(0)
