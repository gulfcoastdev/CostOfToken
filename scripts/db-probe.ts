/**
 * Diagnose database reachability from wherever the build runs.
 *
 * Always exits 0 — this reports, it never blocks a deploy. It exists because
 * production builds were failing with pages hanging for 60 seconds against a
 * database that answers in under a second at runtime, and guessing at the
 * cause cost more than measuring it would have.
 */
import { lookup, resolve4, resolve6 } from 'node:dns/promises'
import { connect } from 'node:net'

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

process.exit(0)
