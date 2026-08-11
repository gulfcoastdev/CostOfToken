/**
 * Run the extraction pipeline from the command line.
 *
 *   npm run pipeline:dry                  # extract + validate, write nothing
 *   npm run pipeline:run                  # extract and persist
 *   npm run pipeline:dry -- --only=xai,openai
 */
import { loadEnv } from './load-env.ts'

loadEnv()

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const force = args.includes('--force')
const onlyArg = args.find((a) => a.startsWith('--only='))
const only = onlyArg
  ? onlyArg
      .slice('--only='.length)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  : undefined

if (!dryRun && !process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Use --dry-run to extract without writing.')
  process.exit(1)
}

const { runPipeline } = await import('../src/pipeline/run.ts')

const summary = await runPipeline({ dryRun, only, force })

const pad = (value: string | number, width: number) => String(value).padEnd(width)
console.log(
  `\n${pad('PROVIDER', 12)} ${pad('STATUS', 9)} ${pad('SOURCE', 8)} ${pad('MODELS', 7)} ${pad('CHANGED', 8)} TIME`,
)
console.log('-'.repeat(72))
for (const p of summary.providers) {
  console.log(
    `${pad(p.provider, 12)} ${pad(p.status, 9)} ${pad(p.sourceKind, 8)} ${pad(p.modelsFound, 7)} ${pad(
      p.modelsChanged,
      8,
    )} ${p.durationMs}ms`,
  )
  if (p.error) console.log(`  error: ${p.error}`)
  for (const anomaly of p.anomalies ?? []) {
    console.log(`  ${anomaly.severity === 'block' ? 'BLOCK' : 'warn '} ${anomaly.code}: ${anomaly.message}`)
  }
  if (p.rejections?.length) {
    for (const rejection of p.rejections) console.log(`  rejected: ${rejection}`)
  }
}
console.log('-'.repeat(72))
console.log(
  `${summary.totalModels} models, ${summary.totalChanged} price changes, ${summary.durationMs}ms${
    summary.dryRun ? ' (dry run — nothing written)' : ''
  }\n`,
)

if (summary.blocked > 0) {
  console.error(
    `${summary.blocked} provider(s) blocked by anomaly detection — previous prices kept.\n` +
      'Review the findings above. If the change is genuine, re-run with --force.',
  )
  process.exit(2)
}
if (!summary.ok) {
  console.error('All providers failed.')
  process.exit(1)
}
process.exit(0)
