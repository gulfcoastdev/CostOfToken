'use client'

import Link from 'next/link'
import { useMemo } from 'react'
import { blendedPrice, formatContext, formatPrice } from '@/lib/format.ts'
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

export type PriceColumn =
  'model' | 'provider' | 'input' | 'cached' | 'output' | 'blended' | 'context'

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

/**
 * Context leads with the largest window on first click; every price column
 * leads with the cheapest. `source` is already in the provider's own order.
 */
function defaultDirection(key: SortKey): SortDirection {
  return key === 'context' ? 'desc' : 'asc'
}

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
  const sortState = useSortState<SortKey>(initialSort, defaultDirection)
  const { key: sort, direction, set: setSort } = sortState

  const sorted = useMemo(() => {
    // `rows` arrives in the provider's own order, so restoring it is just the
    // identity — no stored rank has to travel to the client.
    if (sort === 'source') return direction === 'asc' ? rows : [...rows].reverse()

    return [...rows].sort((a, b) => {
      switch (sort) {
        case 'model':
          return compareText(a.display_name, b.display_name, direction)
        case 'provider':
          return (
            compareText(a.provider_name, b.provider_name, direction) ||
            compareText(a.display_name, b.display_name, 'asc')
          )
        case 'cached':
          return compareNullableNumbers(a.cached_input, b.cached_input, direction)
        case 'output':
          return compareNullableNumbers(a.output, b.output, direction)
        case 'blended':
          return compareNullableNumbers(
            blendedPrice(a.input, a.output),
            blendedPrice(b.input, b.output),
            direction,
          )
        case 'context':
          return compareNullableNumbers(a.context_window, b.context_window, direction)
        default:
          return compareNullableNumbers(a.input, b.input, direction)
      }
    })
  }, [rows, sort, direction])

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
              onClick={() => setSort('source', 'asc')}
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
              {columns.map((column) => (
                <SortHeader
                  key={column}
                  column={column}
                  label={HEADINGS[column].label}
                  numeric={HEADINGS[column].numeric}
                  sort={sortState}
                  className="bg-white px-3 py-2.5 text-xs font-semibold whitespace-nowrap"
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr
                key={`${row.provider}/${row.model_id}`}
                className="border-b border-neutral-100 last:border-0"
              >
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
