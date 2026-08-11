import postgres from 'postgres'
import { env } from './env.ts'

declare global {
  // eslint-disable-next-line no-var
  var __costOfTokenSql: postgres.Sql | undefined
}

/**
 * Single postgres.js client, cached on globalThis so Next's dev-mode module
 * reloading and Vercel's warm lambdas don't open a new pool per invocation.
 *
 * `prepare: false` is required: Supabase's transaction pooler (port 6543)
 * multiplexes connections and cannot support session-scoped prepared
 * statements. Without it, queries fail intermittently under concurrency.
 */
function createClient(): postgres.Sql {
  return postgres(env.databaseUrl, {
    prepare: false,
    /**
     * One connection per process.
     *
     * This is the fix for a failure that looked like several different bugs: a
     * build where every data-backed page hung past 60 seconds, and a runtime
     * where each successive request to a database-reading page took longer
     * than the last until it timed out — 1.4s, then 7s, then 16s, then nothing.
     *
     * Both are the same thing. Supabase's pooler allows a limited number of
     * connections; a serverless instance handles one request at a time, so any
     * pool larger than one just multiplies that instance's claim on the
     * allowance by the number of instances. Once the allowance is gone, new
     * connections wait rather than fail, which reads as a hang.
     */
    max: 1,
    // Release the slot back to the pooler promptly between invocations.
    idle_timeout: 10,
    connect_timeout: 8,
    // numeric(12,6) arrives as a string by default to avoid float precision
    // loss. Prices are small enough that a JS number is exact here, and the
    // API contract says these are numbers.
    types: {
      numeric: {
        to: 0,
        from: [1700],
        serialize: (x: number | string) => String(x),
        parse: (x: string) => Number.parseFloat(x),
      },
    },
  })
}

function getClient(): postgres.Sql {
  if (!globalThis.__costOfTokenSql) {
    globalThis.__costOfTokenSql = createClient()
  }
  return globalThis.__costOfTokenSql
}

/**
 * Lazily-connected client.
 *
 * Connection setup is deferred to first use rather than happening at import
 * time, so code paths that never touch the database — a `--dry-run` pipeline,
 * a unit test of the normalizer — don't require DATABASE_URL to be set just to
 * import a module that transitively pulls this in.
 */
export const sql: postgres.Sql = new Proxy(function noop() {} as unknown as postgres.Sql, {
  apply(_target, _thisArg, args: unknown[]) {
    return (getClient() as unknown as (...a: unknown[]) => unknown)(...args)
  },
  get(_target, property, receiver) {
    const client = getClient() as unknown as Record<string | symbol, unknown>
    const value = Reflect.get(client, property, receiver)
    return typeof value === 'function' ? value.bind(client) : value
  },
  has(_target, property) {
    return property in (getClient() as unknown as object)
  },
})

/** Close the pool. For CLI scripts; serverless should let the pool persist. */
export async function closeDb(): Promise<void> {
  if (globalThis.__costOfTokenSql) {
    await globalThis.__costOfTokenSql.end()
    globalThis.__costOfTokenSql = undefined
  }
}
