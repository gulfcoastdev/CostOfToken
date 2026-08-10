import type { NormalizedModel, SourceKind } from '@/lib/types.ts'

export interface ExtractorContext {
  /** Fetch a document; injected so tests can run extractors against fixtures. */
  fetchText: (url: string, init?: { headers?: Record<string, string> }) => Promise<string>
}

export interface Extractor {
  providerSlug: string
  /** What this extractor reads. 'catalog' means it has no live source yet. */
  sourceKind: SourceKind
  /** The document actually fetched, which may differ from the provider's marketing page. */
  sourceUrl: string
  /**
   * Return every model found. Throw to mark the provider failed — the runner
   * soft-fails per provider, so one broken page never aborts the whole job.
   * Returning an empty array is treated as a failure too, since a silent
   * layout change looks exactly like "this provider has no models".
   */
  extract: (ctx: ExtractorContext) => Promise<NormalizedModel[]>
}
