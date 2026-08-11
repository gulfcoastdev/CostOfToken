/**
 * How each provider is actually searched for.
 *
 * The database slug is the company (`google`, `alibaba`, `zhipu`) but almost
 * nobody searches for the company — they search for the model family: "gemini
 * pricing", "qwen pricing", "glm pricing". Titles, headings and copy therefore
 * lead with the brand, and the extra aliases redirect to the canonical page so
 * a guessed URL still lands rather than 404s.
 */
export interface ProviderBrand {
  /** Database slug — the canonical URL segment. */
  slug: string
  /** What people call it. Leads every title and heading. */
  brand: string
  /** Company name, for attribution where the two differ. */
  company: string
  /** Model-family names people type. First entry leads the meta description. */
  families: string[]
  /** Extra URL segments that should redirect here. */
  aliases: string[]
  /** One line of genuinely useful context, not keyword filler. */
  summary: string
}

export const PROVIDER_BRANDS: Record<string, ProviderBrand> = {
  openai: {
    slug: 'openai',
    brand: 'OpenAI',
    company: 'OpenAI',
    families: ['GPT-5', 'GPT-4', 'o-series'],
    aliases: ['gpt', 'chatgpt', 'gpt-5', 'gpt5'],
    summary:
      'OpenAI prices most models in short- and long-context tiers, and offers cached input at a large discount for repeated prompt prefixes.',
  },
  anthropic: {
    slug: 'anthropic',
    brand: 'Claude',
    company: 'Anthropic',
    families: ['Claude Opus', 'Claude Sonnet', 'Claude Haiku'],
    aliases: ['claude', 'claude-ai', 'opus', 'sonnet', 'haiku'],
    summary:
      'Anthropic quotes prices per million tokens (MTok) and bills prompt caching as separate write and read rates, with cache hits far cheaper than base input.',
  },
  google: {
    slug: 'google',
    brand: 'Gemini',
    company: 'Google',
    families: ['Gemini Pro', 'Gemini Flash', 'Gemini Flash-Lite'],
    aliases: ['gemini', 'google-gemini', 'gemini-api', 'vertex'],
    summary:
      'Google publishes a free tier alongside paid pricing, and several Gemini models charge a higher rate above a long-context threshold.',
  },
  xai: {
    slug: 'xai',
    brand: 'Grok',
    company: 'xAI',
    families: ['Grok 4', 'Grok Code'],
    aliases: ['grok', 'x-ai', 'grok-api'],
    summary:
      'xAI publishes a machine-readable model catalogue, including context window and a long-context tier that applies above 128K tokens.',
  },
  deepseek: {
    slug: 'deepseek',
    brand: 'DeepSeek',
    company: 'DeepSeek',
    families: ['DeepSeek V4', 'DeepSeek R'],
    aliases: ['deepseak', 'deep-seek', 'deepseek-api'],
    summary:
      'DeepSeek is among the cheapest capable APIs, with aggressive cache-hit pricing that rewards repeated prompt prefixes.',
  },
  alibaba: {
    slug: 'alibaba',
    brand: 'Qwen',
    company: 'Alibaba',
    families: ['Qwen Max', 'Qwen Plus', 'Qwen Flash'],
    aliases: ['qwen', 'tongyi', 'dashscope', 'model-studio'],
    summary:
      'Alibaba ships the widest range of sizes of any provider here, from sub-cent flash models to flagship Max tiers.',
  },
  moonshot: {
    slug: 'moonshot',
    brand: 'Kimi',
    company: 'Moonshot AI',
    families: ['Kimi K2', 'Kimi K3'],
    aliases: ['kimi', 'moonshot-ai', 'kimi-k2'],
    summary: 'Moonshot’s Kimi models target long-context work at a fraction of Western flagship pricing.',
  },
  zhipu: {
    slug: 'zhipu',
    brand: 'GLM',
    company: 'Zhipu AI',
    families: ['GLM-5', 'GLM-4'],
    aliases: ['glm', 'z-ai', 'bigmodel', 'chatglm'],
    summary:
      'Zhipu publishes several genuinely free Flash models alongside paid GLM tiers, which is unusual among hosted APIs.',
  },
  bytedance: {
    slug: 'bytedance',
    brand: 'Doubao',
    company: 'ByteDance',
    families: ['Doubao Seed', 'Doubao Pro'],
    aliases: ['doubao', 'volcengine', 'ark'],
    summary: 'ByteDance sells Doubao through Volcengine Ark, priced well below Western equivalents.',
  },
  baidu: {
    slug: 'baidu',
    brand: 'ERNIE',
    company: 'Baidu',
    families: ['ERNIE 5', 'ERNIE 4.5'],
    aliases: ['ernie', 'qianfan', 'wenxin'],
    summary: 'Baidu sells ERNIE through the Qianfan platform.',
  },
}

/** alias segment -> canonical slug, for redirecting guessed URLs. */
export const PROVIDER_ALIAS_MAP: Record<string, string> = Object.fromEntries(
  Object.values(PROVIDER_BRANDS).flatMap((brand) =>
    brand.aliases.map((alias) => [alias.toLowerCase(), brand.slug]),
  ),
)

export function getBrand(slug: string): ProviderBrand | null {
  return PROVIDER_BRANDS[slug] ?? null
}

/** Brand-led label: "Gemini (Google)" where they differ, "OpenAI" where they don't. */
export function brandLabel(slug: string, fallback: string): string {
  const brand = getBrand(slug)
  if (!brand) return fallback
  return brand.brand === brand.company ? brand.brand : `${brand.brand} (${brand.company})`
}
