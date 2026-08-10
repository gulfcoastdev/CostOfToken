const USER_AGENT =
  'CostOfTokenBot/0.1 (+https://github.com/gulfcoastdev/CostOfToken; LLM pricing tracker)'

export interface FetchOptions {
  timeoutMs?: number
  retries?: number
  headers?: Record<string, string>
}

/**
 * Fetch a document with a timeout and bounded retries.
 *
 * Pricing pages are static documents behind CDNs; transient 5xx and connection
 * resets are the common failure, so retry those with backoff but never retry a
 * 4xx (a 404 means the URL moved and retrying won't help).
 */
export async function fetchText(url: string, options: FetchOptions = {}): Promise<string> {
  const { timeoutMs = 20_000, retries = 2, headers = {} } = options

  let lastError: unknown

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** (attempt - 1)))
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        redirect: 'follow',
        headers: {
          'user-agent': USER_AGENT,
          accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
          'accept-language': 'en-US,en;q=0.9',
          ...headers,
        },
      })

      if (!response.ok) {
        const error = new Error(`GET ${url} -> HTTP ${response.status}`)
        if (response.status >= 400 && response.status < 500) throw error // don't retry
        lastError = error
        continue
      }

      return await response.text()
    } catch (error) {
      if (error instanceof Error && error.message.includes('-> HTTP 4')) throw error
      lastError = error
    } finally {
      clearTimeout(timer)
    }
  }

  throw new Error(
    `GET ${url} failed after ${retries + 1} attempts: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  )
}

export async function fetchJson<T = unknown>(url: string, options: FetchOptions = {}): Promise<T> {
  const body = await fetchText(url, {
    ...options,
    headers: { accept: 'application/json', ...options.headers },
  })
  return JSON.parse(body) as T
}
