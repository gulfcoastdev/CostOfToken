'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { COMPARISON_SCENARIOS, formatCostShort, scenarioCost, unusableReason } from '@/lib/cost.ts'
import { decodeSelection, encodeSelection, MAX_COMPARED, modelKey } from '@/lib/compare.ts'
import { blendedPrice, formatContext, formatPrice, formatRelativeTime } from '@/lib/format.ts'
import { modelPath, providerPath } from '@/lib/seo.ts'
import type { PriceRowV1 } from '@/lib/types.ts'
import { providerColor, SOURCE_LABELS } from './provider-colors.ts'

/**
 * Build your own comparison.
 *
 * The curated `/compare/<a>-vs-<b>` pages only answer the two questions we
 * anticipated. This answers the reader's own: pick the models actually on your
 * shortlist and see them side by side. It is capped at three because the
 * comparison is a table of columns — a fourth stops fitting on a laptop, and
 * more than three candidates is a longlist, which the main table already does
 * better.
 */

export interface CompareBuilderProps {
  rows: PriceRowV1[]
  /** Curated head-to-heads, offered as starting points. */
  suggestions: Array<{ slug: string; label: string }>
}

export function CompareBuilder({ rows, suggestions }: CompareBuilderProps) {
  // Starts empty on both server and client; the URL is applied after mount so
  // the page itself stays statically cacheable.
  const [selected, setSelected] = useState<string[]>([])
  const [applied, setApplied] = useState(false)
  const [search, setSearch] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const byKey = useMemo(() => new Map(rows.map((row) => [modelKey(row), row])), [rows])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setSelected(decodeSelection(params.get('models')).filter((key) => byKey.has(key)))
    setApplied(true)
  }, [byKey])

  useEffect(() => {
    if (!applied) return
    const query = selected.length > 0 ? `?models=${encodeSelection(selected)}` : ''
    window.history.replaceState(null, '', `${window.location.pathname}${query}`)
  }, [applied, selected])

  const chosen = useMemo(
    () => selected.map((key) => byKey.get(key)).filter((row): row is PriceRowV1 => !!row),
    [selected, byKey],
  )

  const add = useCallback((key: string) => {
    setSelected((current) => {
      if (current.includes(key)) return current
      if (current.length >= MAX_COMPARED) {
        setNotice(`Comparing is capped at ${MAX_COMPARED} models. Remove one first.`)
        window.setTimeout(() => setNotice(null), 2600)
        return current
      }
      setNotice(null)
      return [...current, key]
    })
    setSearch('')
  }, [])

  const remove = useCallback((key: string) => {
    setNotice(null)
    setSelected((current) => current.filter((entry) => entry !== key))
  }, [])

  const copyLink = useCallback(() => {
    const query = selected.length > 0 ? `?models=${encodeSelection(selected)}` : ''
    navigator.clipboard
      ?.writeText(`${window.location.origin}${window.location.pathname}${query}`)
      .catch(() => {})
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }, [selected])

  // Only search once there is something to search for: 200-odd models listed
  // under the box is a wall, not a picker.
  const matches = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return []
    return rows
      .filter((row) => {
        if (selected.includes(modelKey(row))) return false
        return `${row.display_name} ${row.model_id} ${row.provider_name}`
          .toLowerCase()
          .includes(query)
      })
      .slice(0, 12)
  }, [rows, search, selected])

  return (
    <div>
      <section className="mb-6 rounded-2xl border border-neutral-200 bg-white px-5 py-5">
        <h2 className="m-0 mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Pick up to {MAX_COMPARED} models
        </h2>

        <div className="mb-3 flex flex-wrap gap-2">
          {chosen.map((row) => (
            <span
              key={modelKey(row)}
              className="inline-flex items-center gap-2 rounded-full border border-emerald-600 bg-emerald-50 py-1 pl-3 pr-1 text-[13px] font-medium text-emerald-800"
            >
              <span
                className="inline-block h-2 w-2 shrink-0 rounded-full"
                style={{ background: providerColor(row.provider) }}
              />
              {row.display_name}
              <button
                type="button"
                onClick={() => remove(modelKey(row))}
                aria-label={`Remove ${row.display_name} from the comparison`}
                className="inline-flex h-6 w-6 items-center justify-center rounded-full text-emerald-700 hover:bg-emerald-100"
              >
                ×
              </button>
            </span>
          ))}
          {chosen.length === 0 && (
            <p className="m-0 text-[13px] text-neutral-500">
              Nothing selected yet — search below, or start from a suggested pairing.
            </p>
          )}
        </div>

        <label className="sr-only" htmlFor="compare-search">
          Search models to compare
        </label>
        <input
          id="compare-search"
          type="search"
          autoComplete="off"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={
            selected.length >= MAX_COMPARED
              ? `Remove one to add another`
              : 'Search by model, id or provider…'
          }
          disabled={selected.length >= MAX_COMPARED}
          className="min-h-[44px] w-full rounded-lg border border-neutral-200 bg-white px-3 text-sm text-neutral-900 outline-none placeholder:text-neutral-400 focus-visible:ring-2 focus-visible:ring-emerald-600 disabled:bg-neutral-50 disabled:text-neutral-400"
        />

        {matches.length > 0 && (
          <ul className="mt-2 max-h-72 overflow-y-auto rounded-lg border border-neutral-200 p-0">
            {matches.map((row) => (
              <li
                key={modelKey(row)}
                className="list-none border-b border-neutral-100 last:border-0"
              >
                <button
                  type="button"
                  onClick={() => add(modelKey(row))}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-neutral-50"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[14px] font-medium text-neutral-900">
                      {row.display_name}
                    </span>
                    <span className="block truncate text-[12px] text-neutral-500">
                      {row.provider_name} · {row.model_id}
                    </span>
                  </span>
                  <span className="shrink-0 text-[13px] tabular-nums text-neutral-600">
                    {formatPrice(row.input)} in
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {notice && (
          <p role="status" className="mt-2 text-[13px] font-medium text-amber-700">
            {notice}
          </p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={copyLink}
            disabled={selected.length === 0}
            className="min-h-9 rounded-lg bg-emerald-600 px-3.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:bg-neutral-200 disabled:text-neutral-500"
          >
            {copied ? 'Copied!' : 'Copy link'}
          </button>
          {selected.length > 0 && (
            <button
              type="button"
              onClick={() => setSelected([])}
              className="min-h-9 rounded-lg border border-neutral-200 bg-white px-3.5 text-sm font-medium text-neutral-700 hover:border-neutral-300"
            >
              Clear
            </button>
          )}
        </div>
      </section>

      {chosen.length < 2 ? (
        <EmptyState suggestions={suggestions} />
      ) : (
        <>
          <SpecTable rows={chosen} />
          <ScenarioTable rows={chosen} />
          <Descriptions rows={chosen} />
        </>
      )}
    </div>
  )
}

function EmptyState({ suggestions }: { suggestions: Array<{ slug: string; label: string }> }) {
  return (
    <section className="rounded-2xl border border-dashed border-neutral-300 bg-white px-5 py-8 text-center">
      <p className="m-0 text-[15px] text-neutral-700">
        Choose at least two models to see them side by side.
      </p>
      {suggestions.length > 0 && (
        <>
          <p className="mt-4 mb-2 text-[12.5px] uppercase tracking-wide text-neutral-400">
            Or read a written comparison
          </p>
          <ul className="flex flex-wrap justify-center gap-2 p-0">
            {suggestions.map((suggestion) => (
              <li key={suggestion.slug} className="list-none">
                <Link
                  href={`/compare/${suggestion.slug}`}
                  className="inline-block rounded-full border border-neutral-200 bg-white px-3.5 py-1.5 text-[13px] font-medium text-neutral-700 hover:border-emerald-600 hover:text-emerald-700"
                >
                  {suggestion.label}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

/**
 * One row per fact, one column per model.
 *
 * Facts as rows rather than models as rows is what makes a comparison
 * readable: the eye scans one line to see three input prices, instead of
 * hunting the same cell across three blocks.
 */
function SpecTable({ rows }: { rows: PriceRowV1[] }) {
  const specs: Array<{
    label: string
    value: (row: PriceRowV1) => string
    /** Lower or higher wins; null means no winner worth marking. */
    best?: (row: PriceRowV1) => number | null
    prefer?: 'low' | 'high'
  }> = [
    {
      label: 'Input / 1M',
      value: (row) => formatPrice(row.input),
      best: (row) => row.input,
      prefer: 'low',
    },
    {
      label: 'Cached input / 1M',
      value: (row) => formatPrice(row.cached_input),
      best: (row) => row.cached_input,
      prefer: 'low',
    },
    {
      label: 'Output / 1M',
      value: (row) => formatPrice(row.output),
      best: (row) => row.output,
      prefer: 'low',
    },
    {
      label: 'Blended / 1M',
      value: (row) => formatPrice(blendedPrice(row.input, row.output)),
      best: (row) => blendedPrice(row.input, row.output),
      prefer: 'low',
    },
    {
      label: 'Context window',
      value: (row) => formatContext(row.context_window),
      best: (row) => row.context_window,
      prefer: 'high',
    },
    {
      label: 'Max output',
      value: (row) => formatContext(row.max_output_tokens),
      best: (row) => row.max_output_tokens,
      prefer: 'high',
    },
    {
      label: 'Long-context tier',
      value: (row) =>
        row.long_context_threshold !== null && row.long_input !== null
          ? `${formatPrice(row.long_input)} over ${formatContext(row.long_context_threshold)}`
          : 'None published',
    },
    {
      label: 'Source',
      value: (row) => SOURCE_LABELS[row.source_kind] ?? row.source_kind,
    },
    { label: 'Last confirmed', value: (row) => formatRelativeTime(row.updated_at) },
  ]

  return (
    <section className="mb-8">
      <h2 className="mb-3 text-xl font-semibold tracking-tight text-neutral-950">Side by side</h2>
      <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <caption className="sr-only">
            Specifications and prices for {rows.map((row) => row.display_name).join(', ')}
          </caption>
          <thead>
            <tr className="border-b border-neutral-200">
              <th
                scope="col"
                className="px-4 py-3 text-left text-xs font-semibold text-neutral-500"
              >
                Attribute
              </th>
              {rows.map((row) => (
                <th key={modelKey(row)} scope="col" className="px-4 py-3 text-right">
                  <Link
                    href={modelPath(row.provider, row.model_id)}
                    className="text-[15px] font-semibold text-neutral-900 underline-offset-2 hover:text-emerald-700 hover:underline"
                  >
                    {row.display_name}
                  </Link>
                  <span className="mt-0.5 flex items-center justify-end gap-1.5 text-[12px] font-normal text-neutral-500">
                    <span
                      className="inline-block h-2 w-2 shrink-0 rounded-full"
                      style={{ background: providerColor(row.provider) }}
                    />
                    <Link
                      href={providerPath(row.provider)}
                      className="underline-offset-2 hover:text-neutral-800 hover:underline"
                    >
                      {row.provider_name}
                    </Link>
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {specs.map((spec) => {
              const winners = spec.best
                ? bestKeys(rows, spec.best, spec.prefer ?? 'low')
                : new Set<string>()
              return (
                <tr key={spec.label} className="border-b border-neutral-100 last:border-0">
                  <th scope="row" className="px-4 py-3 text-left font-medium text-neutral-700">
                    {spec.label}
                  </th>
                  {rows.map((row) => (
                    <td
                      key={modelKey(row)}
                      className={`px-4 py-3 text-right tabular-nums ${
                        winners.has(modelKey(row))
                          ? 'font-semibold text-emerald-700'
                          : 'text-neutral-800'
                      }`}
                    >
                      {spec.value(row)}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[12.5px] text-neutral-500">
        Green marks the best value in a row. A tie marks every model that ties, and a row where only
        one model publishes a figure marks nothing — one number is not a comparison.
      </p>
    </section>
  )
}

/**
 * Which model wins a row.
 *
 * Returns nothing when fewer than two models published a comparable figure:
 * highlighting the only model that stated a number rewards disclosure rather
 * than price, which is the opposite of what the colour is meant to say.
 */
function bestKeys(
  rows: PriceRowV1[],
  value: (row: PriceRowV1) => number | null,
  prefer: 'low' | 'high',
): Set<string> {
  const scored = rows
    .map((row) => ({ key: modelKey(row), value: value(row) }))
    .filter((entry): entry is { key: string; value: number } => entry.value !== null)

  if (scored.length < 2) return new Set()

  const best = scored.reduce(
    (winner, entry) =>
      prefer === 'low' ? Math.min(winner, entry.value) : Math.max(winner, entry.value),
    scored[0].value,
  )
  return new Set(scored.filter((entry) => entry.value === best).map((entry) => entry.key))
}

/**
 * The part a price list cannot answer: which model is cheaper depends on the
 * shape of the requests, and it genuinely flips between these three.
 */
function ScenarioTable({ rows }: { rows: PriceRowV1[] }) {
  const priced = COMPARISON_SCENARIOS.map((scenario) => {
    const costs = rows.map((row) => ({
      key: modelKey(row),
      row,
      // A model with no output price cannot serve a generating workload at
      // all; pricing it at zero would rank it cheapest.
      cost: unusableReason(row, scenario.output) ? null : scenarioCost(row, scenario),
    }))
    const usable = costs.filter(
      (entry): entry is typeof entry & { cost: number } => entry.cost !== null,
    )
    const cheapest = usable.length >= 2 ? Math.min(...usable.map((entry) => entry.cost)) : null
    const priciest = usable.length >= 2 ? Math.max(...usable.map((entry) => entry.cost)) : null
    const ratio =
      cheapest !== null && priciest !== null && cheapest > 0 ? priciest / cheapest : null
    return { scenario, costs, cheapest, ratio }
  })

  return (
    <section className="mb-8">
      <h2 className="mb-1 text-xl font-semibold tracking-tight text-neutral-950">
        Which is cheaper depends on the workload
      </h2>
      <p className="mb-3 text-[14px] leading-relaxed text-neutral-600">
        Estimated monthly cost at list price for three common request shapes.
      </p>
      <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <caption className="sr-only">
            Estimated monthly cost per workload for {rows.map((row) => row.display_name).join(', ')}
          </caption>
          <thead>
            <tr className="border-b border-neutral-200 text-xs font-semibold text-neutral-500">
              <th scope="col" className="px-4 py-2.5 text-left">
                Workload
              </th>
              {rows.map((row) => (
                <th key={modelKey(row)} scope="col" className="px-4 py-2.5 text-right">
                  {row.display_name}
                </th>
              ))}
              <th scope="col" className="px-4 py-2.5 text-left">
                Spread
              </th>
            </tr>
          </thead>
          <tbody>
            {priced.map(({ scenario, costs, cheapest, ratio }) => (
              <tr key={scenario.label} className="border-b border-neutral-100 last:border-0">
                <th scope="row" className="px-4 py-3 text-left font-medium text-neutral-800">
                  {scenario.label}
                  <span className="block text-[12px] font-normal text-neutral-500">
                    {scenario.input.toLocaleString('en-US')} in /{' '}
                    {scenario.output.toLocaleString('en-US')} out ×{' '}
                    {scenario.requests.toLocaleString('en-US')}/mo
                  </span>
                </th>
                {costs.map((entry) => (
                  <td
                    key={entry.key}
                    className={`px-4 py-3 text-right tabular-nums ${
                      entry.cost !== null && entry.cost === cheapest
                        ? 'font-semibold text-emerald-700'
                        : 'text-neutral-700'
                    }`}
                  >
                    {formatCostShort(entry.cost)}
                  </td>
                ))}
                <td className="px-4 py-3 text-[13px] text-neutral-600">
                  {ratio !== null ? `${ratio.toFixed(1)}× between them` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[12.5px] text-neutral-500">
        Excludes caching discounts, so real bills with repeated prompts are lower.{' '}
        <Link href="/calculator" className="text-emerald-700 underline underline-offset-2">
          Price your own workload →
        </Link>
      </p>
    </section>
  )
}

/** What each model actually is, in the words of whoever published it. */
function Descriptions({ rows }: { rows: PriceRowV1[] }) {
  const described = rows.filter((row) => row.description)
  if (described.length === 0) return null

  return (
    <section className="mb-8">
      <h2 className="mb-3 text-xl font-semibold tracking-tight text-neutral-950">
        What each one is for
      </h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {described.map((row) => (
          <article
            key={modelKey(row)}
            className="rounded-xl border border-neutral-200 bg-white px-5 py-4"
          >
            <h3 className="m-0 text-[15px] font-semibold text-neutral-900">{row.display_name}</h3>
            <p className="m-0 mt-1.5 text-[13.5px] leading-relaxed text-neutral-700">
              {row.description}
            </p>
          </article>
        ))}
      </div>
      <p className="mt-2 text-[12.5px] text-neutral-500">
        Descriptions come from the vendor or catalogue that published them, unedited. Models with no
        published description are omitted.
      </p>
    </section>
  )
}
