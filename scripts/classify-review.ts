import { loadEnv } from './load-env.ts'

loadEnv()

/**
 * List the models the classifier declined to type.
 *
 * The rules refuse to guess: a name hint that the pricing shape does not
 * corroborate leaves the model untyped and flagged rather than assigned a
 * plausible answer. That is the design, not a gap — but it only works if the
 * flagged set is easy to work through, so this prints everything needed to
 * decide without reopening the vendor's page for most rows.
 *
 * Decisions go in data/overrides.ts, which the pipeline never overwrites.
 *
 *   npm run classify:review
 *   npm run classify:review -- --json
 */

interface ReviewRow {
  provider: string
  model_id: string
  display_name: string
  input_price: number | null
  output_price: number | null
  classification_note: string | null
  is_active: boolean
}

function formatPrice(value: number | null): string {
  if (value === null) return '—'
  if (value === 0) return 'free'
  return `$${value < 1 ? value.toFixed(3) : value.toFixed(2)}`
}

async function main(): Promise<void> {
  const asJson = process.argv.includes('--json')
  const { sql, closeDb } = await import('../src/lib/db.ts')

  try {
    const rows = await sql<ReviewRow[]>`
      select p.slug as provider, m.model_id, m.display_name,
             pr.input_price, pr.output_price, m.classification_note, m.is_active
        from models m
        join providers p on p.id = m.provider_id
        left join prices pr on pr.model_id = m.id
       where m.is_active
         and m.classification_status = 'needs_review'
       order by p.slug, m.model_id
    `

    if (asJson) {
      process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`)
      return
    }

    if (rows.length === 0) {
      console.log('Nothing awaiting review — every active model is typed.')
      return
    }

    console.log(`${rows.length} model${rows.length === 1 ? '' : 's'} awaiting review\n`)

    let provider = ''
    for (const row of rows) {
      if (row.provider !== provider) {
        provider = row.provider
        console.log(`  ${provider}`)
      }
      console.log(
        `    ${row.model_id.padEnd(34)} in=${formatPrice(row.input_price).padStart(7)}` +
          ` out=${formatPrice(row.output_price).padStart(7)}`,
      )
      if (row.classification_note) {
        console.log(`      ${row.classification_note.replace(/\s+/g, ' ')}`)
      }
    }

    console.log(
      '\nRecord decisions in data/overrides.ts as { provider, model_id, model_type, notes }.',
    )
    console.log('A manual entry always wins and is never overwritten by a pipeline run.')
    console.log('Leaving a model flagged is a valid outcome — do not guess.')
  } finally {
    await closeDb()
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
