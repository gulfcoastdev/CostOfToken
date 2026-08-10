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

export const env = {
  get databaseUrl(): string {
    return required('DATABASE_URL')
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
