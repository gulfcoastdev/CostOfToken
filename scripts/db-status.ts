/**
 * Print which database the current environment points at, and what is in it.
 *
 *   npm run db:status
 */
import postgres from 'postgres'
import { describeDatabase, loadEnv } from './load-env.ts'

loadEnv()

const url =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_PRISMA_URL ||
  process.env.SUPABASE_DB_URL

if (!url) {
  console.error('No database URL set.')
  process.exit(1)
}

console.log(`Target: ${describeDatabase(url)}`)

const sql = postgres(url, { prepare: false, max: 1, connect_timeout: 15, onnotice: () => {} })

try {
  const [version] = await sql<Array<{ v: string }>>`select version() as v`
  const [tables] = await sql<Array<{ n: number }>>`
    select count(*)::int as n from information_schema.tables where table_schema = 'public'
  `
  const [models] = await sql<Array<{ n: number }>>`select count(*)::int as n from models`
  const [prices] = await sql<Array<{ n: number }>>`select count(*)::int as n from prices`
  const [history] = await sql<Array<{ n: number }>>`select count(*)::int as n from price_history`

  console.log(`  server  : ${version.v.split(' ').slice(0, 2).join(' ')}`)
  console.log(`  tables  : ${tables.n}`)
  console.log(`  models  : ${models.n}`)
  console.log(`  prices  : ${prices.n}`)
  console.log(`  history : ${history.n}`)
} catch (error) {
  console.error('Query failed:', error instanceof Error ? error.message : error)
  process.exitCode = 1
} finally {
  await sql.end()
}
