/** Provider accent colours, from the design prototype. */
export const PROVIDER_COLORS: Record<string, string> = {
  openai: '#10A37F',
  anthropic: '#C16B4B',
  google: '#4285F4',
  xai: '#7C3AED',
  deepseek: '#DB2777',
  alibaba: '#F97316',
  moonshot: '#1E3A8A',
  zhipu: '#0891B2',
  bytedance: '#EF4444',
  baidu: '#78716C',
}

export function providerColor(slug: string): string {
  return PROVIDER_COLORS[slug] ?? '#737373'
}

/** How a price row was obtained, in the user's language. */
export const SOURCE_LABELS: Record<string, string> = {
  scrape: 'First-party',
  // Was "Via OpenRouter" when OpenRouter fallbacks were the only api rows;
  // DeepInfra's own catalogue made that label wrong. The linked source URL
  // on each row says which API.
  api: 'Provider API',
  catalog: 'Catalog',
  // 012: derived by the recovery judge from the fetched page when the
  // parser broke — the least-trusted source, and labelled as such.
  llm: 'LLM-derived',
}

/**
 * What kind of model this is, in the user's language.
 *
 * Shared by the model page and the explorer's detail card: both name the type
 * to the reader, and two copies would drift the moment a type is added.
 */
export const MODEL_TYPE_LABELS: Record<string, string> = {
  general: 'general-purpose',
  embedding: 'embedding',
  moderation: 'moderation',
  tts: 'text-to-speech',
  asr: 'speech-to-text',
  image_gen: 'image generation',
  video_gen: 'video generation',
  ocr: 'OCR',
  realtime: 'realtime audio',
  other: 'specialised',
}
