/**
 * Apply db/schema.sql to the database in DATABASE_URL.
 *
 * The schema is idempotent, so this is safe to re-run after edits.
 *   npm run db:push
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import postgres from 'postgres'
import { describeDatabase, loadEnv, resolveDatabaseUrl } from './load-env.ts'

loadEnv()

const { url, remote } = resolveDatabaseUrl()
if (!url) {
  console.error(
    remote
      ? 'No remote database URL set. Add SUPABASE_DB_URL to .env.local.'
      : 'No DATABASE_URL set. Copy .env.example to .env.local and fill it in.',
  )
  process.exit(1)
}

console.log(`Applying schema to: ${describeDatabase(url)}`)

const schemaPath = resolve(process.cwd(), 'db/schema.sql')
const schema = readFileSync(schemaPath, 'utf8')

// The migration runs DDL and creates functions containing semicolons, so it is
// sent as one script rather than split on ';'. `simple: true` allows multiple
// statements in a single round trip.
// `drop ... if exists` emits NOTICEs on a fresh database; they're expected.
const sql = postgres(url, { prepare: false, max: 1, connect_timeout: 15, onnotice: () => {} })

try {
  await sql.unsafe(schema).simple()
  console.log(`Applied ${schemaPath}`)

  const [{ count }] = await sql<Array<{ count: string }>>`
    select count(*) as count from information_schema.tables
     where table_schema = 'public'
       and table_name in ('providers','models','prices','price_history','api_keys','api_rate_limits','extraction_runs')
  `
  console.log(`Verified ${count}/7 tables present.`)
} catch (error) {
  console.error('Schema push failed:', error instanceof Error ? error.message : error)
  process.exitCode = 1
} finally {
  await sql.end()
}
