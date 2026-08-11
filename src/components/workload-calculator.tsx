'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { formatContext } from '@/lib/format.ts'
import { modelPath } from '@/lib/seo.ts'
import type { PriceRowV1 } from '@/lib/types.ts'
import { providerColor, SOURCE_LABELS } from './provider-colors.ts'

/**
 * Rank every model by what a specific workload would actually cost.
 *
 * List price answers "which model is cheapest per token", which is rarely the
 * question. Output usually costs three to five times input, so a model that
 * looks expensive on input can be the cheapest choice for a summariser and the
 * most expensive for a chat agent. This ranks on the mix the user actually
 * sends.
 */

export interface WorkloadPreset {
  id: string
  label: string
  description: string
  inputTokens: number
  outputTokens: number
  requestsPerMonth: number
  cachedShare: number
}

/** Starting points, not claims about what anyone's traffic looks like. */
export const PRESETS: WorkloadPreset[] = [
  {
    id: 'chat',
    label: 'Chat assistant',
    description: 'Short prompts, conversational replies, steady traffic',
    inputTokens: 1_500,
    outputTokens: 600,
    requestsPerMonth: 100_000,
    cachedShare: 0.3,
  },
  {
    id: 'rag',
    label: 'RAG / document Q&A',
    description: 'Large retrieved context, short answers, heavy prompt reuse',
    inputTokens: 20_000,
    outputTokens: 500,
    requestsPerMonth: 30_000,
    cachedShare: 0.6,
  },
  {
    id: 'coding',
    label: 'Coding agent',
    description: 'Large context and long generations, many turns per task',
    inputTokens: 30_000,
    outputTokens: 4_000,
    requestsPerMonth: 20_000,
    cachedShare: 0.5,
  },
  {
    id: 'batch',
    label: 'Bulk classification',
    description: 'Small prompts, tiny outputs, very high volume',
    inputTokens: 800,
    outputTokens: 40,
    requestsPerMonth: 2_000_000,
    cachedShare: 0.1,
  },
]

interface Row {
  row: PriceRowV1
  monthly: number | null
  isFree: boolean
  fitsContext: boolean
}

/**
 * Why a model cannot serve this workload, or null if it can.
 *
 * Embedding, moderation and OCR endpoints publish no output price because they
 * do not generate text. Treating that missing price as zero ranks them as the
 * cheapest way to run a chat workload, which is nonsense — they cannot run it
 * at all. They are excluded with a reason rather than silently dropped.
 */
function inapplicableReason(row: PriceRowV1, outputTokens: number): string | null {
  if (row.input === null && row.output === null) return 'no published pricing'
  if (outputTokens > 0 && row.output === null) return 'does not generate output tokens'
  return null
}

function money(value: number): string {
  if (value === 0) return '$0'
  if (value < 0.01) return `$${value.toFixed(4)}`
  if (value < 1000) return `$${value.toFixed(2)}`
  if (value < 1_000_000) return `$${(value / 1000).toFixed(1)}K`
  return `$${(value / 1_000_000).toFixed(2)}M`
}

