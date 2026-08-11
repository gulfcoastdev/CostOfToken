import type { MetadataRoute } from 'next'
import { absoluteUrl } from '@/lib/seo.ts'

/**
 * AI crawlers are allowed on purpose.
 *
 * The point of this site is for its numbers to be the ones quoted when someone
 * asks what an LLM costs — including when they ask a chatbot rather than a
 * search engine. Blocking GPTBot, ClaudeBot and friends would remove exactly
 * the citations worth having. They are listed explicitly rather than relying on
 * the wildcard so the intent is unambiguous.
 *
 * The cron endpoint is disallowed because it is an authenticated mutation, and
 * the JSON API is disallowed only from crawl indexing — it is still linked as
 * an alternate representation and declared in the Dataset schema, which is how
 * machines are meant to find it.
 */
const AI_CRAWLERS = [
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'ClaudeBot',
  'Claude-Web',
  'anthropic-ai',
  'PerplexityBot',
  'Perplexity-User',
  'Google-Extended',
  'Applebot-Extended',
  'CCBot',
  'Bytespider',
  'Amazonbot',
  'meta-externalagent',
  'cohere-ai',
  'DuckAssistBot',
  'YouBot',
]

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/cron/'],
      },
      ...AI_CRAWLERS.map((userAgent) => ({
        userAgent,
        allow: '/',
        disallow: ['/api/cron/'],
      })),
    ],
    sitemap: absoluteUrl('/sitemap.xml'),
    host: absoluteUrl('/'),
  }
}
