'use client'

import { useCallback, useState } from 'react'

/**
 * Column sorting, shared by every data table on the site.
 *
 * Each table used to decide for the reader: the home table sorted from a
 * dropdown, the calculator sorted by cost and nothing else, and the provider
 * table had its own copy of this logic. Clicking a heading is what people try
 * first, so it lives in one place and behaves the same everywhere — including
 * the `aria-sort` announcement, which is easy to get subtly wrong per copy.
 */

export type SortDirection = 'asc' | 'desc'

export interface SortState<Key extends string> {
  key: Key
  direction: SortDirection
  /** Sort by a column, or flip direction when it is already the active one. */
  toggle: (key: Key) => void
  set: (key: Key, direction: SortDirection) => void
}

/**
 * `defaultDirection` decides which way a column sorts on its *first* click.
 * Prices read best cheapest-first; context windows read best largest-first.
 * Guessing one rule for both means half the columns need two clicks to say
 * anything useful.
 */
export function useSortState<Key extends string>(
  initialKey: Key,
  defaultDirection: (key: Key) => SortDirection = () => 'asc',
): SortState<Key> {
  const [key, setKey] = useState<Key>(initialKey)
  const [direction, setDirection] = useState<SortDirection>(defaultDirection(initialKey))

  const toggle = useCallback(
    (next: Key) => {
      setKey((current) => {
        if (current === next) {
          setDirection((d) => (d === 'asc' ? 'desc' : 'asc'))
        } else {
          setDirection(defaultDirection(next))
        }
        return next
      })
    },
    [defaultDirection],
  )

  const set = useCallback((nextKey: Key, nextDirection: SortDirection) => {
    setKey(nextKey)
    setDirection(nextDirection)
  }, [])

  return { key, direction, toggle, set }
}

/**
 * Compare two possibly-absent numbers.
 *
 * Missing values sort last in *both* directions rather than flipping to the
 * top when the direction flips — at the top of an ascending price sort a null
 * reads as "cheapest", which is the opposite of what it means.
 */
export function compareNullableNumbers(
  a: number | null | undefined,
  b: number | null | undefined,
  direction: SortDirection,
): number {
  const missingA = a === null || a === undefined
  const missingB = b === null || b === undefined
  if (missingA && missingB) return 0
  if (missingA) return 1
  if (missingB) return -1
  return direction === 'asc' ? a - b : b - a
}

export function compareText(a: string, b: string, direction: SortDirection): number {
  return (direction === 'asc' ? 1 : -1) * a.localeCompare(b)
}

/**
 * A sortable column heading.
 *
 * Renders the `<th>` itself so `aria-sort` cannot drift from the arrow a
 * sighted reader sees — the two have to agree, and they only do if one thing
 * decides both.
 */
export function SortHeader<Key extends string>({
  column,
  label,
  sort,
  numeric = false,
  className = '',
  title,
}: {
  column: Key
  label: string
  sort: SortState<Key>
  /** Right-aligns the cell, the convention for figures. */
  numeric?: boolean
  className?: string
  title?: string
}) {
  const active = sort.key === column

  return (
    <th
      scope="col"
      aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={`${numeric ? 'text-right' : 'text-left'} ${className}`}
    >
      <button
        type="button"
        onClick={() => sort.toggle(column)}
        title={title ?? `Sort by ${label.toLowerCase()}`}
        className={`inline-flex cursor-pointer items-center gap-1 rounded transition-colors focus-visible:outline-2 focus-visible:outline-emerald-600 ${
          active ? 'text-emerald-700' : 'text-neutral-500 hover:text-neutral-900'
        }`}
      >
        {label}
        {/* Always present, so a column never shifts width when it becomes the
            active one and the reader can see which headings are clickable. */}
        <span aria-hidden="true" className="text-[10px] leading-none">
          {active ? (sort.direction === 'asc' ? '▲' : '▼') : '↕'}
        </span>
      </button>
    </th>
  )
}
