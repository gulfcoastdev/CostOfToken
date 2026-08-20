'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  blendedPrice,
  formatCompact,
  formatContext,
  formatCost,
  formatPrice,
  formatRelativeTime,
} from '@/lib/format.ts'
import { compareHref, MAX_COMPARED, modelKey } from '@/lib/compare.ts'
import { modelPath, providerPath } from '@/lib/seo.ts'
import { resolveTypeFilter, type PriceRowV1 } from '@/lib/types.ts'
import { DEFAULT_FEATURED_MODEL_IDS, MAX_FEATURED } from '../../data/featured.ts'
import { ModelCard, ModelDetails, opensElsewhere, StarButton } from './model-card.tsx'
import { providerColor, SOURCE_LABELS } from './provider-colors.ts'
import {
  compareNullableNumbers,
  compareText,
  SortHeader,
  useSortState,
  type SortDirection,
  type SortState,
} from './sort-header.tsx'
import { TrendChart } from './sparkline.tsx'

export interface ExplorerRow extends PriceRowV1 {
  trend: {
    series: number[]
    lastChangedAt: string | null
    changeCount: number
  } | null
}

export interface ProviderOption {
  slug: string
  name: string
}

export interface ExplorerProps {
  rows: ExplorerRow[]
  providers: ProviderOption[]
  updatedAt: string | null
  /** Valid provider slugs, used to discard junk from the URL. */
  providerSlugs: string[]
}

/** localStorage key for the user's pinned models. Versioned so the shape can change. */
const PINS_STORAGE_KEY = 'costoftoken.pins.v1'
/** Remembers an explicit Cards/Table choice, so power users keep the dense view. */
const VIEW_STORAGE_KEY = 'costoftoken.view.v1'

/**
 * How the model list is presented.
 *
 * `auto` is the default and is resolved by CSS at the `sm` breakpoint rather
 * than by JavaScript: cards below it, table above. Deciding in JS would need
 * the viewport width during render, which the server does not have, so the
 * first paint would be wrong and then flip.
 */
type ViewMode = 'auto' | 'cards' | 'table'

/** Cards rendered before "Show more". 216 at once is a long scroll and a lot of DOM. */
const CARD_PAGE = 40

export interface InitialFilters {
  providers: string[]
  flagship: boolean
  under1: boolean
  million: boolean
  search: string
  sort: SortKey
  direction: SortDirection
  /** Pinned model ids from the URL, or null to fall back to storage/defaults. */
  pins: string[] | null
}

/**
 * `value` is the blended-price ranking the page opens on, and is what the
 * Blended column sorts by — one key rather than two, so the column and the
 * dropdown can never disagree about what "best value" means.
 */
type SortKey = 'value' | 'model' | 'provider' | 'input' | 'cached' | 'output' | 'context'

const SORT_LABELS: Array<{ value: SortKey; label: string }> = [
  { value: 'value', label: 'Sort: Best value' },
  { value: 'input', label: 'Sort: Lowest input' },
  { value: 'cached', label: 'Sort: Lowest cached' },
  { value: 'output', label: 'Sort: Lowest output' },
  { value: 'context', label: 'Sort: Largest context' },
  { value: 'model', label: 'Sort: Model A–Z' },
  { value: 'provider', label: 'Sort: Provider A–Z' },
]

/**
 * Which way a column sorts on its first click. Prices are most useful
 * cheapest-first; a context window is most useful largest-first.
 */
function defaultDirection(key: SortKey): SortDirection {
  return key === 'context' ? 'desc' : 'asc'
}

/** Approximate token counts, for illustrating what an average prompt costs. */
const FUN_ITEMS = [
  { label: 'The Bible, cover to cover', tokens: 1_000_000 },
  { label: 'The Harry Potter series (all 7 books)', tokens: 1_500_000 },
  { label: 'All of English Wikipedia', tokens: 6_400_000_000 },
]

const SORT_KEYS: SortKey[] = SORT_LABELS.map((option) => option.value)

/**
 * Human names for the model kinds, and the wording used when a type's prices
 * are not comparable to chat prices — which is most of them: embeddings and
 * moderation models have no output price at all, and image or speech models
 * are often billed per image or per second rather than per token.
 */
const TYPE_LABELS: Record<string, string> = {
  general: 'General / chat',
  embedding: 'Embeddings',
  moderation: 'Moderation',
  tts: 'Text to speech',
  asr: 'Speech to text',
  image_gen: 'Image generation',
  video_gen: 'Video generation',
  ocr: 'OCR',
  realtime: 'Realtime audio',
  other: 'Other',
  unclassified: 'Needs review',
}

function typeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type
}

/**
 * Read filter state from the URL.
 *
 * Done on the client rather than from server-side searchParams: reading them
 * on the server would make this page dynamic, and it is the busiest page on
 * the site. Everything here only seeds local state, so the brief moment before
 * it applies costs nothing.
 */
