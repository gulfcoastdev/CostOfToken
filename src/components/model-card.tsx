'use client'

import { formatContext, formatPrice, formatRelativeTime } from '@/lib/format.ts'
import type { ExplorerRow } from './price-explorer.tsx'
import { providerColor, SOURCE_LABELS } from './provider-colors.ts'
import { Sparkline } from './sparkline.tsx'

/**
 * The card presentation of a model, used on narrow screens in place of the
 * table.
 *
 * A nine-column table cannot be made to fit a phone; squeezing it only trades
 * horizontal scrolling for truncation. A card drops the grid and stacks the
 * same facts, which means every price is visible without scrolling sideways —
 * the thing the table could never do.
 *
 * Both views render from the same `Entry`, and badges and details live here so
 * the two presentations cannot disagree about which model is best value or what
 * its source is.
 */

export interface CardEntry {
  row: ExplorerRow
  blended: number | null
  isFree: boolean
}

/** Comfortable minimum tap target. Below this, misses become common. */
const TAP_TARGET = 'min-h-[44px] min-w-[44px]'

export function StarButton({
  pinned,
  displayName,
  onToggle,
  className = '',
}: {
  pinned: boolean
  displayName: string
  onToggle: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation()
        onToggle()
      }}
      aria-pressed={pinned}
      aria-label={
        pinned
          ? `Remove ${displayName} from popular models`
          : `Add ${displayName} to popular models`
      }
      title={pinned ? 'Remove from Popular models' : 'Add to Popular models'}
      className={`inline-flex shrink-0 items-center justify-center rounded-lg text-lg leading-none focus-visible:outline-2 focus-visible:outline-emerald-600 ${
        pinned ? 'text-amber-500' : 'text-neutral-300 hover:text-neutral-500'
      } ${className}`}
    >
      {pinned ? '★' : '☆'}
    </button>
  )
}

/**
 * Badges, in a fixed order of importance.
 *
 * Free and Best value are mutually exclusive by construction: free models are
 * excluded from the value ranking, because three $0 models would otherwise own
 * it permanently.
 */
export function ModelBadges({
  row,
  isFree,
  isTop,
}: {
  row: ExplorerRow
  isFree: boolean
  isTop: boolean
}) {
  const modalities = row.modality.filter((value) => value !== 'text')
  const badges: Array<{ key: string; label: string; className: string }> = []

  if (isFree)
    badges.push({
      key: 'free',
      label: 'Free',
      className: 'bg-sky-50 text-sky-700',
    })
  if (isTop)
    badges.push({
      key: 'top',
      label: 'Best value',
      className: 'bg-emerald-50 text-emerald-700',
    })
  if (row.tags.includes('flagship'))
    badges.push({
      key: 'flagship',
      label: 'Flagship',
      className: 'bg-violet-50 text-violet-700',
    })
  for (const modality of modalities) {
    badges.push({
      key: `modality-${modality}`,
      label: modality[0].toUpperCase() + modality.slice(1),
      className: 'bg-neutral-100 text-neutral-600',
    })
  }
  if (row.source_kind !== 'scrape')
    badges.push({
      key: 'source',
      label: SOURCE_LABELS[row.source_kind] ?? row.source_kind,
      className: 'bg-amber-50 text-amber-700',
    })

  if (badges.length === 0) return null

  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {badges.map((badge) => (
        <span
          key={badge.key}
          className={`whitespace-nowrap rounded-full px-1.5 py-0.5 text-[10px] font-bold ${badge.className}`}
        >
          {badge.label}
        </span>
      ))}
    </div>
  )
}

export function ModelCard({
  entry,
  rank,
  pinned,
  onTogglePin,
  isBest,
  isTop,
  expanded,
  onToggle,
}: {
  entry: CardEntry
  rank: number
  pinned: boolean
  onTogglePin: (modelId: string) => void
  isBest: boolean
  isTop: boolean
  expanded: boolean
  onToggle: (modelId: string) => void
}) {
  const { row, blended, isFree } = entry
  const detailId = `card-detail-${row.provider}-${row.model_id}`

  return (
    <li
      className={`list-none overflow-hidden rounded-xl border ${
        isBest ? 'border-emerald-200 bg-emerald-50/40' : 'border-neutral-200 bg-white'
      }`}
    >
      {/* Tappable anywhere for pointer users; the name below is a real button
          so the same action is reachable and announced for keyboard users. */}
      <div
        className="flex items-start gap-1.5 px-2.5 pt-2.5"
        onClick={() => onToggle(row.model_id)}
      >
        <StarButton
          pinned={pinned}
          displayName={row.display_name}
          onToggle={() => onTogglePin(row.model_id)}
          className={TAP_TARGET}
        />

        <div className="min-w-0 flex-1 pt-2.5">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onToggle(row.model_id)
            }}
            aria-expanded={expanded}
            aria-controls={expanded ? detailId : undefined}
            className="block text-left text-[15px] font-semibold leading-snug text-neutral-900 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-emerald-600"
          >
            {row.display_name}
          </button>

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
            <span className="tabular-nums">{formatContext(row.context_window)} context</span>
          </div>

          <ModelBadges row={row} isFree={isFree} isTop={isTop} />
        </div>

        <span className="shrink-0 pt-3 text-[11px] tabular-nums text-neutral-400">#{rank}</span>
      </div>

      <PriceTriple input={row.input} output={row.output} blended={blended} />

      {expanded && (
        <div id={detailId} className="border-t border-neutral-100 bg-neutral-50 px-3 py-3">
          <ModelDetails row={row} />
        </div>
      )}
    </li>
  )
}

