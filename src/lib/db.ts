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
/**
 * Connection options, exported so they can be asserted in tests.
 *
 * A timing test cannot catch a pool that is too small: against a local
 * database every query is fast enough that even fully serialised reads finish
 * instantly. The fault only appeared with remote latency and parallel renders.
 * So the configuration itself is the thing worth guarding.
 */
export const POOL_OPTIONS = {
  max: 10,
  idle_timeout: 0,
  connect_timeout: 8,
} as const

function createClient(): postgres.Sql {
  return postgres(env.databaseUrl, {
    prepare: false,
    /**
     * Pool size matters more than it looks.
     *
     * This was set to 1 on the theory that a serverless instance handles one
     * request at a time, so a bigger pool only multiplies the claim on
     * Supabase's allowance. That reasoning was wrong twice over: the database
     * was never near its limit (12 of 60 connections in use while pages were
     * timing out), and a single connection serialises every concurrent render.
     * `next build` renders many pages at once and Next serves concurrent
     * requests from one instance, so with one connection the queue never
     * drained — queries completed, then later ones waited past the 60 second
     * page timeout and the build failed.
     */
    max: POOL_OPTIONS.max,
    // Never close idle connections. Reconnecting mid-build was part of the
    // same stall; the pooler reclaims genuinely dead sockets on its own.
    idle_timeout: POOL_OPTIONS.idle_timeout,
    connect_timeout: POOL_OPTIONS.connect_timeout,
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
