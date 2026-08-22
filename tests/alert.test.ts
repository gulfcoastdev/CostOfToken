import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildAlert, shouldAlert, sendAlert } from '../src/lib/alert.ts'
import type { RunSummary } from '../src/pipeline/run.ts'

/**
 * 008-price-fault-alerts.
 *
 * The checks already blocked correctly. What they never did was tell anyone —
 * a finding was recorded and then sat there. Two faults reached readers this
 * fortnight, one of them a model published at eight times its real price for
 * eleven days.
 */

function summary(over: Partial<RunSummary> = {}): RunSummary {
  return {
    runId: 'run-1',
    startedAt: '2026-08-22T06:00:00.000Z',
    finishedAt: '2026-08-22T06:00:30.000Z',
    durationMs: 30_000,
    dryRun: false,
    providers: [],
    totalModels: 222,
    totalChanged: 0,
    ok: true,
    blocked: 0,
    ...over,
  }
}

function provider(over: Partial<RunSummary['providers'][number]> = {}) {
  return {
    provider: 'deepseek',
    status: 'ok' as const,
    sourceKind: 'api',
    modelsFound: 15,
    modelsRejected: 0,
    modelsChanged: 0,
    durationMs: 100,
    ...over,
  }
}

test('a clean run sends nothing', () => {
  assert.equal(shouldAlert(summary({ providers: [provider()] })), false)
})

test('a blocked provider, a failed provider, or a failed run all send', () => {
  assert.ok(shouldAlert(summary({ blocked: 1, providers: [provider({ status: 'blocked' })] })))
  assert.ok(shouldAlert(summary({ providers: [provider({ status: 'failed', error: 'boom' })] })))
  assert.ok(shouldAlert(summary({ ok: false })))
})

test('a warning alone still sends — the operator asked to be told', () => {
  // Reversed deliberately: the first draft stayed quiet for warning-only runs.
  // "Model changes happen. Just monitor them and let me know."
  const warned = summary({
    providers: [
      provider({
        anomalies: [
          { code: 'unsettled_price', severity: 'warn', message: '1 price moved again', details: {} },
        ],
      }),
    ],
  })
  assert.ok(shouldAlert(warned))
})

test('one message per run, however many providers are involved', () => {
  const many = summary({
    blocked: 2,
    providers: [
      provider({ provider: 'openai', status: 'blocked', anomalies: [
        { code: 'uniform_price_shift', severity: 'block', message: 'all models moved 2x', details: {} }] }),
      provider({ provider: 'google', status: 'blocked', anomalies: [
        { code: 'coverage_drop', severity: 'block', message: 'count fell 70%', details: {} }] }),
      provider({ provider: 'xai', status: 'failed', error: 'timeout' }),
    ],
  })
  const alert = buildAlert(many)
  assert.equal(typeof alert.subject, 'string')
  for (const name of ['openai', 'google', 'xai']) {
    assert.match(alert.body, new RegExp(name), `${name} must appear`)
  }
  assert.match(alert.body, /uniform_price_shift/)
  assert.match(alert.body, /all models moved 2x/)
})

test('flagged models appear with before and after prices', () => {
  const alert = buildAlert(summary({
    providers: [provider({ anomalies: [{
      code: 'unsettled_price', severity: 'warn', message: '1 price moved again within 24h',
      details: { models: [{ modelId: 'deepseek-v4-flash-vision-exp', before: 0.44, after: 0.22, hours: 9, ratio: 0.5 }] },
    }] })],
  }))
  assert.match(alert.body, /deepseek-v4-flash-vision-exp/)
  assert.match(alert.body, /0\.44/)
  assert.match(alert.body, /0\.22/)
})

test('the body never carries a secret or a database host', () => {
  // The builder is pure and has no access to configuration; this asserts that
  // nothing echoed from the summary can leak either.
  const nasty = summary({
    providers: [provider({
      status: 'failed',
      error: 'connect failed: postgresql://postgres:devpw@aws-1-us-west-2.pooler.supabase.com:6543/postgres',
    })],
  })
  const alert = buildAlert(nasty)
  assert.doesNotMatch(alert.body, /devpw/)
  assert.doesNotMatch(alert.body, /postgresql:\/\//)
  assert.doesNotMatch(alert.body, /supabase\.com/)
  assert.doesNotMatch(alert.body, /pooler/)
})

test('an over-long report says what it left out rather than truncating silently', () => {
  const models = Array.from({ length: 40 }, (_, i) => ({
    modelId: `model-${i}`, before: 1, after: 2, hours: 3, ratio: 2,
  }))
  const alert = buildAlert(summary({
    providers: [provider({ anomalies: [{
      code: 'unsettled_price', severity: 'warn', message: '40 prices moved again', details: { models },
    }] })],
  }))
  assert.match(alert.body, /\bmore\b/i, 'must state that something was omitted')
})

test('vendor-supplied text is escaped before it reaches the message', () => {
  const alert = buildAlert(summary({
    providers: [provider({ anomalies: [{
      code: 'unsettled_price', severity: 'warn',
      message: 'weird <script>alert(1)</script> & co',
      details: {},
    }] })],
  }))
  assert.doesNotMatch(alert.body, /<script>/)
})

test('sending no-ops when unconfigured', async () => {
  // Configuration assertion rather than behavioural: actually sending would
  // either email a real person from CI or require mocking global fetch, and
  // the constitution sanctions asserting configuration where the behaviour
  // cannot be observed reliably (Principle III).
  delete process.env.RESEND_API_KEY
  delete process.env.ALERT_EMAIL_TO
  const result = await sendAlert({ subject: 's', body: 'b' })
  assert.equal(result.sent, false)
  assert.match(result.reason ?? '', /not configured/i)
})

test('the self-test alert is clearly labelled as a test', () => {
  // `?test_alert=true` exists so that configuring email in a dashboard can be
  // verified without waiting for a real fault. Its body must never be
  // mistakable for a genuine finding.
  const sample = summary({
    dryRun: true,
    providers: [provider({ provider: 'test', anomalies: [{
      code: 'unsettled_price', severity: 'warn',
      message: 'This is a test alert. No pipeline ran and nothing was written. A real one looks like this.',
      details: { models: [{ modelId: 'example-model', before: 0.44, after: 0.22, hours: 9, ratio: 0.5 }] },
    }] })],
  })
  assert.ok(shouldAlert(sample))
  const alert = buildAlert(sample)
  assert.match(alert.body, /test alert/i)
  assert.match(alert.body, /nothing was written/i)
})
