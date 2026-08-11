/**
 * The Gulf Coast Dev network feed.
 *
 * The source site offers a script embed, an iframe and a JSON feed. The JSON
 * is consumed here and rendered with our own components on purpose: a
 * third-party script would add a blocking request, shift layout as it sizes
 * itself, and put content the crawler may never see behind JavaScript. Reading
 * the feed server-side keeps the page fast, styled like the rest of the site,
 * and fully indexable.
 *
 * The feed is external data, not a trusted instruction source. Every field is
 * validated and every URL is checked to be http(s) before it reaches a link,
 * so a compromised or malformed feed cannot inject a `javascript:` href.
 */

const FEED_URL = 'https://cryptodev.info/network.php?format=json'
export const NETWORK_HOME = 'https://cryptodev.info/network.php'

export interface NetworkProject {
  name: string
  url: string
  description: string
  categories: string[]
  image: string | null
}

export interface NetworkFeed {
  title: string
  tagline: string
  projects: NetworkProject[]
  callout: { title: string; description: string; cta: string; ctaUrl: string | null } | null
  updated: string | null
}

/** Only absolute http(s) URLs survive; anything else becomes null. */
function safeUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return null
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null
  } catch {
    return null
  }
}

function text(value: unknown, max = 400): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

/**
 * Fetch and normalize the feed. Returns null if it is unreachable or
 * unparseable — the page then renders a link to the network rather than an
 * error, since a neighbouring site being down is not this site's problem.
 */
export async function getNetworkFeed(): Promise<NetworkFeed | null> {
  try {
    const response = await fetch(FEED_URL, {
      headers: {
        accept: 'application/json',
        'user-agent': 'CostOfToken/1.0 (+https://costoftoken.com)',
      },
      // The feed advertises a ten-minute cache; match it rather than hammering.
      next: { revalidate: 600 },
      signal: AbortSignal.timeout(8000),
    })
    if (!response.ok) return null

    const raw = (await response.json()) as Record<string, unknown>
    const rawProjects = Array.isArray(raw.projects) ? raw.projects : []

    const projects: NetworkProject[] = []
    for (const entry of rawProjects) {
      if (typeof entry !== 'object' || entry === null) continue
      const project = entry as Record<string, unknown>
      const url = safeUrl(project.url)
      const name = text(project.name, 80)
      if (!url || !name) continue

      projects.push({
        name,
        url,
        description: text(project.description, 300),
        categories: Array.isArray(project.categories)
          ? project.categories.filter((c): c is string => typeof c === 'string').slice(0, 4)
          : [],
        image: safeUrl(project.image),
      })
    }

    if (projects.length === 0) return null

    const rawCallout =
      typeof raw.callout === 'object' && raw.callout !== null
        ? (raw.callout as Record<string, unknown>)
        : null

    return {
      title: text(raw.title, 120) || 'Gulf Coast Dev network',
      tagline: text(raw.tagline, 300),
      projects,
      callout: rawCallout
        ? {
            title: text(rawCallout.title, 160),
            description: text(rawCallout.description, 400),
            cta: text(rawCallout.cta, 160),
            ctaUrl: safeUrl(rawCallout.ctaUrl),
          }
        : null,
      updated: text(raw.updated, 40) || null,
    }
  } catch {
    return null
  }
}
