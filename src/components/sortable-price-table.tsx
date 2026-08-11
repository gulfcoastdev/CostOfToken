'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { blendedPrice, formatContext, formatPrice } from '@/lib/format.ts'
import { modelPath } from '@/lib/seo.ts'
import type { PriceRowV1 } from '@/lib/types.ts'
import { providerColor, SOURCE_LABELS } from './provider-colors.ts'

/**
 * The shared pricing table.
 *
 * Provider pages previously hand-rolled their own static markup, which meant
 * the same table existed twice with different behaviour — and the version
 * people landed on from search couldn't be sorted at all.
 *
 * It is a client component, but Next renders it to HTML on the server first,
 * so every row and price is present for crawlers on the initial response.
 * Sorting is progressive enhancement layered on top of complete markup, not a
 * prerequisite for seeing the data.
 */

export type PriceColumn = 'model' | 'provider' | 'input' | 'cached' | 'output' | 'blended' | 'context'

/**
 * `source` is the order the provider itself lists models in on its pricing
 * page, captured during extraction. Vendors put their newest and most
 * important models first, so this is the honest default — it surfaces what
 * matters without us inventing an importance ranking from price.
 */
export type SortKey = PriceColumn | 'source'

const DEFAULT_COLUMNS: PriceColumn[] = ['model', 'input', 'cached', 'output', 'context']

const HEADINGS: Record<PriceColumn, { label: string; numeric: boolean }> = {
  model: { label: 'Model', numeric: false },
  provider: { label: 'Provider', numeric: false },
  input: { label: 'Input /1M', numeric: true },
  cached: { label: 'Cached /1M', numeric: true },
  output: { label: 'Output /1M', numeric: true },
  blended: { label: 'Blended /1M', numeric: true },
  context: { label: 'Context', numeric: true },
}

type Direction = 'asc' | 'desc'

export function SortablePriceTable({
  rows,
  columns = DEFAULT_COLUMNS,
  initialSort = 'source',
  caption,
}: {
  /** Already ordered as the provider lists them; `source` sorting restores this. */
  rows: PriceRowV1[]
  columns?: PriceColumn[]
  initialSort?: SortKey
  caption: string
}) {
  const [sort, setSort] = useState<SortKey>(initialSort)
  const [direction, setDirection] = useState<Direction>('asc')

  const sorted = useMemo(() => {
    // `rows` arrives in the provider's own order, so restoring it is just the
    // identity — no stored rank has to travel to the client.
    if (sort === 'source') return direction === 'asc' ? rows : [...rows].reverse()

    const factor = direction === 'asc' ? 1 : -1

    // Missing values sort last in both directions rather than clumping at the
    // top of an ascending sort, where they'd read as "cheapest".
    const numeric = (value: number | null) =>
      value === null ? Number.POSITIVE_INFINITY : value

    return [...rows].sort((a, b) => {
      switch (sort) {
        case 'model':
          return factor * a.display_name.localeCompare(b.display_name)
        case 'provider':
          return (
            factor * (a.provider_name.localeCompare(b.provider_name) ||
              a.display_name.localeCompare(b.display_name))
          )
        case 'cached':
          return factor * (numeric(a.cached_input) - numeric(b.cached_input))
        case 'output':
          return factor * (numeric(a.output) - numeric(b.output))
        case 'blended':
          return factor * (numeric(blendedPrice(a.input, a.output)) - numeric(blendedPrice(b.input, b.output)))
        case 'context':
          // Bigger context is the more useful answer, so this one leads with
          // the largest when first clicked.
          return -factor * ((a.context_window ?? -1) - (b.context_window ?? -1))
        default:
          return factor * (numeric(a.input) - numeric(b.input))
      }
    })
  }, [rows, sort, direction])

  const toggle = (column: SortKey) => {
    if (column === sort) {
      setDirection((current) => (current === 'asc' ? 'desc' : 'asc'))
    } else {
      setSort(column)
      setDirection('asc')
    }
  }

  const ariaSort = (column: SortKey): 'ascending' | 'descending' | 'none' =>
    sort === column ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'

  return (
    <div>
      <p className="mb-2 text-[12.5px] text-neutral-500">
        {sort === 'source' ? (
          <>Listed in the order {rows[0]?.provider_name ?? 'the provider'} publishes them.</>
        ) : (
          <>
            Sorted by {HEADINGS[sort as PriceColumn].label.toLowerCase()} ·{' '}
            <button
              type="button"
              onClick={() => {
                setSort('source')
                setDirection('asc')
              }}
              className="font-medium text-emerald-700 underline underline-offset-2 hover:text-emerald-800"
            >
              back to provider order
            </button>
          </>
        )}
      </p>
      <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
      <table className="w-full min-w-[720px] border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-neutral-200">
            {columns.map((column) => {
              const heading = HEADINGS[column]
              const active = sort === column
              return (
                <th
                  key={column}
                  scope="col"
                  aria-sort={ariaSort(column)}
                  className={`bg-white px-3 py-2.5 text-xs font-semibold whitespace-nowrap ${
                    heading.numeric ? 'text-right' : 'text-left'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => toggle(column)}
                    className={`inline-flex items-center gap-1 rounded transition-colors focus-visible:outline-2 focus-visible:outline-emerald-600 ${
                      active ? 'text-emerald-700' : 'text-neutral-500 hover:text-neutral-800'
                    }`}
                  >
                    {heading.label}
                    <span aria-hidden="true" className="text-[10px] leading-none">
                      {active ? (direction === 'asc' ? '▲' : '▼') : '↕'}
                    </span>
                  </button>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={`${row.provider}/${row.model_id}`} className="border-b border-neutral-100 last:border-0">
              {columns.map((column) => (
                <Cell key={column} column={column} row={row} />
              ))}
            </tr>
          ))}
        </tbody>
        </table>
      </div>
    </div>
  )
}

function Cell({ column, row }: { column: PriceColumn; row: PriceRowV1 }) {
  switch (column) {
    case 'model':
      return (
        <th scope="row" className="px-3 py-2.5 text-left font-medium">
          <Link
            href={modelPath(row.provider, row.model_id)}
            className="font-semibold text-neutral-900 underline underline-offset-2 hover:text-emerald-700"
          >
            {row.display_name}
          </Link>
          {row.source_kind !== 'scrape' && (
            <span className="ml-2 text-[11px] font-normal text-neutral-400">
              {SOURCE_LABELS[row.source_kind]}
            </span>
          )}
        </th>
      )
    case 'provider':
      return (
        <td className="whitespace-nowrap px-3 py-2.5">
          <span className="inline-flex items-center gap-1.5 text-[13px] text-neutral-700">
            <span
              className="inline-block h-2 w-2 shrink-0 rounded-full"
              style={{ background: providerColor(row.provider) }}
            />
            {row.provider_name}
          </span>
        </td>
      )
    case 'cached':
      return (
        <td className="px-3 py-2.5 text-right tabular-nums text-neutral-700">
          {formatPrice(row.cached_input)}
        </td>
      )
    case 'output':
      return (
        <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-neutral-900">
          {formatPrice(row.output)}
        </td>
      )
    case 'blended':
      return (
        <td className="px-3 py-2.5 text-right tabular-nums text-neutral-700">
          {formatPrice(blendedPrice(row.input, row.output))}
        </td>
      )
    case 'context':
      return (
        <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-neutral-700">
          {formatContext(row.context_window)}
        </td>
      )
    default:
      return (
        <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-neutral-900">
          {formatPrice(row.input)}
        </td>
      )
  }
}
