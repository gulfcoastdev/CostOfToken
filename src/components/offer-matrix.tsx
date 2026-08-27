import Link from 'next/link'
import { formatPrice } from '@/lib/format.ts'
import type { MatrixColumn, MatrixRow } from '@/lib/queries.ts'
import { modelPath } from '@/lib/seo.ts'

/**
 * 015: the home-page matrix — a few popular models as rows, sellers as
 * columns, input/output per cell, cheapest displayed cell highlighted.
 * The point of the whole product in one glance: the same model, different
 * bill depending on the door you walk through.
 */

const COLUMN_LABELS: Record<MatrixColumn, string> = {
  'first-party': 'First-party',
  openrouter: 'OpenRouter',
  together: 'Together AI',
  deepinfra: 'DeepInfra',
}

const COLUMNS: MatrixColumn[] = ['first-party', 'openrouter', 'together', 'deepinfra']

export function OfferMatrix({ rows }: { rows: MatrixRow[] }) {
  if (rows.length === 0) return null

  return (
    <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
      <table className="w-full min-w-[760px] border-collapse text-sm">
        <caption className="sr-only">
          Input and output price per 1M tokens for popular models across sellers
        </caption>
        <thead>
          <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
            <th className="px-4 py-3 font-medium">Model</th>
            {COLUMNS.map((column) => (
              <th key={column} className="px-4 py-3 font-medium">
                {COLUMN_LABELS[column]}
                <span className="block text-[10px] font-normal normal-case text-neutral-400">
                  in / out per 1M
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.slug} className="border-b border-neutral-100 last:border-0">
              <td className="px-4 py-3 font-medium text-neutral-900">{row.displayName}</td>
              {COLUMNS.map((column) => {
                const cell = row.cells[column]
                if (!cell) {
                  return (
                    <td key={column} className="px-4 py-3 text-neutral-300">
                      —
                    </td>
                  )
                }
                const cheapest = row.cheapest === column
                return (
                  <td
                    key={column}
                    className={`px-4 py-3 tabular-nums ${cheapest ? 'bg-emerald-50/70' : ''}`}
                  >
                    <Link
                      href={modelPath(cell.providerSlug, cell.modelId)}
                      className="underline-offset-2 hover:underline"
                    >
                      {formatPrice(cell.inputPrice)} / {formatPrice(cell.outputPrice)}
                    </Link>
                    {cheapest ? (
                      <span className="ml-1.5 rounded bg-emerald-600 px-1 py-0.5 text-[10px] font-semibold text-white">
                        cheapest
                      </span>
                    ) : null}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