function clampNumber(value: string, fallback: number): number {
  const parsed = Number(value.replace(/[^0-9.]/g, ''))
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

export function WorkloadCalculator({ rows }: { rows: PriceRowV1[] }) {
  const [inputTokens, setInputTokens] = useState(PRESETS[0].inputTokens)
  const [outputTokens, setOutputTokens] = useState(PRESETS[0].outputTokens)
  const [requests, setRequests] = useState(PRESETS[0].requestsPerMonth)
  const [cachedShare, setCachedShare] = useState(PRESETS[0].cachedShare)
  const [activePreset, setActivePreset] = useState<string>('chat')
  const [ready, setReady] = useState(false)

  // Read the URL after mount so the page itself stays cacheable.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const num = (key: string, fallback: number) => {
      const raw = params.get(key)
      if (raw === null) return fallback
      const parsed = Number(raw)
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
    }
    if (params.size > 0) {
      setInputTokens(num('in', PRESETS[0].inputTokens))
      setOutputTokens(num('out', PRESETS[0].outputTokens))
      setRequests(num('req', PRESETS[0].requestsPerMonth))
      setCachedShare(Math.min(1, num('cached', PRESETS[0].cachedShare)))
      setActivePreset('')
    }
    setReady(true)
  }, [])

  useEffect(() => {
    if (!ready) return
    const params = new URLSearchParams({
      in: String(inputTokens),
      out: String(outputTokens),
      req: String(requests),
      cached: String(cachedShare),
    })
    window.history.replaceState(null, '', `${window.location.pathname}?${params}`)
  }, [ready, inputTokens, outputTokens, requests, cachedShare])

  const applyPreset = useCallback((preset: WorkloadPreset) => {
    setInputTokens(preset.inputTokens)
    setOutputTokens(preset.outputTokens)
    setRequests(preset.requestsPerMonth)
    setCachedShare(preset.cachedShare)
    setActivePreset(preset.id)
  }, [])

  const { ranked, excluded } = useMemo(() => {
    const perRequestContext = inputTokens + outputTokens
    const skipped: Array<{ row: PriceRowV1; reason: string }> = []

    const priced = rows
      .map((row): Row | null => {
        const reason = inapplicableReason(row, outputTokens)
        if (reason) {
          skipped.push({ row, reason })
          return null
        }

        const inputPrice = row.input ?? 0
        // Where a provider publishes no cached rate, cached tokens are billed
        // at the normal input price rather than assumed free.
        const cachedPrice = row.cached_input ?? inputPrice
        const outputPrice = row.output ?? 0

        const cachedTokens = inputTokens * cachedShare
        const freshTokens = inputTokens - cachedTokens

        const perRequest =
          (freshTokens * inputPrice + cachedTokens * cachedPrice + outputTokens * outputPrice) /
          1_000_000

        return {
          row,
          monthly: perRequest * requests,
          isFree: inputPrice === 0 && outputPrice === 0,
          // A model that cannot hold the prompt is not a cheaper option, it is
          // the wrong option — flagged rather than silently ranked first.
          fitsContext: row.context_window === null || row.context_window >= perRequestContext,
        }
      })
      .filter((entry): entry is Row => entry !== null)
      .sort((a, b) => (a.monthly ?? 0) - (b.monthly ?? 0))

    return { ranked: priced, excluded: skipped }
  }, [rows, inputTokens, outputTokens, requests, cachedShare])

  const free = ranked.filter((entry) => entry.isFree)
  const paid = ranked.filter((entry) => !entry.isFree)
  const usable = paid.filter((entry) => entry.fitsContext)
  const cheapest = usable[0]
  const priciest = usable.at(-1)

  return (
    <>
      <section className="mb-6 rounded-2xl border border-neutral-200 bg-white px-6 py-5">
        <h2 className="m-0 mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Start from a typical workload
        </h2>
        <div className="mb-5 flex flex-wrap gap-2">
          {PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => applyPreset(preset)}
              title={preset.description}
              className={`rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors ${
                activePreset === preset.id
                  ? 'border-emerald-600 bg-emerald-50 text-emerald-700'
                  : 'border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300'
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field
            label="Input tokens per request"
            value={inputTokens}
            onChange={(v) => {
              setInputTokens(v)
              setActivePreset('')
            }}
            hint="Prompt, system message and any retrieved context"
          />
          <Field
            label="Output tokens per request"
            value={outputTokens}
            onChange={(v) => {
              setOutputTokens(v)
              setActivePreset('')
            }}
            hint="What the model generates back"
          />
          <Field
            label="Requests per month"
            value={requests}
            onChange={(v) => {
              setRequests(v)
              setActivePreset('')
            }}
            hint="Total calls across all users"
          />
          <div>
            <label
              htmlFor="cached-share"
              className="block text-[13px] font-medium text-neutral-800"
            >
              Cached input: {Math.round(cachedShare * 100)}%
            </label>
            <input
              id="cached-share"
              type="range"
              min="0"
              max="100"
              step="5"
              value={Math.round(cachedShare * 100)}
              onChange={(event) => {
                setCachedShare(Number(event.target.value) / 100)
                setActivePreset('')
              }}
              className="mt-3 w-full accent-emerald-600"
            />
            <p className="m-0 mt-1 text-[12px] leading-snug text-neutral-500">
              Share of the prompt that repeats between calls. Usually the single
              largest saving available.
            </p>
          </div>
        </div>
      </section>

      {cheapest && priciest && (
        <section className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Stat
            label={`Cheapest — ${cheapest.row.display_name}`}
            value={money(cheapest.monthly ?? 0)}
            accent
          />
          <Stat
            label={`Most expensive — ${priciest.row.display_name}`}
            value={money(priciest.monthly ?? 0)}
          />
          <Stat
            label="Difference between them"
            value={
              cheapest.monthly && cheapest.monthly > 0
                ? `${Math.round((priciest.monthly ?? 0) / cheapest.monthly)}×`
                : '—'
            }
          />
        </section>
      )}

      {free.length > 0 && (
        <section className="mb-6 rounded-xl border border-sky-200 bg-sky-50 px-5 py-4">
          <h2 className="m-0 text-base font-semibold text-sky-950">
            {free.length} model{free.length === 1 ? '' : 's'} would cost nothing
          </h2>
          <p className="m-0 mt-1.5 text-[14px] leading-relaxed text-sky-900">
            Listed separately rather than at the top of the ranking, where they would win every
            comparison by default and tell you nothing:{' '}
            {free.map((entry, index) => (
              <span key={entry.row.model_id}>
                {index > 0 && ', '}
                <Link
                  href={modelPath(entry.row.provider, entry.row.model_id)}
                  className="font-medium underline underline-offset-2"
                >
                  {entry.row.display_name}
                </Link>
              </span>
            ))}
            .
          </p>
        </section>
      )}

      <section>
        <h2 className="mb-1 text-xl font-semibold tracking-tight text-neutral-950">
          Monthly cost, cheapest first
        </h2>
        <p className="mb-3 text-[13px] text-neutral-500">
          {usable.length} paid models priced for {requests.toLocaleString('en-US')} requests of{' '}
          {inputTokens.toLocaleString('en-US')} in / {outputTokens.toLocaleString('en-US')} out.
        </p>

        <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <caption className="sr-only">Models ranked by estimated monthly cost</caption>
            <thead>
              <tr className="border-b border-neutral-200 text-left text-xs font-semibold text-neutral-500">
                <th scope="col" className="px-3 py-2.5">#</th>
                <th scope="col" className="px-3 py-2.5">Model</th>
                <th scope="col" className="px-3 py-2.5">Provider</th>
                <th scope="col" className="px-3 py-2.5 text-right">Per request</th>
                <th scope="col" className="px-3 py-2.5 text-right">Per month</th>
                <th scope="col" className="px-3 py-2.5 text-right">Context</th>
              </tr>
            </thead>
            <tbody>
              {paid.map((entry, index) => (
                <tr
                  key={`${entry.row.provider}/${entry.row.model_id}`}
                  className={`border-b border-neutral-100 last:border-0 ${
                    entry.fitsContext ? '' : 'opacity-55'
                  }`}
                >
                  <td className="px-3 py-2.5 text-[13px] text-neutral-400">{index + 1}</td>
                  <th scope="row" className="px-3 py-2.5 text-left font-medium">
                    <Link
                      href={modelPath(entry.row.provider, entry.row.model_id)}
                      className="font-semibold text-neutral-900 underline underline-offset-2 hover:text-emerald-700"
                    >
                      {entry.row.display_name}
                    </Link>
                    {!entry.fitsContext && (
                      <span className="ml-2 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                        Context too small
                      </span>
                    )}
                    {entry.row.source_kind !== 'scrape' && (
                      <span className="ml-2 text-[11px] font-normal text-neutral-400">
                        {SOURCE_LABELS[entry.row.source_kind]}
                      </span>
                    )}
                  </th>
                  <td className="whitespace-nowrap px-3 py-2.5">
                    <span className="inline-flex items-center gap-1.5 text-[13px] text-neutral-700">
                      <span
                        className="inline-block h-2 w-2 shrink-0 rounded-full"
                        style={{ background: providerColor(entry.row.provider) }}
                      />
                      {entry.row.provider_name}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-neutral-600">
                    {money((entry.monthly ?? 0) / Math.max(requests, 1))}
                  </td>
                  <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-neutral-900">
                    {money(entry.monthly ?? 0)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-neutral-600">
                    {formatContext(entry.row.context_window)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {excluded.length > 0 && (
          <p className="mt-3 text-[12.5px] leading-relaxed text-neutral-500">
            {excluded.length} model{excluded.length === 1 ? '' : 's'} excluded because they cannot
            serve this workload — mostly embedding, moderation and OCR endpoints that publish no
            output price because they do not generate text. Counting that missing price as zero
            would rank them as the cheapest way to run a chat.
          </p>
        )}
        <p className="mt-3 text-[12.5px] leading-relaxed text-neutral-500">
          Estimates use standard-tier list prices. They exclude batch discounts, committed-use
          agreements and free allowances, and assume every request is the same shape. Treat the
          ranking as sound and the absolute figures as approximate.
        </p>
      </section>
    </>
  )
}

function Field({
  label,
  value,
  onChange,
  hint,
}: {
  label: string
  value: number
  onChange: (value: number) => void
  hint: string
}) {
  const id = label.toLowerCase().replace(/[^a-z]+/g, '-')
  return (
    <div>
      <label htmlFor={id} className="block text-[13px] font-medium text-neutral-800">
        {label}
      </label>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        value={value.toLocaleString('en-US')}
        onChange={(event) => onChange(clampNumber(event.target.value, value))}
        className="mt-1.5 w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm tabular-nums text-neutral-900 outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
      />
      <p className="m-0 mt-1 text-[12px] leading-snug text-neutral-500">{hint}</p>
    </div>
  )
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white px-4 py-3">
      <div
        className={`text-2xl font-bold tabular-nums tracking-tight ${
          accent ? 'text-emerald-600' : 'text-neutral-900'
        }`}
      >
        {value}
      </div>
      <div className="mt-0.5 truncate text-xs text-neutral-500">{label}</div>
    </div>
  )
}
