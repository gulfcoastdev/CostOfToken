'use client'

import { MAX_FEATURED } from '../../data/featured.ts'
import { formatContext, formatPrice } from '@/lib/format.ts'
import type { ExplorerRow } from './price-explorer.tsx'
import { providerColor, SOURCE_LABELS } from './provider-colors.ts'

/**
 * The shortcut panel above the full table.
 *
 * Deliberately narrower than the main table — model, provider, the two prices
 * that matter, and context. Someone arriving cold wants "what do the models I
 * have heard of cost", not nine columns across 216 rows.
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
  return (
    <section className="mb-4 rounded-2xl border border-neutral-200 bg-white px-6 py-5">
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
        <div className="overflow-x-auto">
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
                <tr key={`${row.provider}/${row.model_id}`} className="border-b border-neutral-100">
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
      )}
    </section>
  )
}
