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
  api: 'Via OpenRouter',
  catalog: 'Catalog',
}
