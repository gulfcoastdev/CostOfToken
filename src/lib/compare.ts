import type { PriceRowV1 } from './types.ts'

/**
 * Identity and URL encoding for the side-by-side comparison.
 *
 * Deliberately a plain module rather than part of the `'use client'`
 * comparison component: the page's `generateMetadata` needs `MAX_COMPARED` to
 * write its title, and a value exported from a client module reaches the
 * server as a client *reference*, not the value — interpolating it produced a
 * page title containing a stack trace. Anything both sides need lives here.
 */

/** Above this the layout stops being a comparison and starts being a table. */
export const MAX_COMPARED = 3

/**
 * Identity of a model within the site.
 *
 * Model ids repeat across vendors, so the provider is part of the key.
 */
export function modelKey(row: Pick<PriceRowV1, 'provider' | 'model_id'>): string {
  return `${row.provider}|${row.model_id}`
}

/**
 * Selection travels in the URL so a comparison can be sent to someone.
 *
 * Each half is encoded separately: model ids legitimately contain slashes,
 * dots and colons, so only the delimiters can be trusted to be delimiters.
 */
export function encodeSelection(keys: string[]): string {
  return keys
    .map((key) => {
      const [provider, ...rest] = key.split('|')
      return `${encodeURIComponent(provider)}|${encodeURIComponent(rest.join('|'))}`
    })
    .join(',')
}

export function decodeSelection(raw: string | null): string[] {
  if (!raw) return []
  return raw
    .split(',')
    .map((entry) => {
      const [provider, ...rest] = entry.split('|')
      if (!provider || rest.length === 0) return ''
      return `${decodeURIComponent(provider)}|${decodeURIComponent(rest.join('|'))}`
    })
    .filter(Boolean)
    .slice(0, MAX_COMPARED)
}

/** Link to the comparison page with a selection already made. */
export function compareHref(keys: string[]): string {
  return keys.length > 0 ? `/compare?models=${encodeSelection(keys)}` : '/compare'
}
