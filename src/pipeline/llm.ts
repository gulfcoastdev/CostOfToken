/**
 * The one OpenRouter chat client (010 arbiter + 012 recovery).
 *
 * A plain fetch, like the Resend alert sender: one JSON POST with a strict
 * response schema. One retry on retryable failures (429/5xx/network); a 4xx
 * is a configuration problem a retry cannot fix. Callers validate the
 * returned JSON with their own zod schema before acting on it.
 */

/**
 * The judge model for every LLM judgment in the pipeline, in OpenRouter id
 * form. One knob — two knobs would drift. DeepSeek by operator decision
 * ("we will use deepseek for it"); the id is verified against our own
 * ingested OpenRouter catalogue.
 */
export function judgeModel(): string {
  return process.env.ARBITER_MODEL || 'deepseek/deepseek-v4-pro'
}

export function hasJudgeKey(): boolean {
  return Boolean(process.env.OPEN_ROUTER_API_KEY)
}

/**
 * One structured-output chat call. Returns the parsed JSON content, or null
 * when the model returned no usable content. Throws on HTTP/network failure
 * after the single retry — callers map that to their own degraded path.
 */
export async function openrouterChat(
  systemPrompt: string,
  payload: string,
  jsonSchema: { name: string; schema: Record<string, unknown> },
): Promise<unknown | null> {
  const apiKey = process.env.OPEN_ROUTER_API_KEY
  if (!apiKey) return null

  const call = async (): Promise<Response> =>
    fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      // 60s + one retry keeps the worst case well inside the platform
      // duration ceiling even with several judged providers in one run.
      signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({
        model: judgeModel(),
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: payload },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: { name: jsonSchema.name, strict: true, schema: jsonSchema.schema },
        },
      }),
    })

  let response: Response
  try {
    response = await call()
    if (response.status === 429 || response.status >= 500) {
      response = await call()
    }
  } catch {
    // Timeout or network failure; the retry is the single second attempt.
    response = await call()
  }

  if (!response.ok) throw new Error(`openrouter returned ${response.status}`)

  const body = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>
  }
  const content = body.choices?.[0]?.message?.content
  if (!content) return null

  try {
    return JSON.parse(content)
  } catch {
    return null
  }
}
