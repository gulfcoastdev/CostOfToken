/**
 * Environment access. Values are read lazily so that importing a module in a
 * context that doesn't need the database (e.g. a unit test of the normalizer)
 * doesn't blow up on a missing DATABASE_URL.
 */

function required(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. Copy .env.example to .env.local and fill it in.`,
    )
  }
  return value
}

/**
 * Connection-string variables, in priority order.
 *
 * `DATABASE_URL` is what this project documents. The rest are what the Vercel
 * Supabase integration injects automatically when you add Supabase from the
 * Vercel marketplace — supporting them means that path needs no manual env
 * configuration at all.
 *
 * `POSTGRES_URL_NON_POOLING` is deliberately excluded: it is the direct
 * connection, which Supabase serves over IPv6 only and which serverless
 * functions therefore cannot reach.
 */
const DATABASE_URL_VARS = [
  'DATABASE_URL',
  'POSTGRES_URL',
  'POSTGRES_PRISMA_URL',
  'SUPABASE_DB_URL',
] as const

export const env = {
  get databaseUrl(): string {
    for (const name of DATABASE_URL_VARS) {
      const value = process.env[name]
      if (value) return value
    }
    throw new Error(
      `No database connection string found. Set DATABASE_URL (or let the Vercel Supabase integration provide one of: ${DATABASE_URL_VARS.slice(
        1,
      ).join(', ')}). Copy .env.example to .env.local to get started.`,
    )
  },
  get cronSecret(): string {
    return required('CRON_SECRET')
  },
  get anonRateLimitPerHour(): number {
    const raw = process.env.RATE_LIMIT_ANON_PER_HOUR
    const parsed = raw ? Number.parseInt(raw, 10) : NaN
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 60
  },
  get xaiApiKey(): string | undefined {
    return process.env.XAI_API_KEY || undefined
  },
}