function readUrlFilters(providerSlugs: string[]): InitialFilters {
  const empty: InitialFilters = {
    providers: [],
    flagship: false,
    under1: false,
    million: false,
    search: '',
    sort: 'value',
    direction: 'asc',
    pins: null,
  }
  if (typeof window === 'undefined') return empty

  const params = new URLSearchParams(window.location.search)
  const known = new Set(providerSlugs)
  const sort = params.get('sort') as SortKey | null
  const validSort = sort && SORT_KEYS.includes(sort) ? sort : 'value'
  const direction = params.get('dir')
  const rawPins = params.get('pins')

  return {
    providers: (params.get('providers') ?? '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter((value) => known.has(value)),
    flagship: params.get('flagship') === '1',
    under1: params.get('under1') === '1',
    million: params.get('million') === '1',
    search: params.get('q') ?? '',
    sort: validSort,
    direction:
      direction === 'asc' || direction === 'desc' ? direction : defaultDirection(validSort),
    // Absent means no explicit choice, so stored pins still apply. An empty
    // value is a real choice: the sender pinned nothing.
    pins:
      rawPins === null
        ? null
        : rawPins
            .split(',')
            .map((v) => v.trim())
            .filter(Boolean),
  }
}

export function PriceExplorer({ rows, providers, updatedAt, providerSlugs }: ExplorerProps) {
  // Server and first client render must agree, so state starts at the defaults
  // and the URL is applied in an effect below.
  const [selectedProviders, setSelectedProviders] = useState<string[]>([])
  const [flagshipOnly, setFlagshipOnly] = useState(false)
  /*
   * Chat by default, because a cost-per-token ranking that includes an
   * embedding or moderation endpoint is not a ranking of anything — before
   * this, a moderation endpoint was the 4th cheapest model on the site. The
   * other types are one control away rather than removed: they are real
   * models with real prices, they are simply not comparable to chat models.
   */
  const [modelType, setModelType] = useState<string>('general')
  /*
   * How much of the catalogue the list opens on.
   *
   * 'popular' shows the curated set — a flagship and a cheap option from each
   * major provider — instead of all 191 general models. On a phone the full
   * list was roughly four thousand pixels of cards that opened on
   * GLM-4.5-Flash, a model almost nobody arrives looking for, and it sat below
   * a second list showing the same kind of thing. One short list of
   * recognisable names is the view that answers "what does this cost".
   *
   * 'all' is one tap away and every filter still reaches the whole catalogue —
   * see effectiveScope, which widens automatically rather than letting this
   * default hide a model someone actually searched for.
   */
  const [scope, setScope] = useState<'popular' | 'all'>('popular')
  const [under1, setUnder1] = useState(false)
  const [million, setMillion] = useState(false)
  const [search, setSearch] = useState('')
  // Column headers and the sort dropdown drive the same state, so the table
  // can never show one thing while the control claims another.
  const sort = useSortState<SortKey>('value', defaultDirection)
  const { key: sortKey, direction: sortDirection, set: setSort } = sort
  const [urlApplied, setUrlApplied] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [view, setView] = useState<ViewMode>('auto')
  const [cardLimit, setCardLimit] = useState(CARD_PAGE)
  // Below `sm` the filter panel collapses behind a button: expanded, ten
  // provider pills plus six controls take more than half a phone screen.
  const [filtersOpen, setFiltersOpen] = useState(false)

  // `null` means "no explicit choice yet", which renders the curated default.
  // A URL parameter wins over stored preferences so a shared link shows the
  // sender's selection rather than the recipient's.
  const [pins, setPins] = useState<string[] | null>(null)
  const [pinNotice, setPinNotice] = useState<string | null>(null)

  // Models ticked for comparison, as `provider|model_id` — ids repeat across
  // vendors, so the provider has to be part of the identity.
  const [compare, setCompare] = useState<string[]>([])
  const [compareNotice, setCompareNotice] = useState<string | null>(null)

  const toggleCompare = useCallback((key: string) => {
    setCompare((current) => {
      if (current.includes(key)) {
        setCompareNotice(null)
        return current.filter((entry) => entry !== key)
      }
      if (current.length >= MAX_COMPARED) {
        setCompareNotice(
          `Comparing is capped at ${MAX_COMPARED} models — untick one to swap it out.`,
        )
        window.setTimeout(() => setCompareNotice(null), 2600)
        return current
      }
      setCompareNotice(null)
      return [...current, key]
    })
  }, [])

  const compareSet = useMemo(() => new Set(compare), [compare])

  // Apply the URL once, on mount.
  useEffect(() => {
    const fromUrl = readUrlFilters(providerSlugs)
    setSelectedProviders(fromUrl.providers)
    setFlagshipOnly(fromUrl.flagship)
    setUnder1(fromUrl.under1)
    setMillion(fromUrl.million)
    setSearch(fromUrl.search)
    setSort(fromUrl.sort, fromUrl.direction)
    if (fromUrl.pins !== null) setPins(fromUrl.pins)
    setUrlApplied(true)
  }, [providerSlugs, setSort])

  // Read stored pins after mount, never during render: localStorage does not
  // exist on the server, so touching it in the initial state would make the
  // server and client markup disagree.
  useEffect(() => {
    if (!urlApplied || pins !== null) return
    try {
      const stored = window.localStorage.getItem(PINS_STORAGE_KEY)
      if (stored) {
        const parsed = JSON.parse(stored) as unknown
        if (Array.isArray(parsed) && parsed.every((v) => typeof v === 'string')) {
          setPins(parsed.slice(0, MAX_FEATURED))
        }
      }
    } catch {
      // Corrupt or unavailable storage (private mode) just means defaults.
    }
    // Runs once the URL has been read; pins from the URL win.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlApplied])

  // Same reasoning as pins: storage is read after mount so the server and
  // client agree on the first render. `auto` until then, which is the default
  // anyway, so there is nothing to flash.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(VIEW_STORAGE_KEY)
      if (stored === 'cards' || stored === 'table') setView(stored)
    } catch {
      // Private mode: the default is fine.
    }
  }, [])

  const chooseView = useCallback((next: ViewMode) => {
    setView(next)
    try {
      window.localStorage.setItem(VIEW_STORAGE_KEY, next)
    } catch {
      // Non-fatal: the choice still applies for this session.
    }
  }, [])

  const isCustomPins = pins !== null
  const effectivePins = pins ?? [...DEFAULT_FEATURED_MODEL_IDS]

  const persistPins = useCallback((next: string[] | null) => {
    setPins(next)
    try {
      if (next === null) window.localStorage.removeItem(PINS_STORAGE_KEY)
      else window.localStorage.setItem(PINS_STORAGE_KEY, JSON.stringify(next))
    } catch {
      // Non-fatal: the selection still applies for this session.
    }
  }, [])

  const togglePin = useCallback(
    (modelId: string) => {
      const current = pins ?? [...DEFAULT_FEATURED_MODEL_IDS]
      if (current.includes(modelId)) {
        persistPins(current.filter((id) => id !== modelId))
        return
      }
      if (current.length >= MAX_FEATURED) {
        setPinNotice(`Popular models is capped at ${MAX_FEATURED}. Remove one first.`)
        window.setTimeout(() => setPinNotice(null), 2600)
        return
      }
      persistPins([...current, modelId])
    },
    [pins, persistPins],
  )

  const pinnedSet = useMemo(() => new Set(effectivePins), [effectivePins])

  // --- filtering ----------------------------------------------------------
  /*
   * Falls back to 'all' when nothing in the data is classified, so an
   * unmigrated database degrades to the pre-classification view rather than to
   * a blank page. See resolveTypeFilter for why the two are indistinguishable
   * from here.
   */
  const effectiveType = useMemo(() => resolveTypeFilter(rows, modelType), [rows, modelType])

  /*
   * Any deliberate narrowing widens the scope back to the whole catalogue.
   *
   * Without this, searching "gpt-4.1" from the default view would look through
   * ten pinned models, find nothing, and report that a model the site holds
   * does not exist. A default that shortens a browse is useful; a default that
   * silently answers a specific question wrongly is the bug we just spent a
   * day on. Someone who has typed a query or picked a provider is no longer
   * browsing, so the short list has done its job.
   */
  const isNarrowing =
    selectedProviders.length > 0 || flagshipOnly || under1 || million || search.trim() !== ''
  const effectiveScope = isNarrowing ? 'all' : scope

  /** Everything passing the real filters, before the popular/all scope applies. */
  const matched = useMemo(() => {
    const query = search.trim().toLowerCase()
    return rows.filter((row) => {
      if (selectedProviders.length > 0 && !selectedProviders.includes(row.provider)) return false
      if (effectiveType !== 'all' && (row.model_type ?? 'unclassified') !== effectiveType)
        return false
      if (flagshipOnly && !row.tags.includes('flagship')) return false
      if (under1 && !(row.input !== null && row.input < 1)) return false
      if (million && !(row.context_window !== null && row.context_window >= 1_000_000)) return false
      if (query) {
        // Descriptions are searched too: "coding" or "agentic" finds models
        // whose names say nothing about what they are for.
        const haystack =
          `${row.model_id} ${row.display_name} ${row.provider_name} ${row.description ?? ''}`.toLowerCase()
        if (!haystack.includes(query)) return false
      }
      return true
    })
  }, [rows, selectedProviders, effectiveType, flagshipOnly, under1, million, search])

  const filtered = useMemo(() => {
    if (effectiveScope === 'all') return matched
    // Set membership rather than the pinned order: the list keeps whatever sort
    // the reader chose, and the popular set only decides who is in it.
    const popular = new Set(effectivePins)
    return matched.filter((row) => popular.has(row.model_id))
  }, [matched, effectiveScope, effectivePins])

  /** Types actually present in the data, so the control never offers an empty view. */
  const availableTypes = useMemo(() => {
    const counts = new Map<string, number>()
    for (const row of rows) {
      const key = row.model_type ?? 'unclassified'
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [rows])

  /*
   * A search that matches nothing here but matches under another type is the
   * one way this filter could look like deletion. Say where the model went
   * rather than reporting that it does not exist.
   */
  const elsewhere = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query || filtered.length > 0 || effectiveType === 'all') return null
    const hit = rows.find((row) =>
      `${row.model_id} ${row.display_name}`.toLowerCase().includes(query),
    )
    return hit ? { modelId: hit.model_id, type: hit.model_type ?? 'unclassified' } : null
  }, [rows, filtered, search, effectiveType])

  // --- ranking ------------------------------------------------------------
  // One blended metric drives both the column and the ranking, so the table
  // never looks mis-sorted against the number it displays.
  const scored = useMemo(
    () =>
      filtered.map((row) => ({
        row,
        blended: blendedPrice(row.input, row.output),
        isFree: row.input === 0 && row.output === 0,
      })),
    [filtered],
  )

  // Free models would otherwise hold "Best value" permanently — three Zhipu
  // GLM-Flash variants are $0 across the board. They get their own badge
  // instead, keeping the value ranking meaningful for paid models.
  const bestValueIds = useMemo(() => {
    const payable = scored
      .filter((entry) => !entry.isFree && entry.blended !== null)
      .sort((a, b) => (a.blended ?? 0) - (b.blended ?? 0))
    return new Set(payable.slice(0, 3).map((entry) => entry.row.model_id))
  }, [scored])

  const topValueId = useMemo(() => {
    const payable = scored
      .filter((entry) => !entry.isFree && entry.blended !== null)
      .sort((a, b) => (a.blended ?? 0) - (b.blended ?? 0))
    return payable[0]?.row.model_id ?? null
  }, [scored])

  const sorted = useMemo(() => {
    const list = [...scored]

    list.sort((a, b) => {
      switch (sortKey) {
        case 'input':
          return compareNullableNumbers(a.row.input, b.row.input, sortDirection)
        case 'cached':
          return compareNullableNumbers(a.row.cached_input, b.row.cached_input, sortDirection)
        case 'output':
          return compareNullableNumbers(a.row.output, b.row.output, sortDirection)
        case 'context':
          return compareNullableNumbers(a.row.context_window, b.row.context_window, sortDirection)
        case 'model':
          return compareText(a.row.display_name, b.row.display_name, sortDirection)
        case 'provider':
          return (
            compareText(a.row.provider_name, b.row.provider_name, sortDirection) ||
            // Within one provider, cheapest first regardless of direction —
            // reversing the whole list would otherwise reverse this too, and
            // "Provider Z–A, most expensive first" is nobody's question.
            compareNullableNumbers(a.blended, b.blended, 'asc')
          )
        default:
          return compareNullableNumbers(a.blended, b.blended, sortDirection)
      }
    })

    return list
  }, [scored, sortKey, sortDirection])

  // --- aggregates ---------------------------------------------------------
  /*
   * Computed from `matched`, not `filtered` — the popular scope deliberately
   * does not move these numbers.
   *
   * The curated set is ten flagships, so averaging it would report the market
   * as roughly twice its real price and would change the headline figure
   * purely because of how the page happens to open. Provider and search
   * filters do still narrow it: those are a reader asking about a subset,
   * which is a different thing from a default deciding what to show first.
   */
  const stats = useMemo(() => {
    const inputs = matched.map((r) => r.input).filter((v): v is number => v !== null)
    const outputs = matched.map((r) => r.output).filter((v): v is number => v !== null)
    const mean = (values: number[]) =>
      values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : null
    const avgInput = mean(inputs)
    const avgOutput = mean(outputs)
    return {
      avgInput,
      avgOutput,
      avgBlended: avgInput !== null && avgOutput !== null ? (avgInput + avgOutput) / 2 : null,
    }
  }, [matched])

  // Page-level trend: the mean input price at each historical sample point.
  // Over `matched` for the same reason as the averages above — the trend is a
  // statement about prices, not about which rows the page opened on.
  const trendSeries = useMemo(() => {
    const withTrend = matched.filter((r) => r.trend && r.trend.series.length > 0)
    if (withTrend.length === 0) return []
    const points = withTrend[0].trend?.series.length ?? 0
    return Array.from({ length: points }, (_, index) => {
      const values = withTrend
        .map((r) => r.trend?.series[index])
        .filter((v): v is number => v !== undefined)
      return values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : 0
    })
  }, [matched])

  const trendPct =
    trendSeries.length >= 2 && trendSeries[0] > 0
      ? ((trendSeries[trendSeries.length - 1] - trendSeries[0]) / trendSeries[0]) * 100
      : 0

  // --- shareable URL ------------------------------------------------------
  const buildQuery = useCallback(() => {
    const params = new URLSearchParams()
    if (selectedProviders.length > 0) params.set('providers', selectedProviders.join(','))
    if (flagshipOnly) params.set('flagship', '1')
    if (under1) params.set('under1', '1')
    if (million) params.set('million', '1')
    if (search.trim()) params.set('q', search.trim())
    if (sortKey !== 'value') params.set('sort', sortKey)
    // Only when it differs from what the column would pick anyway, so the
    // common case stays a short, readable link.
    if (sortDirection !== defaultDirection(sortKey)) params.set('dir', sortDirection)
    if (pins !== null) params.set('pins', pins.join(','))
    return params.toString()
  }, [selectedProviders, flagshipOnly, under1, million, search, sortKey, sortDirection, pins])

  // Keep the address bar in sync so a reload or a copied URL restores the view.
  useEffect(() => {
    if (typeof window === 'undefined' || !urlApplied) return
    const query = buildQuery()
    const url = query ? `${window.location.pathname}?${query}` : window.location.pathname
    window.history.replaceState(null, '', url)
  }, [buildQuery, urlApplied])

  const copyLink = useCallback(() => {
    if (typeof window === 'undefined') return
    const query = buildQuery()
    const url = `${window.location.origin}${window.location.pathname}${query ? `?${query}` : ''}`
    navigator.clipboard?.writeText(url).catch(() => {})
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }, [buildQuery, urlApplied])

  const shareLink = useCallback(() => {
    if (typeof window === 'undefined') return
    const query = buildQuery()
    const url = `${window.location.origin}${window.location.pathname}${query ? `?${query}` : ''}`
    if (navigator.share) {
      navigator.share({ title: 'CostOfToken — LLM pricing, compared', url }).catch(() => {})
    } else {
      copyLink()
    }
  }, [buildQuery, copyLink])

  const toggleProvider = (slug: string) =>
    setSelectedProviders((current) =>
      current.includes(slug) ? current.filter((s) => s !== slug) : [...current, slug],
    )

  const resetFilters = () => {
    setSelectedProviders([])
    setFlagshipOnly(false)
    setUnder1(false)
    setMillion(false)
    setSearch('')
  }

  const hasFilters =
    selectedProviders.length > 0 || flagshipOnly || under1 || million || search !== ''

  // Shown on the collapsed Filters button, so a filter left on is never
  // invisible. Providers count as one regardless of how many are selected.
  const activeFilterCount =
    (selectedProviders.length > 0 ? 1 : 0) +
    (flagshipOnly ? 1 : 0) +
    (under1 ? 1 : 0) +
    (million ? 1 : 0) +
    (search !== '' ? 1 : 0)

  const toggleExpanded = useCallback(
    (id: string) => setExpandedId((current) => (current === id ? null : id)),
    [],
  )

  // A new result set starts from the top again, otherwise a filter that leaves
  // 12 models still claims to be showing the first 40 of them.
  useEffect(() => {
    setCardLimit(CARD_PAGE)
  }, [sorted])

  return (
    <div className="mx-auto max-w-[1120px] px-5 pb-14 pt-7">
      <Header updatedAt={updatedAt} />

      {/*
        The Popular models panel used to sit here, above a second list showing
        the same kind of thing. Its job is now the main list's default scope,
        so the page has one list instead of two — see the `scope` state. The
        pinned set it rendered is unchanged and still editable, via the star on
        each row rather than a separate panel.
      */}

      {pinNotice && (
        <p role="status" className="mb-3 text-[13px] text-amber-400">
          {pinNotice}
        </p>
      )}

      {/*
        Non-chat prices are not comparable to chat prices, and saying so is not
        optional politeness — embeddings and moderation models have no output
        price at all, and image and speech models are frequently billed per
        image or per second rather than per token. Ranking them beside chat
        models without a word would repeat the fault this filter fixed.
      */}
      {effectiveType !== 'general' && effectiveType !== 'all' && (
        <p
          role="status"
          className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-[13px] text-amber-900"
        >
          Showing <strong>{typeLabel(effectiveType)}</strong> models. Their pricing is not
          comparable to chat models — many have no output price, and some are billed per request
          rather than per token.
        </p>
      )}

      {/*
        The one way a default filter can look like deletion: a reader searches
        for a model that exists, and is told it does not.
      */}
      {elsewhere && (
        <p
          role="status"
          className="mb-3 rounded-lg bg-neutral-100 px-3 py-2 text-[13px] text-neutral-700"
        >
          No match under {typeLabel(effectiveType)}, but <strong>{elsewhere.modelId}</strong> exists
          under{' '}
          <button
            type="button"
            onClick={() => setModelType(elsewhere.type)}
            className="font-semibold text-emerald-700 underline underline-offset-2"
          >
            {typeLabel(elsewhere.type)}
          </button>
          .
        </p>
      )}

      <div className="mb-4 flex flex-wrap gap-3.5">
        <StatsCard stats={stats} count={matched.length} />
        <TrendCard series={trendSeries} pct={trendPct} />
      </div>

      <FunStatsCard avgInput={stats.avgInput} />

      {/*
        Sticky at every width, but only the compact bar is sticky on a phone —
        the full panel is behind the Filters button. Expanded it is more than
        half a viewport, which is why it could not be pinned before.

        z-40 keeps it above the table's own sticky header, which uses z-30 for
        the pinned columns. At z-20 the two tied and DOM order decided, so the
        header painted over the toolbar.
      */}
      <div className="sticky top-0 z-40 -mx-5 mb-4 border-y border-neutral-200 bg-white px-5 py-2.5 shadow-sm sm:mx-0 sm:rounded-xl sm:border sm:p-4">
        {/* Compact bar — phones only. Sort stays reachable without expanding. */}
        <div className="flex items-center gap-2 sm:hidden">
          <button
            type="button"
            onClick={() => setFiltersOpen((open) => !open)}
            aria-expanded={filtersOpen}
            aria-controls="filter-panel"
            className={`inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 text-sm font-semibold ${
              hasFilters
                ? 'border-emerald-600 bg-emerald-50 text-emerald-700'
                : 'border-neutral-200 bg-white text-neutral-700'
            }`}
          >
            Filters
            {activeFilterCount > 0 && (
              <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-emerald-600 px-1 text-[11px] font-bold text-white">
                {activeFilterCount}
              </span>
            )}
            <span aria-hidden className="text-neutral-400">
              {filtersOpen ? '▲' : '▼'}
            </span>
          </button>

          <label className="sr-only" htmlFor="sort-order-mobile">
            Sort order
          </label>
          <select
            id="sort-order-mobile"
            value={sortKey}
            onChange={(event) => {
              const next = event.target.value as SortKey
              setSort(next, defaultDirection(next))
            }}
            className="min-h-[44px] flex-1 cursor-pointer rounded-lg border border-neutral-200 bg-white px-2.5 text-sm text-neutral-900"
          >
            {SORT_LABELS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        {/*
          One panel, two behaviours: always open from `sm` up, toggled below it.
          Rendering it twice would mean two sets of inputs bound to the same
          state, and duplicate ids.
        */}
        <div
          id="filter-panel"
          className={`${
            filtersOpen ? 'mt-3 max-h-[60vh] overflow-y-auto overscroll-contain' : 'hidden'
          } sm:mt-0 sm:block sm:max-h-none sm:overflow-visible`}
        >
          <ProviderFilter
            providers={providers}
            selected={selectedProviders}
            onToggle={toggleProvider}
            onClear={() => setSelectedProviders([])}
          />

          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="model-search">
              Search models
            </label>
            <input
              id="model-search"
              type="search"
              placeholder="Search models…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="min-h-[44px] w-full min-w-[160px] rounded-lg border border-neutral-200 bg-white px-3 text-sm text-neutral-900 outline-none placeholder:text-neutral-400 focus-visible:ring-2 focus-visible:ring-emerald-600 sm:min-h-0 sm:w-auto sm:flex-1 sm:py-2"
            />

            <button
              type="button"
              onClick={() => setFlagshipOnly((v) => !v)}
              aria-pressed={flagshipOnly}
              className={chipClass(flagshipOnly)}
            >
              Flagship only
            </button>
            <button
              type="button"
              onClick={() => setUnder1((v) => !v)}
              aria-pressed={under1}
              className={chipClass(under1)}
            >
              Under $1 input
            </button>
            <button
              type="button"
              onClick={() => setMillion((v) => !v)}
              aria-pressed={million}
              className={chipClass(million)}
            >
              1M+ context
            </button>

            <label className="sr-only" htmlFor="model-type">
              Model type
            </label>
            <select
              id="model-type"
              value={effectiveType}
              onChange={(event) => setModelType(event.target.value)}
              className="min-h-[44px] cursor-pointer rounded-lg border border-neutral-200 bg-white px-2.5 text-sm text-neutral-900 sm:min-h-0 sm:py-2"
            >
              {availableTypes.map(([type, count]) => (
                <option key={type} value={type}>
                  {typeLabel(type)} ({count})
                </option>
              ))}
              <option value="all">All types ({rows.length})</option>
            </select>

            <label className="sr-only" htmlFor="sort-order">
              Sort order
            </label>
            {/* Hidden on phones: the compact bar above already carries sort.
                On wider screens the table headings do the same job, but this
                stays as the only sort control the card view has. */}
            <select
              id="sort-order"
              value={sortKey}
              onChange={(event) => {
                const next = event.target.value as SortKey
                setSort(next, defaultDirection(next))
              }}
              className="hidden cursor-pointer rounded-lg border border-neutral-200 bg-white px-2.5 py-2 text-sm text-neutral-900 sm:block"
            >
              {SORT_LABELS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={copyLink}
              className="min-h-[44px] flex-1 whitespace-nowrap rounded-lg bg-emerald-600 px-3.5 text-sm font-semibold text-white hover:bg-emerald-700 sm:min-h-0 sm:flex-none sm:py-2"
            >
              {copied ? 'Copied!' : 'Copy link'}
            </button>
            <button
              type="button"
              onClick={shareLink}
              className="min-h-[44px] flex-1 whitespace-nowrap rounded-lg border border-emerald-600 bg-white px-3.5 text-sm font-semibold text-emerald-700 hover:bg-emerald-50 sm:min-h-0 sm:flex-none sm:py-2"
            >
              Share
            </button>
          </div>
        </div>
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="text-[13px] text-neutral-600">
          {effectiveScope === 'popular' ? (
            <>
              Showing <strong>{sorted.length} popular</strong> of {matched.length} models
            </>
          ) : (
            <>
              Showing {sorted.length} of {rows.length} models
            </>
          )}{' '}
          · select one for details, or tick up to {MAX_COMPARED} to compare
        </p>

        {/*
          Says what is being withheld and how much, rather than leaving the
          reader to infer the site only knows ten models. `isNarrowing` hides
          it because the scope is not what is deciding the list at that point,
          and offering to "show all 191" next to a provider filter would be
          claiming to do something it does not do.
        */}
        {!isNarrowing && (
          <button
            type="button"
            onClick={() => setScope(scope === 'popular' ? 'all' : 'popular')}
            className="text-[13px] font-medium text-emerald-700 underline underline-offset-2 hover:text-emerald-800"
          >
            {scope === 'popular' ? `Show all ${matched.length} models` : 'Show popular only'}
          </button>
        )}

        {/*
          The old panel owned this; without it a reader who edited the popular
          set by starring rows would have no way back to the curated one.
        */}
        {isCustomPins && effectiveScope === 'popular' && (
          <button
            type="button"
            onClick={() => persistPins(null)}
            className="text-[13px] font-medium text-neutral-600 underline underline-offset-2 hover:text-neutral-800"
          >
            Reset to defaults
          </button>
        )}

        {hasFilters && (
          <button
            type="button"
            onClick={resetFilters}
            className="text-[13px] font-medium text-emerald-700 underline underline-offset-2 hover:text-emerald-800"
          >
            Clear filters
          </button>
        )}
        <ViewToggle view={view} onChange={chooseView} />
      </div>

      {sorted.length === 0 ? (
        <div className="rounded-xl border border-neutral-200 bg-white p-10 text-center">
          <p className="text-sm text-neutral-600">No models match these filters.</p>
        </div>
      ) : (
        <>
          <div className={view === 'table' ? 'hidden' : view === 'auto' ? 'sm:hidden' : ''}>
            <CardList
              entries={sorted}
              limit={cardLimit}
              onShowMore={() => setCardLimit((current) => current + CARD_PAGE)}
              pinnedSet={pinnedSet}
              onTogglePin={togglePin}
              compareSet={compareSet}
              onToggleCompare={toggleCompare}
              bestValueIds={bestValueIds}
              topValueId={topValueId}
              expandedId={expandedId}
              onToggle={toggleExpanded}
            />
          </div>

          <div className={view === 'cards' ? 'hidden' : view === 'auto' ? 'hidden sm:block' : ''}>
            <PriceTable
              entries={sorted}
              sort={sort}
              pinnedSet={pinnedSet}
              onTogglePin={togglePin}
              compareSet={compareSet}
              onToggleCompare={toggleCompare}
              bestValueIds={bestValueIds}
              topValueId={topValueId}
              expandedId={expandedId}
              onToggle={toggleExpanded}
            />
          </div>
        </>
      )}

      <CompareBar
        keys={compare}
        rows={rows}
        notice={compareNotice}
        onRemove={toggleCompare}
        onClear={() => {
          setCompare([])
          setCompareNotice(null)
        }}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------

/**
 * A checkbox that adds a model to the comparison.
 *
 * Deliberately a real `<input type="checkbox">` rather than a styled button:
 * ticking rows to compare them is a form interaction people already know, and
 * a native checkbox gets keyboard support, the right announcement and the
 * browser's own focus ring for free.
 */
function CompareCheckbox({
  checked,
  displayName,
  disabled,
  onToggle,
  className = '',
}: {
  checked: boolean
  displayName: string
  /** True once the cap is reached, for every model not already ticked. */
  disabled: boolean
  onToggle: () => void
  className?: string
}) {
  return (
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={onToggle}
      onClick={(event) => event.stopPropagation()}
      aria-label={checked ? `Remove ${displayName} from the comparison` : `Compare ${displayName}`}
      title={
        disabled
          ? `Comparing is capped at ${MAX_COMPARED} models`
          : checked
            ? 'Remove from comparison'
            : 'Add to comparison'
      }
      className={`h-4 w-4 shrink-0 cursor-pointer accent-emerald-600 disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
    />
  )
}

/**
 * The selection tray.
 *
 * Fixed to the bottom of the viewport rather than sitting under the table: the
 * table is 200-odd rows and scrolls inside its own container, so a bar in the
 * document flow would be off-screen exactly when it is needed. It only exists
 * while something is selected, so it costs nothing the rest of the time.
 */
function CompareBar({
  keys,
  rows,
  notice,
  onRemove,
  onClear,
}: {
  keys: string[]
  rows: ExplorerRow[]
  notice: string | null
  onRemove: (key: string) => void
  onClear: () => void
}) {
  const byKey = useMemo(() => new Map(rows.map((row) => [modelKey(row), row])), [rows])
  const chosen = keys.map((key) => byKey.get(key)).filter((row): row is ExplorerRow => !!row)

  if (chosen.length === 0 && !notice) return null

  return (
    <>
      {/* Reserves the height the fixed bar occupies, so the last table row and
          the footer stay reachable rather than sitting under it. */}
      <div aria-hidden className="h-20" />
      <div
        role="region"
        aria-label="Selected models"
        className="fixed inset-x-0 bottom-0 z-50 border-t border-neutral-200 bg-white/95 px-4 py-3 shadow-[0_-4px_16px_rgba(0,0,0,0.06)] backdrop-blur"
      >
        <div className="mx-auto flex max-w-[1120px] flex-wrap items-center gap-2">
          <span className="text-[13px] font-semibold text-neutral-700">
            {chosen.length} of {MAX_COMPARED} selected
          </span>

          {chosen.map((row) => (
            <span
              key={modelKey(row)}
              className="inline-flex items-center gap-1.5 rounded-full border border-emerald-600 bg-emerald-50 py-0.5 pl-2.5 pr-1 text-[12.5px] font-medium text-emerald-800"
            >
              <span
                className="inline-block h-2 w-2 shrink-0 rounded-full"
                style={{ background: providerColor(row.provider) }}
              />
              {row.display_name}
              <button
                type="button"
                onClick={() => onRemove(modelKey(row))}
                aria-label={`Remove ${row.display_name} from the comparison`}
                className="inline-flex h-5 w-5 items-center justify-center rounded-full text-emerald-700 hover:bg-emerald-100"
              >
                ×
              </button>
            </span>
          ))}

          {notice && (
            <span role="status" className="text-[12.5px] font-medium text-amber-700">
              {notice}
            </span>
          )}

          <span className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={onClear}
              className="min-h-9 rounded-lg px-2.5 text-[13px] font-medium text-neutral-600 hover:text-neutral-900"
            >
              Clear
            </button>
            {/*
            Disabled below two, because one model side by side with nothing is
            the model's own page — which is one click away from here anyway.
          */}
            {chosen.length >= 2 ? (
              <Link
                href={compareHref(keys)}
                className="inline-flex min-h-9 items-center rounded-lg bg-emerald-600 px-3.5 text-sm font-semibold text-white hover:bg-emerald-700"
              >
                Compare {chosen.length} →
              </Link>
            ) : (
              <span className="inline-flex min-h-9 items-center rounded-lg bg-neutral-100 px-3.5 text-sm font-medium text-neutral-500">
                Pick one more to compare
              </span>
            )}
          </span>
        </div>
      </div>
    </>
  )
}

function chipClass(active: boolean): string {
  // min-h-9 on touch, tighter from `sm` up where pointing is precise.
  const base =
    'inline-flex min-h-9 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors cursor-pointer sm:min-h-0'
  return active
    ? `${base} border-emerald-600 bg-emerald-50 text-emerald-700`
    : `${base} border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300`
}

/**
 * Provider pills, collapsed by default on phones.
 *
 * Ten pills wrap to three rows, which is most of what the collapsed filter bar
 * was meant to save. Any active selection forces it open — a hidden filter that
 * is silently narrowing the list is worse than the space it costs.
 */
function ProviderFilter({
  providers,
  selected,
  onToggle,
  onClear,
}: {
  providers: ProviderOption[]
  selected: string[]
  onToggle: (slug: string) => void
  onClear: () => void
}) {
  const [open, setOpen] = useState(false)
  const expanded = open || selected.length > 0

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2 sm:hidden">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={expanded}
          className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400"
        >
          Providers{selected.length > 0 ? ` · ${selected.length} selected` : ''}{' '}
          <span aria-hidden>{expanded ? '▲' : '▼'}</span>
        </button>
        {selected.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="text-[12px] font-medium text-emerald-700 underline underline-offset-2"
          >
            All providers
          </button>
        )}
      </div>

      <div className={`${expanded ? 'flex' : 'hidden'} flex-wrap gap-2 sm:flex`}>
        {providers.map((provider) => {
          const active = selected.includes(provider.slug)
          return (
            <button
              key={provider.slug}
              type="button"
              onClick={() => onToggle(provider.slug)}
              aria-pressed={active}
              className={chipClass(active)}
            >
              <span
                className="inline-block h-[7px] w-[7px] shrink-0 rounded-full"
                style={{ background: providerColor(provider.slug) }}
              />
              {provider.name}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Cards or table.
 *
 * In `auto` there is no single correct highlight — the answer depends on the
 * viewport, which is not known during render. Rather than guess and flip after
 * hydration, the active styling is applied by breakpoint variant, so it matches
 * whichever view CSS is actually showing.
 */
function ViewToggle({ view, onChange }: { view: ViewMode; onChange: (next: ViewMode) => void }) {
  const base =
    'min-h-9 rounded-md px-3 text-[13px] font-medium transition-colors cursor-pointer sm:min-h-0 sm:py-1'
  const on = 'bg-white text-neutral-900 shadow-sm'
  const off = 'text-neutral-500 hover:text-neutral-800'

  return (
    <div
      role="group"
      aria-label="List view"
      className="ml-auto inline-flex rounded-lg bg-neutral-100 p-0.5"
    >
      <button
        type="button"
        onClick={() => onChange('cards')}
        aria-pressed={view === 'cards'}
        className={`${base} ${
          view === 'cards'
            ? on
            : view === 'auto'
              ? `${off} max-sm:bg-white max-sm:text-neutral-900 max-sm:shadow-sm`
              : off
        }`}
      >
        Cards
      </button>
      <button
        type="button"
        onClick={() => onChange('table')}
        aria-pressed={view === 'table'}
        className={`${base} ${
          view === 'table'
            ? on
            : view === 'auto'
              ? `${off} sm:bg-white sm:text-neutral-900 sm:shadow-sm`
              : off
        }`}
      >
        Table
      </button>
    </div>
  )
}

function CardList({
  entries,
  limit,
  onShowMore,
  pinnedSet,
  onTogglePin,
  compareSet,
  onToggleCompare,
  bestValueIds,
  topValueId,
  expandedId,
  onToggle,
}: {
  entries: Entry[]
  limit: number
  onShowMore: () => void
  pinnedSet: Set<string>
  onTogglePin: (id: string) => void
  compareSet: Set<string>
  onToggleCompare: (key: string) => void
  bestValueIds: Set<string>
  topValueId: string | null
  expandedId: string | null
  onToggle: (id: string) => void
}) {
  const visible = entries.slice(0, limit)
  const remaining = entries.length - visible.length

  return (
    <>
      <ul className="flex flex-col gap-2 p-0">
        {visible.map((entry, index) => (
          <ModelCard
            key={`${entry.row.provider}/${entry.row.model_id}`}
            entry={entry}
            rank={index + 1}
            pinned={pinnedSet.has(entry.row.model_id)}
            onTogglePin={onTogglePin}
            compared={compareSet.has(modelKey(entry.row))}
            compareFull={compareSet.size >= MAX_COMPARED}
            onToggleCompare={onToggleCompare}
            isBest={bestValueIds.has(entry.row.model_id)}
            isTop={entry.row.model_id === topValueId}
            expanded={expandedId === entry.row.model_id}
            onToggle={onToggle}
          />
        ))}
      </ul>

      {remaining > 0 && (
        <button
          type="button"
          onClick={onShowMore}
          className="mt-3 min-h-[44px] w-full rounded-xl border border-neutral-200 bg-white text-sm font-semibold text-neutral-700 hover:border-neutral-300"
        >
          Show {Math.min(remaining, CARD_PAGE)} more · {remaining} left
        </button>
      )}
    </>
  )
}

function Header({ updatedAt }: { updatedAt: string | null }) {
  return (
    <header className="mb-5">
      <div className="flex flex-wrap items-center gap-2.5">
        <h1 className="m-0 text-2xl font-bold tracking-tight text-neutral-950">CostOfToken</h1>
        <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-emerald-700">
          Updated daily
        </span>
      </div>
      <p className="mt-1.5 text-[13px] text-neutral-600">
        Updated {formatRelativeTime(updatedAt)} · No signup · Free &amp; open · LLM API pricing
        normalized to USD per 1M tokens
      </p>
    </header>
  )
}

function StatsCard({
  stats,
  count,
}: {
  stats: {
    avgInput: number | null
    avgOutput: number | null
    avgBlended: number | null
  }
  count: number
}) {
  return (
    <section className="min-w-[240px] flex-1 rounded-2xl border border-neutral-200 bg-white px-4 py-4 sm:px-6 sm:py-5">
      <h2 className="m-0 mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-500 sm:mb-3.5">
        Average across {count} selected model{count === 1 ? '' : 's'}
      </h2>
      {/*
        Three across on a phone rather than stacked. Stacked, the three numbers
        alone were most of a viewport before any model appeared.
      */}
      <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap sm:gap-7">
        <Stat label="Avg input /1M" value={formatPrice(stats.avgInput)} />
        <Stat label="Avg output /1M" value={formatPrice(stats.avgOutput)} />
        <Stat label="Avg blended /1M" value={formatPrice(stats.avgBlended)} accent />
      </div>
    </section>
  )
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="min-w-0">
      <div
        className={`text-[22px] font-bold tabular-nums leading-none tracking-tight sm:text-[34px] ${
          accent ? 'text-emerald-600' : 'text-neutral-900'
        }`}
      >
        {value}
      </div>
      <div className="mt-1.5 text-[11px] text-neutral-400 sm:text-[12.5px]">{label}</div>
    </div>
  )
}

function TrendCard({ series, pct }: { series: number[]; pct: number }) {
  const flat = Math.abs(pct) < 0.5
  const badge = flat
    ? 'bg-neutral-100 text-neutral-500'
    : pct < 0
      ? 'bg-emerald-50 text-emerald-700'
      : 'bg-red-50 text-red-600'

  return (
    <section className="min-w-[280px] flex-1 rounded-2xl border border-neutral-200 bg-white px-6 py-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2.5">
        <h2 className="m-0 text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Blended price trend · 90 days
        </h2>
        <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${badge}`}>
          {flat ? 'Flat' : `${pct < 0 ? '↓' : '↑'} ${Math.abs(pct).toFixed(1)}%`}
        </span>
      </div>
      <TrendChart series={series} />
      <div className="flex justify-between text-xs text-neutral-400">
        <span>{series.length > 0 ? `${formatPrice(series[0])} then` : '—'}</span>
        <span>{series.length > 0 ? `${formatPrice(series[series.length - 1])} now` : '—'}</span>
      </div>
    </section>
  )
}

/**
 * Collapsible on phones, always open from `sm` up.
 *
 * Not a `<details>`: a closed one hides its content through the UA stylesheet,
 * which a media query cannot reliably override, so it would stay collapsed on
 * desktop too. An explicit `hidden sm:block` says exactly what is meant.
 */
function FunStatsCard({ avgInput }: { avgInput: number | null }) {
  const [open, setOpen] = useState(false)
  const title = 'What that buys you, at today’s avg input price'

  return (
    <section className="mb-4 rounded-2xl border border-neutral-200 bg-white px-4 py-3 sm:px-6 sm:py-[18px]">
      <h2 className="m-0 hidden text-xs font-semibold uppercase tracking-wide text-neutral-500 sm:mb-3.5 sm:block">
        {title}
      </h2>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="fun-stats"
        className="flex min-h-9 w-full items-center justify-between gap-2 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500 sm:hidden"
      >
        {title}
        <span aria-hidden className="text-neutral-400">
          {open ? '▲' : '▼'}
        </span>
      </button>

      <div id="fun-stats" className={`${open ? 'mt-3 block' : 'hidden'} sm:mt-0 sm:block`}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fit,minmax(190px,1fr))] sm:gap-4">
          {FUN_ITEMS.map((item) => (
            <div key={item.label}>
              <div className="text-[20px] font-bold tabular-nums tracking-tight text-emerald-600 sm:text-[26px]">
                {avgInput === null ? '—' : formatCost((item.tokens / 1_000_000) * avgInput)}
              </div>
              <div className="mt-1 text-[13px] text-neutral-700 sm:text-[13.5px]">{item.label}</div>
              <div className="mt-px text-xs text-neutral-400">
                ≈{formatCompact(item.tokens)} tokens
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11.5px] text-neutral-400">
          Token counts are rough estimates for illustration, not measured figures.
        </p>
      </div>
    </section>
  )
}

interface Entry {
  row: ExplorerRow
  blended: number | null
  isFree: boolean
}

function PriceTable({
  entries,
  sort,
  pinnedSet,
  onTogglePin,
  compareSet,
  onToggleCompare,
  bestValueIds,
  topValueId,
  expandedId,
  onToggle,
}: {
  entries: Entry[]
  sort: SortState<SortKey>
  pinnedSet: Set<string>
  onTogglePin: (id: string) => void
  compareSet: Set<string>
  onToggleCompare: (key: string) => void
  bestValueIds: Set<string>
  topValueId: string | null
  expandedId: string | null
  onToggle: (id: string) => void
}) {
  /*
   * The wrapper scrolls in both axes and bounds its own height.
   *
   * A horizontal-only wrapper doesn't work here: setting `overflow-x: auto`
   * makes `overflow-y` compute to `auto` as well, which turns the wrapper into
   * the sticky containing block. The header then pins relative to the wrapper
   * rather than the viewport, and any `top` offset pushes it *into* the middle
   * of the table, hiding rows behind it.
   *
   * Making the wrapper an explicit scroll container instead means the header
   * sticks at its own top (offset 0) and the toolbar above can never collide
   * with it, since the rows scroll underneath both.
   */
  return (
    <div className="max-h-[70vh] overflow-auto overscroll-contain rounded-xl border border-neutral-200 bg-white">
      <table className="w-full min-w-[900px] border-collapse text-sm">
        <caption className="sr-only">LLM API pricing by model, in USD per million tokens</caption>
        <thead>
          <tr>
            {/* Rank and Model are pinned as a pair. Widths are fixed here so
                the second column's offset can't drift, which is what broke the
                prototype's hard-coded 220px. */}
            <th scope="col" className={`${TH} sticky left-0 top-0 z-30 w-10 text-center`}>
              <span title={`Tick up to ${MAX_COMPARED} models to compare`}>⇄</span>
              <span className="sr-only">Select for comparison</span>
            </th>
            <th scope="col" className={`${TH} sticky left-10 top-0 z-30 w-11 text-left`}>
              #
            </th>
            <SortHeader
              column="model"
              label="Model"
              sort={sort}
              className={`${TH} sticky left-[84px] top-0 z-30 min-w-[220px]`}
            />
            <SortHeader
              column="provider"
              label="Provider"
              sort={sort}
              className={`${TH} top-0 z-20`}
            />
            <SortHeader
              column="input"
              label="Input /1M"
              sort={sort}
              numeric
              className={`${TH} top-0 z-20`}
            />
            <SortHeader
              column="cached"
              label="Cached /1M"
              sort={sort}
              numeric
              className={`${TH} top-0 z-20`}
            />
            <SortHeader
              column="output"
              label="Output /1M"
              sort={sort}
              numeric
              className={`${TH} top-0 z-20`}
            />
            <SortHeader
              column="value"
              label="Blended /1M"
              sort={sort}
              numeric
              title="Sort by blended price — the same ranking as Best value"
              className={`${TH} top-0 z-20`}
            />
            <SortHeader
              column="context"
              label="Context"
              sort={sort}
              numeric
              className={`${TH} top-0 z-20`}
            />
            <th scope="col" className={`${TH} top-0 z-20 min-w-[160px] text-left`}>
              Notes
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry, index) => (
            <PriceRow
              key={`${entry.row.provider}/${entry.row.model_id}`}
              entry={entry}
              pinned={pinnedSet.has(entry.row.model_id)}
              onTogglePin={onTogglePin}
              compared={compareSet.has(modelKey(entry.row))}
              compareFull={compareSet.size >= MAX_COMPARED}
              onToggleCompare={onToggleCompare}
              rank={index + 1}
              zebra={index % 2 === 1}
              isBest={bestValueIds.has(entry.row.model_id)}
              isTop={entry.row.model_id === topValueId}
              expanded={expandedId === entry.row.model_id}
              onToggle={onToggle}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * Alignment is deliberately absent: sortable headings set their own, and two
 * competing `text-*` utilities on one element are resolved by stylesheet order
 * rather than by the order they appear in the class string.
 */
const TH =
  'sticky bg-white px-3 py-2.5 text-xs font-semibold text-neutral-500 whitespace-nowrap border-b border-neutral-200'

function PriceRow({
  entry,
  pinned,
  onTogglePin,
  compared,
  compareFull,
  onToggleCompare,
  rank,
  zebra,
  isBest,
  isTop,
  expanded,
  onToggle,
}: {
  entry: Entry
  pinned: boolean
  onTogglePin: (id: string) => void
  compared: boolean
  compareFull: boolean
  onToggleCompare: (key: string) => void
  rank: number
  zebra: boolean
  isBest: boolean
  isTop: boolean
  expanded: boolean
  onToggle: (id: string) => void
}) {
  const { row, blended, isFree } = entry
  const background = isBest ? 'rgba(5,150,105,0.06)' : zebra ? '#FAFAFA' : '#FFFFFF'
  const cellStyle = { background }
  const detailId = `detail-${row.provider}-${row.model_id}`

  return (
    <>
      <tr
        style={{ background }}
        className="cursor-pointer border-b border-neutral-100 hover:bg-neutral-50"
        onClick={() => onToggle(row.model_id)}
      >
        <td style={cellStyle} className="sticky left-0 z-10 px-2 py-2.5 text-center">
          <CompareCheckbox
            checked={compared}
            displayName={row.display_name}
            disabled={!compared && compareFull}
            onToggle={() => onToggleCompare(modelKey(row))}
          />
        </td>
        <td
          style={cellStyle}
          className="sticky left-10 z-10 px-3 py-2.5 text-[13px] text-neutral-400"
        >
          {rank}
        </td>
        <td style={cellStyle} className="sticky left-[84px] z-10 px-3 py-2.5">
          {/*
            The star stays on the name's first line. Previously the whole row
            was a wrap container, so a long name pushed the star onto a line of
            its own and doubled the row height on narrow screens.
          */}
          <div className="flex items-start gap-1.5">
            <StarButton
              pinned={pinned}
              displayName={row.display_name}
              onToggle={() => onTogglePin(row.model_id)}
              className="-mt-0.5"
            />
            {/* The row is clickable for mouse users, but the toggle is a real
                button so it's reachable and announced for keyboard users. */}
            {/* A link, not a button. The model page is a real destination
                and the home page is the strongest page pointing at it, so the
                markup has to carry an href with the model's name as its anchor
                text — a button is invisible to a crawler. A plain click still
                opens the detail card, which is what the row is for. */}
            <Link
              href={modelPath(row.provider, row.model_id)}
              onClick={(event) => {
                event.stopPropagation()
                if (opensElsewhere(event)) return
                event.preventDefault()
                onToggle(row.model_id)
              }}
              aria-expanded={expanded}
              aria-controls={detailId}
              className="text-left font-semibold text-neutral-900 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-emerald-600"
            >
              {row.display_name}
            </Link>
            {isFree && (
              <span className="mt-0.5 whitespace-nowrap rounded-full bg-sky-50 px-1.5 py-0.5 text-[10px] font-bold text-sky-700">
                Free
              </span>
            )}
            {isTop && (
              <span className="mt-0.5 whitespace-nowrap rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">
                Best value
              </span>
            )}
          </div>
        </td>
        <td className="whitespace-nowrap px-3 py-2.5">
          {/* The row toggles the detail card; the provider is a real link out
              to its hub, so its click must not also expand the row. */}
          <Link
            href={providerPath(row.provider)}
            onClick={(event) => event.stopPropagation()}
            className="inline-flex items-center gap-1.5 text-[13px] text-neutral-700 underline-offset-2 hover:text-emerald-700 hover:underline"
          >
            <span
              className="inline-block h-2 w-2 shrink-0 rounded-full"
              style={{ background: providerColor(row.provider) }}
            />
            {row.provider_name}
          </Link>
        </td>
        <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-neutral-900">
          {formatPrice(row.input)}
        </td>
        <td className="px-3 py-2.5 text-right tabular-nums text-neutral-700">
          {formatPrice(row.cached_input)}
        </td>
        <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-neutral-900">
          {formatPrice(row.output)}
        </td>
        <td className="px-3 py-2.5 text-right tabular-nums text-neutral-700">
          {formatPrice(blended)}
        </td>
        <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-neutral-700">
          {formatContext(row.context_window)}
        </td>
        <td className="px-3 py-2.5 text-[12.5px] text-neutral-500">
          {SOURCE_LABELS[row.source_kind] ?? row.source_kind}
          {row.tags.includes('flagship') ? ' · Flagship' : ''}
        </td>
      </tr>

      {expanded && (
        <tr id={detailId}>
          <td colSpan={10} className="border-b border-neutral-100 bg-neutral-50 px-4 pb-4 pt-3">
            <ModelDetails row={row} />
          </td>
        </tr>
      )}
    </>
  )
}

/*
 * The explorer used to render its own compact footer here.
 *
 * It sat directly under the table, which put a footer-styled block in the
 * middle of the home page — above the provider links and the FAQ — and it
 * duplicated the collection note and the Sources/About/Terms links that
 * SiteFooter already carries. The page now ends with the same SiteFooter as
 * every other route.
 */
