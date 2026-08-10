/**
 * Print what each extractor actually produced, for eyeballing correctness
 * against the vendor's page. Development aid, not part of the pipeline.
 *
 *   npx tsx scripts/inspect.ts openai anthropic
 */
import { getExtractors } from '../src/pipeline/extractors/index.ts'
import { fetchText } from '../src/pipeline/http.ts'

const only = process.argv.slice(2)
const ctx = { fetchText: (url: string) => fetchText(url) }

for (const extractor of getExtractors(only.length > 0 ? only : undefined)) {
  console.log(`\n${'='.repeat(78)}\n${extractor.providerSlug}  (${extractor.sourceKind})`)
  try {
    const models = await extractor.extract(ctx)
    console.log(`${models.length} models`)
    for (const m of models.slice(0, 12)) {
      const p = m.pricing
      console.log(
        `  ${m.modelId.padEnd(38)} in=${fmt(p.inputPrice)} cache=${fmt(p.cachedInputPrice)} out=${fmt(
          p.outputPrice,
        )} long_in=${fmt(p.longInputPrice)} ctx=${m.contextWindow ?? '-'}`,
      )
    }
    if (models.length > 12) console.log(`  ... ${models.length - 12} more`)
  } catch (error) {
    console.log(`  FAILED: ${error instanceof Error ? error.message : error}`)
  }
}

function fmt(value: number | null): string {
  return value === null ? '   -  ' : value.toFixed(3).padStart(6)
}
