'use client'

import { useState } from 'react'
import { MAX_FEATURED } from '../../data/featured.ts'
import { blendedPrice, formatContext, formatPrice } from '@/lib/format.ts'
import { PriceTriple } from './model-card.tsx'
import type { ExplorerRow } from './price-explorer.tsx'
import { providerColor, SOURCE_LABELS } from './provider-colors.ts'

/** Cards shown before "Show all". Enough to scan at a glance on a phone. */
const MOBILE_PREVIEW = 6

/**
 * The shortcut panel above the full table.
 *
 * Deliberately narrower than the main table — model, provider, the two prices
 * that matter, and context. Someone arriving cold wants "what do the models I
 * have heard of cost", not nine columns across 216 rows.
 *
 * On a phone that narrower table still overflowed, and output price — half the
 * comparison — sat off the right edge where nobody scrolled to find it. Below
 * `sm` the same rows render as cards instead.
 */
export function FeaturedModels({
  rows,
  isCustom,
  onUnpin,
  onReset,
}: {
  rows: ExplorerRow[]
  isCustom: boolean
  onUnpin: (modelId: string) => void
  onReset: () => void
}) {
  const [showAll, setShowAll] = useState(false)
  const preview = showAll ? rows : rows.slice(0, MOBILE_PREVIEW)
  const hidden = rows.length - preview.length

  return (
    <section className="mb-4 rounded-2xl border border-neutral-200 bg-white px-4 py-4 sm:px-6 sm:py-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="m-0 text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Popular models
        </h2>
        <p className="m-0 text-[12px] text-neutral-400">
          {isCustom ? (
            <>
              Your selection ({rows.length}/{MAX_FEATURED}) ·{' '}
              <button
                type="button"
                onClick={onReset}
                className="font-medium text-emerald-700 underline underline-offset-2 hover:text-emerald-800"
              >
                Reset to defaults
              </button>
            </>
          ) : (
            <>A starting set — star any row below to build your own</>
          )}
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-neutral-500">
          No models pinned.{' '}
          <button
            type="button"
            onClick={onReset}
            className="font-medium text-emerald-700 underline underline-offset-2"
          >
            Restore the defaults
          </button>{' '}
          or star rows in the table below.
        </p>
      ) : (
        <>
          {/* Cards below `sm`, where the table cannot fit without hiding a price. */}
          <ul className="flex flex-col gap-2 p-0 sm:hidden">
            {preview.map((row) => (
              <li
                key={`${row.provider}/${row.model_id}`}
                className="list-none overflow-hidden rounded-xl border border-neutral-200"
              >
                <div className="flex items-start gap-2 px-2.5 pt-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-[15px] font-semibold leading-snug text-neutral-900">
                      {row.display_name}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[12.5px] text-neutral-600">
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          className="inline-block h-2 w-2 shrink-0 rounded-full"
                          style={{ background: providerColor(row.provider) }}
                        />
                        {row.provider_name}
                      </span>
                      <span aria-hidden className="text-neutral-300">
                        ·
                      </span>
                      <span className="tabular-nums">
                        {formatContext(row.context_window)} context
                      </span>
                      {row.source_kind !== 'scrape' && (
                        <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
                          {SOURCE_LABELS[row.source_kind]}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onUnpin(row.model_id)}
                    aria-label={`Remove ${row.display_name} from popular models`}
                    title="Remove"
                    className="-mr-1 -mt-1 inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-neutral-300 hover:text-neutral-600 focus-visible:outline-2 focus-visible:outline-emerald-600"
                  >
                    ✕
                  </button>
                </div>
                <PriceTriple
                  input={row.input}
                  output={row.output}
                  blended={blendedPrice(row.input, row.output)}
                />
              </li>
            ))}
          </ul>

          {hidden > 0 && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="mt-2 min-h-[44px] w-full rounded-xl border border-neutral-200 text-sm font-semibold text-neutral-700 sm:hidden"
            >
              Show all {rows.length}
            </button>
          )}

          {/* The compact table is fine from `sm` up and stays denser to scan. */}
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full min-w-[560px] border-collapse text-sm">
              <caption className="sr-only">Pinned models, USD per million tokens</caption>
              <thead>
                <tr className="border-b border-neutral-200 text-left text-xs font-semibold text-neutral-500">
                  <th scope="col" className="py-2 pr-3">
                    Model
                  </th>
                  <th scope="col" className="py-2 pr-3">
                    Provider
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right">
                    Input /1M
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right">
                    Output /1M
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right">
                    Context
                  </th>
                  <th scope="col" className="w-8 py-2">
                    <span className="sr-only">Remove</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={`${row.provider}/${row.model_id}`}
                    className="border-b border-neutral-100"
                  >
                    <td className="py-2.5 pr-3">
                      <span className="font-semibold text-neutral-900">{row.display_name}</span>
                      {row.source_kind !== 'scrape' && (
                        <span className="ml-2 text-[11px] text-neutral-400">
                          {SOURCE_LABELS[row.source_kind]}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap py-2.5 pr-3">
                      <span className="inline-flex items-center gap-1.5 text-[13px] text-neutral-700">
                        <span
                          className="inline-block h-2 w-2 shrink-0 rounded-full"
                          style={{ background: providerColor(row.provider) }}
                        />
                        {row.provider_name}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 text-right font-semibold tabular-nums text-neutral-900">
                      {formatPrice(row.input)}
                    </td>
                    <td className="py-2.5 pr-3 text-right font-semibold tabular-nums text-neutral-900">
                      {formatPrice(row.output)}
                    </td>
                    <td className="whitespace-nowrap py-2.5 pr-3 text-right tabular-nums text-neutral-700">
                      {formatContext(row.context_window)}
                    </td>
                    <td className="py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => onUnpin(row.model_id)}
                        aria-label={`Remove ${row.display_name} from popular models`}
                        title="Remove"
                        className="rounded px-1 text-neutral-300 hover:text-neutral-600 focus-visible:outline-2 focus-visible:outline-emerald-600"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}