/**
 * The three prices that matter, labelled and side by side.
 *
 * Shared with the Popular models panel: output price being off the right edge
 * of a scrolling table was the specific thing that made that panel useless on a
 * phone, so both places render it from here.
 */
export function PriceTriple({
  input,
  output,
  blended,
}: {
  input: number | null
  output: number | null
  blended: number | null
}) {
  return (
    <dl className="mt-2.5 grid grid-cols-3 divide-x divide-neutral-100 border-t border-neutral-100">
      <CardPrice label="Input /1M" value={formatPrice(input)} />
      <CardPrice label="Output /1M" value={formatPrice(output)} />
      <CardPrice label="Blended /1M" value={formatPrice(blended)} accent />
    </dl>
  )
}

function CardPrice({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="px-2 py-2 text-center">
      <dt className="text-[10.5px] uppercase tracking-wide text-neutral-400">{label}</dt>
      <dd
        className={`m-0 mt-0.5 text-[15px] font-bold tabular-nums ${
          accent ? 'text-emerald-700' : 'text-neutral-900'
        }`}
      >
        {value}
      </dd>
    </div>
  )
}

/**
 * The expanded detail block, shared by the card and the table row.
 *
 * Kept in one place because it is the only view of cached pricing, long-context
 * pricing and the source link — a second copy would quietly diverge.
 */
export function ModelDetails({ row }: { row: ExplorerRow }) {
  const trend = row.trend
  const pctChange =
    trend && trend.series.length >= 2 && trend.series[0] > 0
      ? ((trend.series[trend.series.length - 1] - trend.series[0]) / trend.series[0]) * 100
      : 0
  const sparklineColor = pctChange < -0.5 ? '#059669' : pctChange > 0.5 ? '#DC2626' : '#A3A3A3'

  return (
    <div className="text-[13px] text-neutral-600">
      <div className="flex flex-wrap gap-x-8 gap-y-2">
        <span>
          <strong className="font-semibold text-neutral-800">Cached input:</strong>{' '}
          <span className="tabular-nums">{formatPrice(row.cached_input)}</span>
        </span>
        <span>
          <strong className="font-semibold text-neutral-800">Context:</strong>{' '}
          {formatContext(row.context_window)}
          {row.max_output_tokens ? ` · max output ${formatContext(row.max_output_tokens)}` : ''}
        </span>
        <span>
          <strong className="font-semibold text-neutral-800">Source:</strong>{' '}
          {row.source_url ? (
            <a
              href={row.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-emerald-700 underline underline-offset-2"
            >
              {SOURCE_LABELS[row.source_kind] ?? row.source_kind}
            </a>
          ) : (
            (SOURCE_LABELS[row.source_kind] ?? row.source_kind)
          )}
        </span>
        <span>
          <strong className="font-semibold text-neutral-800">API id:</strong>{' '}
          <code className="rounded bg-neutral-200 px-1 py-0.5 font-mono text-xs">
            {row.model_id}
          </code>
        </span>
        <span>
          <strong className="font-semibold text-neutral-800">Updated:</strong>{' '}
          {formatRelativeTime(row.updated_at)}
        </span>
      </div>

      {row.long_context_threshold !== null && row.long_input !== null && (
        <p className="mt-2">
          Over {formatContext(row.long_context_threshold)} tokens: input{' '}
          {formatPrice(row.long_input)}, output {formatPrice(row.long_output)} per 1M.
        </p>
      )}

      {row.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {row.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-neutral-200 px-2 py-0.5 text-[11px] text-neutral-700"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      <div className="mt-2.5 flex items-center gap-2.5">
        {trend && trend.series.length >= 2 && (
          <Sparkline series={trend.series} color={sparklineColor} />
        )}
        <span>{describeTrend(trend, pctChange)}</span>
      </div>
    </div>
  )
}

/**
 * Describe a model's price history in words.
 *
 * Net change and "did it move" are different questions: a price that rose and
 * fell back lands at 0% while having changed twice. Reporting that as
 * "up 0%" reads as a bug, so a round trip is called out as such.
 */
export function describeTrend(trend: ExplorerRow['trend'], pctChange: number): string {
  if (!trend || trend.changeCount === 0) {
    return 'No price change recorded since tracking began.'
  }

  const lastChanged = formatRelativeTime(trend.lastChangedAt)

  if (Math.abs(pctChange) < 0.5) {
    const times = trend.changeCount === 1 ? 'once' : `${trend.changeCount} times`
    return `Changed ${times} but net unchanged over 90 days · last changed ${lastChanged}.`
  }

  const direction = pctChange < 0 ? 'down' : 'up'
  return `Input price ${direction} ${Math.abs(Math.round(pctChange))}% over 90 days · last changed ${lastChanged}.`
}
