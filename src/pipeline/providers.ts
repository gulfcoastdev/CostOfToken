import type { ProviderDefinition } from '@/lib/types.ts'

/**
 * Every provider we track, with its official pricing page.
 *
 * `pricingUrl` is the human-facing page shown in the UI and stored on price
 * rows. It is not necessarily the URL an extractor fetches — see each
 * extractor for the document it actually parses.
 */
export const PROVIDERS: readonly ProviderDefinition[] = [
  // --- Western / global leaders -------------------------------------------
  {
    slug: 'openai',
    name: 'OpenAI',
    website: 'https://openai.com',
    pricingUrl: 'https://platform.openai.com/docs/pricing',
    region: 'global',
  },
  {
    slug: 'xai',
    name: 'xAI',
    website: 'https://x.ai',
    pricingUrl: 'https://docs.x.ai/docs/models',
    region: 'global',
  },
  {
    slug: 'google',
    name: 'Google',
    website: 'https://ai.google.dev',
    pricingUrl: 'https://ai.google.dev/gemini-api/docs/pricing',
    region: 'global',
  },
  {
    slug: 'anthropic',
    name: 'Anthropic',
    website: 'https://anthropic.com',
    pricingUrl: 'https://docs.anthropic.com/en/docs/about-claude/pricing',
    region: 'global',
  },

  // --- Chinese providers ---------------------------------------------------
  {
    slug: 'deepseek',
    name: 'DeepSeek',
    website: 'https://deepseek.com',
    pricingUrl: 'https://api-docs.deepseek.com/quick_start/pricing',
    region: 'cn',
  },
  {
    slug: 'alibaba',
    name: 'Alibaba (Qwen)',
    website: 'https://www.alibabacloud.com/help/en/model-studio',
    pricingUrl: 'https://www.alibabacloud.com/help/en/model-studio/models',
    region: 'cn',
  },
  {
    slug: 'moonshot',
    name: 'Moonshot AI (Kimi)',
    website: 'https://platform.moonshot.ai',
    pricingUrl: 'https://platform.moonshot.ai/docs/pricing/chat',
    region: 'cn',
  },
  {
    slug: 'zhipu',
    name: 'Zhipu AI (GLM)',
    website: 'https://z.ai',
    pricingUrl: 'https://docs.z.ai/guides/overview/pricing',
    region: 'cn',
  },
  {
    slug: 'bytedance',
    name: 'ByteDance (Doubao)',
    website: 'https://www.volcengine.com',
    pricingUrl: 'https://www.volcengine.com/docs/82379/1099320',
    region: 'cn',
  },
  {
    // No machine-readable first-party source: minimax.io/price is a
    // client-rendered SPA whose HTML contains model names but not a single
    // price, and appending `.md` returns the same shell. Priced via the
    // OpenRouter catalogue until that changes.
    slug: 'minimax',
    name: 'MiniMax',
    website: 'https://www.minimax.io',
    pricingUrl: 'https://www.minimax.io/price',
    region: 'cn',
  },
  {
    slug: 'baidu',
    name: 'Baidu (ERNIE)',
    website: 'https://cloud.baidu.com',
    pricingUrl: 'https://cloud.baidu.com/product-price/qianfan.html',
    region: 'cn',
  },

  // --- Routers / inference hosts (011) ------------------------------------
  {
    // A reseller, not a vendor: its catalogue prices are what OpenRouter
    // customers pay, listed as offers beside vendors' direct prices.
    slug: 'openrouter',
    name: 'OpenRouter',
    website: 'https://openrouter.ai',
    pricingUrl: 'https://openrouter.ai/models',
    region: 'global',
    providerType: 'router',
  },
] as const

export const PROVIDER_BY_SLUG = new Map(PROVIDERS.map((p) => [p.slug, p]))

export function isKnownProvider(slug: string): boolean {
  return PROVIDER_BY_SLUG.has(slug)
}
