/** Time each page-level query against the selected database. */
import { describeDatabase, loadEnv, resolveDatabaseUrl } from './load-env.ts'

loadEnv()
const { url } = resolveDatabaseUrl()
if (!url) { console.error('no database url'); process.exit(1) }
process.env.DATABASE_URL = url
console.log(`Target: ${describeDatabase(url)}\n`)

const q = await import('../src/lib/queries.ts')

async function time(label: string, fn: () => Promise<unknown>) {
  const t = Date.now()
  try {
    const r = await fn()
    const n = Array.isArray(r) ? r.length : r instanceof Map ? r.size : 1
    console.log(`  ${String(Date.now() - t).padStart(6)}ms  ${label.padEnd(34)} rows=${n}`)
  } catch (e) {
    console.log(`  ${String(Date.now() - t).padStart(6)}ms  ${label.padEnd(34)} ERROR ${e instanceof Error ? e.message : e}`)
  }
}

await time('getProviders()', () => q.getProviders())
await time('getLastUpdated()', () => q.getLastUpdated())
await time('getProviderModels(openai)', () => q.getProviderModels('openai'))
await time('getAllModelRefs()', () => q.getAllModelRefs())
await time('getModelForProvider(openai,...)', () => q.getModelForProvider('openai', 'gpt-5.6-sol'))
await time('getHistory(gpt-5.6-sol)', () => q.getHistory('gpt-5.6-sol', 12))
await time('getPriceTrends()', () => q.getPriceTrends())
await time('getPrices(limit 500)', () => q.getPrices({ limit: 500, offset: 0, sort: 'input', direction: 'asc' }))

const { closeDb } = await import('../src/lib/db.ts')
await closeDb()
