'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { formatCostShort, rankByWorkload, type CostEstimate } from '@/lib/cost.ts'
import { formatContext } from '@/lib/format.ts'
import { modelPath } from '@/lib/seo.ts'
import type { PriceRowV1 } from '@/lib/types.ts'
import { providerColor, SOURCE_LABELS } from './provider-colors.ts'
import {
  compareNullableNumbers,
  compareText,
  SortHeader,
  useSortState,
  type SortDirection,
} from './sort-header.tsx'

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

/**
 * `perRequest` is a separate key from `cost` even though it orders identically
 * — per-request cost is monthly divided by a constant. Sharing one key would
 * light the sort arrow on two headings at once, which reads as a bug.
 */
type RankKey = 'cost' | 'perRequest' | 'model' | 'provider' | 'context'

function rankDirection(key: RankKey): SortDirection {
  // Cheapest first, biggest context first: each column's most useful answer.
  return key === 'context' ? 'desc' : 'asc'
}

const RANK_TH = 'px-3 py-2.5'

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

  const { paid, free, unusable } = useMemo(
    () =>
      rankByWorkload(rows, {
        inputTokens,
        outputTokens,
        requestsPerMonth: requests,
        cachedShare,
      }),
    [rows, inputTokens, outputTokens, requests, cachedShare],
  )

  // Computed from the ranked list, not the displayed one, so re-sorting the
  // table by name does not change which model the summary calls cheapest.
  const usable = paid.filter((entry) => entry.fitsContext)
  const cheapest = usable[0]
  const priciest = usable.at(-1)

  const sort = useSortState<RankKey>('cost', rankDirection)
  const { key: sortKey, direction } = sort

  const ranked = useMemo(() => {
    const list = [...paid]
    list.sort((a, b) => {
      switch (sortKey) {
        case 'model':
          return compareText(a.row.display_name, b.row.display_name, direction)
        case 'provider':
          return (
            compareText(a.row.provider_name, b.row.provider_name, direction) ||
            compareNullableNumbers(a.monthly, b.monthly, 'asc')
          )
        case 'context':
          return compareNullableNumbers(a.row.context_window, b.row.context_window, direction)
        default:
          return compareNullableNumbers(a.monthly, b.monthly, direction)
      }
    })
    return list
  }, [paid, sortKey, direction])

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
              Share of the prompt that repeats between calls. Usually the single largest saving
              available.
            </p>
          </div>
        </div>
      </section>

      {cheapest && priciest && (
        <section className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Stat
            label={`Cheapest — ${cheapest.row.display_name}`}
            value={formatCostShort(cheapest.monthly ?? 0)}
            accent
          />
          <Stat
            label={`Most expensive — ${priciest.row.display_name}`}
            value={formatCostShort(priciest.monthly ?? 0)}
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
          Click any column heading to re-sort.
        </p>

        <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <caption className="sr-only">Models ranked by estimated monthly cost</caption>
            <thead>
              <tr className="border-b border-neutral-200 text-xs font-semibold text-neutral-500">
                <th scope="col" className="px-3 py-2.5 text-left">
                  #
                </th>
                <SortHeader column="model" label="Model" sort={sort} className={RANK_TH} />
                <SortHeader column="provider" label="Provider" sort={sort} className={RANK_TH} />
                <SortHeader
                  column="perRequest"
                  label="Per request"
                  sort={sort}
                  numeric
                  className={RANK_TH}
                />
                <SortHeader
                  column="cost"
                  label="Per month"
                  sort={sort}
                  numeric
                  className={RANK_TH}
                />
                <SortHeader
                  column="context"
                  label="Context"
                  sort={sort}
                  numeric
                  className={RANK_TH}
                />
              </tr>
            </thead>
            <tbody>
              {ranked.map((entry, index) => (
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
                    {formatCostShort((entry.monthly ?? 0) / Math.max(requests, 1))}
                  </td>
                  <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-neutral-900">
                    {formatCostShort(entry.monthly ?? 0)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-neutral-600">
                    {formatContext(entry.row.context_window)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {unusable.length > 0 && (
          <p className="mt-3 text-[12.5px] leading-relaxed text-neutral-500">
            {unusable.length} model{unusable.length === 1 ? '' : 's'} excluded because they cannot
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
