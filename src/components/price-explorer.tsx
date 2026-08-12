'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  blendedPrice,
  formatCompact,
  formatContext,
  formatCost,
  formatPrice,
  formatRelativeTime,
} from '@/lib/format.ts'
import type { PriceRowV1 } from '@/lib/types.ts'
import { DEFAULT_FEATURED_MODEL_IDS, MAX_FEATURED } from '../../data/featured.ts'
import { FeaturedModels } from './featured-models.tsx'
import { providerColor, SOURCE_LABELS } from './provider-colors.ts'
import { Sparkline, TrendChart } from './sparkline.tsx'

export interface ExplorerRow extends PriceRowV1 {
  trend: { series: number[]; lastChangedAt: string | null; changeCount: number } | null
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

export interface InitialFilters {
  providers: string[]
  flagship: boolean
  under1: boolean
  million: boolean
  modality: string
  search: string
  sort: SortKey
  /** Pinned model ids from the URL, or null to fall back to storage/defaults. */
  pins: string[] | null
}

type SortKey = 'value' | 'input' | 'output' | 'context' | 'provider'

const SORT_LABELS: Array<{ value: SortKey; label: string }> = [
  { value: 'value', label: 'Sort: Best value' },
  { value: 'input', label: 'Sort: Lowest input' },
  { value: 'output', label: 'Sort: Lowest output' },
  { value: 'context', label: 'Sort: Largest context' },
  { value: 'provider', label: 'Sort: Provider A–Z' },
]

/** Approximate token counts, for illustrating what an average prompt costs. */
const FUN_ITEMS = [
  { label: 'The Bible, cover to cover', tokens: 1_000_000 },
  { label: 'The Harry Potter series (all 7 books)', tokens: 1_500_000 },
  { label: 'All of English Wikipedia', tokens: 6_400_000_000 },
]

const MODALITIES = ['text', 'vision', 'audio', 'video', 'image']
const SORT_KEYS: SortKey[] = ['value', 'input', 'output', 'context', 'provider']

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
    modality: '',
    search: '',
    sort: 'value',
    pins: null,
  }
  if (typeof window === 'undefined') return empty

  const params = new URLSearchParams(window.location.search)
  const known = new Set(providerSlugs)
  const modality = (params.get('modality') ?? '').toLowerCase()
  const sort = params.get('sort') as SortKey | null
  const rawPins = params.get('pins')

  return {
    providers: (params.get('providers') ?? '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter((value) => known.has(value)),
    flagship: params.get('flagship') === '1',
    under1: params.get('under1') === '1',
    million: params.get('million') === '1',
    modality: MODALITIES.includes(modality) ? modality : '',
    search: params.get('q') ?? '',
    sort: sort && SORT_KEYS.includes(sort) ? sort : 'value',
    // Absent means no explicit choice, so stored pins still apply. An empty
    // value is a real choice: the sender pinned nothing.
    pins:
      rawPins === null
        ? null
        : rawPins.split(',').map((v) => v.trim()).filter(Boolean),
  }
}

export function PriceExplorer({ rows, providers, updatedAt, providerSlugs }: ExplorerProps) {
  // Server and first client render must agree, so state starts at the defaults
  // and the URL is applied in an effect below.
  const [selectedProviders, setSelectedProviders] = useState<string[]>([])
  const [flagshipOnly, setFlagshipOnly] = useState(false)
  const [under1, setUnder1] = useState(false)
  const [million, setMillion] = useState(false)
  const [modality, setModality] = useState('')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortKey>('value')
  const [urlApplied, setUrlApplied] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // `null` means "no explicit choice yet", which renders the curated default.
  // A URL parameter wins over stored preferences so a shared link shows the
  // sender's selection rather than the recipient's.
  const [pins, setPins] = useState<string[] | null>(null)
  const [pinNotice, setPinNotice] = useState<string | null>(null)

  // Apply the URL once, on mount.
  useEffect(() => {
    const fromUrl = readUrlFilters(providerSlugs)
    setSelectedProviders(fromUrl.providers)
    setFlagshipOnly(fromUrl.flagship)
    setUnder1(fromUrl.under1)
    setMillion(fromUrl.million)
    setModality(fromUrl.modality)
    setSearch(fromUrl.search)
    setSort(fromUrl.sort)
    if (fromUrl.pins !== null) setPins(fromUrl.pins)
    setUrlApplied(true)
  }, [providerSlugs])

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

  // Resolve ids to rows, preserving the pinned order. Ids that no longer exist
  // are dropped rather than rendered as blanks.
  const featuredRows = useMemo(() => {
    const byId = new Map(rows.map((row) => [row.model_id, row]))
    return effectivePins
      .map((id) => byId.get(id))
      .filter((row): row is ExplorerRow => row !== undefined)
  }, [rows, effectivePins])

  const pinnedSet = useMemo(() => new Set(effectivePins), [effectivePins])

  // --- filtering ----------------------------------------------------------
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return rows.filter((row) => {
      if (selectedProviders.length > 0 && !selectedProviders.includes(row.provider)) return false
      if (flagshipOnly && !row.tags.includes('flagship')) return false
      if (under1 && !(row.input !== null && row.input < 1)) return false
      if (million && !(row.context_window !== null && row.context_window >= 1_000_000)) return false
      if (modality && !row.modality.includes(modality)) return false
      if (query) {
        const haystack = `${row.model_id} ${row.display_name} ${row.provider_name}`.toLowerCase()
        if (!haystack.includes(query)) return false
      }
      return true
    })
  }, [rows, selectedProviders, flagshipOnly, under1, million, modality, search])

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
    const byBlended = (a: typeof list[number], b: typeof list[number]) =>
      (a.blended ?? Number.POSITIVE_INFINITY) - (b.blended ?? Number.POSITIVE_INFINITY)

    switch (sort) {
      case 'input':
        list.sort(
          (a, b) =>
            (a.row.input ?? Number.POSITIVE_INFINITY) - (b.row.input ?? Number.POSITIVE_INFINITY),
        )
        break
      case 'output':
        list.sort(
          (a, b) =>
            (a.row.output ?? Number.POSITIVE_INFINITY) - (b.row.output ?? Number.POSITIVE_INFINITY),
        )
        break
      case 'context':
        list.sort((a, b) => (b.row.context_window ?? 0) - (a.row.context_window ?? 0))
        break
      case 'provider':
        list.sort(
          (a, b) =>
            a.row.provider_name.localeCompare(b.row.provider_name) ||
            a.row.model_id.localeCompare(b.row.model_id),
        )
        break
      default:
        list.sort(byBlended)
    }
    return list
  }, [scored, sort])

  // --- aggregates ---------------------------------------------------------
  const stats = useMemo(() => {
    const inputs = filtered.map((r) => r.input).filter((v): v is number => v !== null)
    const outputs = filtered.map((r) => r.output).filter((v): v is number => v !== null)
    const mean = (values: number[]) =>
      values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : null
    const avgInput = mean(inputs)
    const avgOutput = mean(outputs)
    return {
      avgInput,
      avgOutput,
      avgBlended: avgInput !== null && avgOutput !== null ? (avgInput + avgOutput) / 2 : null,
    }
  }, [filtered])

  // Page-level trend: the mean input price across the filtered set at each
  // historical sample point.
  const trendSeries = useMemo(() => {
    const withTrend = filtered.filter((r) => r.trend && r.trend.series.length > 0)
    if (withTrend.length === 0) return []
    const points = withTrend[0].trend?.series.length ?? 0
    return Array.from({ length: points }, (_, index) => {
      const values = withTrend
        .map((r) => r.trend?.series[index])
        .filter((v): v is number => v !== undefined)
      return values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : 0
    })
  }, [filtered])

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
    if (modality) params.set('modality', modality)
    if (search.trim()) params.set('q', search.trim())
    if (sort !== 'value') params.set('sort', sort)
    if (pins !== null) params.set('pins', pins.join(','))
    return params.toString()
  }, [selectedProviders, flagshipOnly, under1, million, modality, search, sort, pins])

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
    setModality('')
    setSearch('')
  }

  const hasFilters =
    selectedProviders.length > 0 || flagshipOnly || under1 || million || modality !== '' || search !== ''

  return (
    <div className="mx-auto max-w-[1120px] px-5 pb-14 pt-7">
      <Header updatedAt={updatedAt} />

      <FeaturedModels
        rows={featuredRows}
        isCustom={isCustomPins}
        onUnpin={togglePin}
        onReset={() => persistPins(null)}
      />

      {pinNotice && (
        <p role="status" className="mb-3 text-[13px] text-amber-400">
          {pinNotice}
        </p>
      )}

      <div className="mb-4 flex flex-wrap gap-3.5">
        <StatsCard stats={stats} count={filtered.length} />
        <TrendCard series={trendSeries} pct={trendPct} />
      </div>

      <FunStatsCard avgInput={stats.avgInput} />

      {/*
        Not sticky on small screens. Wrapped across five rows it takes roughly
        half a phone viewport, so pinning it leaves almost nothing for the table
        it is meant to filter — and it overlapped the rows.

        z-40 keeps it above the table's own sticky header, which uses z-30 for
        the pinned columns. At z-20 the two tied and DOM order decided, so the
        header painted over the toolbar.
      */}
      <div className="relative z-40 mb-4 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm sm:sticky sm:top-0">
        <div className="flex flex-wrap gap-2">
          {providers.map((provider) => {
            const active = selectedProviders.includes(provider.slug)
            return (
              <button
                key={provider.slug}
                type="button"
                onClick={() => toggleProvider(provider.slug)}
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
            className="min-w-[160px] flex-1 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none placeholder:text-neutral-400 focus-visible:ring-2 focus-visible:ring-emerald-600"
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

          <label className="sr-only" htmlFor="modality-filter">
            Filter by modality
          </label>
          <select
            id="modality-filter"
            value={modality}
            onChange={(event) => setModality(event.target.value)}
            className="cursor-pointer rounded-lg border border-neutral-200 bg-white px-2.5 py-2 text-sm text-neutral-900"
          >
            <option value="">Any modality</option>
            {MODALITIES.map((option) => (
              <option key={option} value={option}>
                {option[0].toUpperCase() + option.slice(1)}
              </option>
            ))}
          </select>

          <label className="sr-only" htmlFor="sort-order">
            Sort order
          </label>
          <select
            id="sort-order"
            value={sort}
            onChange={(event) => setSort(event.target.value as SortKey)}
            className="cursor-pointer rounded-lg border border-neutral-200 bg-white px-2.5 py-2 text-sm text-neutral-900"
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
            className="whitespace-nowrap rounded-lg bg-emerald-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
          >
            {copied ? 'Copied!' : 'Copy link'}
          </button>
          <button
            type="button"
            onClick={shareLink}
            className="whitespace-nowrap rounded-lg border border-emerald-600 bg-white px-3.5 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-50"
          >
            Share
          </button>
        </div>
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-3">
        <p className="text-[13px] text-neutral-600">
          Showing {sorted.length} of {rows.length} models · select a row for details
        </p>
        {hasFilters && (
          <button
            type="button"
            onClick={resetFilters}
            className="text-[13px] font-medium text-emerald-700 underline underline-offset-2 hover:text-emerald-800"
          >
            Clear filters
          </button>
        )}
      </div>

      <PriceTable
        entries={sorted}
        pinnedSet={pinnedSet}
        onTogglePin={togglePin}
        bestValueIds={bestValueIds}
        topValueId={topValueId}
        expandedId={expandedId}
        onToggle={(id) => setExpandedId((current) => (current === id ? null : id))}
      />

      <Footer />
    </div>
  )
}

// ---------------------------------------------------------------------------

function chipClass(active: boolean): string {
  const base =
    'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors cursor-pointer'
  return active
    ? `${base} border-emerald-600 bg-emerald-50 text-emerald-700`
    : `${base} border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300`
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
  stats: { avgInput: number | null; avgOutput: number | null; avgBlended: number | null }
  count: number
}) {
  return (
    <section className="min-w-[240px] flex-1 rounded-2xl border border-neutral-200 bg-white px-6 py-5">
      <h2 className="m-0 mb-3.5 text-xs font-semibold uppercase tracking-wide text-neutral-500">
        Average across {count} selected model{count === 1 ? '' : 's'}
      </h2>
      <div className="flex flex-wrap gap-7">
        <Stat label="Avg input /1M" value={formatPrice(stats.avgInput)} />
        <Stat label="Avg output /1M" value={formatPrice(stats.avgOutput)} />
        <Stat label="Avg blended /1M" value={formatPrice(stats.avgBlended)} accent />
      </div>
    </section>
  )
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <div
        className={`text-[34px] font-bold tabular-nums leading-none tracking-tight ${
          accent ? 'text-emerald-600' : 'text-neutral-900'
        }`}
      >
        {value}
      </div>
      <div className="mt-1.5 text-[12.5px] text-neutral-400">{label}</div>
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

function FunStatsCard({ avgInput }: { avgInput: number | null }) {
  return (
    <section className="mb-4 rounded-2xl border border-neutral-200 bg-white px-6 py-[18px]">
      <h2 className="m-0 mb-3.5 text-xs font-semibold uppercase tracking-wide text-neutral-500">
        What that buys you, at today&apos;s avg input price
      </h2>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-4">
        {FUN_ITEMS.map((item) => (
          <div key={item.label}>
            <div className="text-[26px] font-bold tabular-nums tracking-tight text-emerald-600">
              {avgInput === null ? '—' : formatCost((item.tokens / 1_000_000) * avgInput)}
            </div>
            <div className="mt-1 text-[13.5px] text-neutral-700">{item.label}</div>
            <div className="mt-px text-xs text-neutral-400">≈{formatCompact(item.tokens)} tokens</div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[11.5px] text-neutral-400">
        Token counts are rough estimates for illustration, not measured figures.
      </p>
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
  pinnedSet,
  onTogglePin,
  bestValueIds,
  topValueId,
  expandedId,
  onToggle,
}: {
  entries: Entry[]
  pinnedSet: Set<string>
  onTogglePin: (id: string) => void
  bestValueIds: Set<string>
  topValueId: string | null
  expandedId: string | null
  onToggle: (id: string) => void
}) {
  if (entries.length === 0) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white p-10 text-center">
        <p className="text-sm text-neutral-600">No models match these filters.</p>
      </div>
    )
  }

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
        <caption className="sr-only">
          LLM API pricing by model, in USD per million tokens
        </caption>
        <thead>
          <tr>
            {/* Rank and Model are pinned as a pair. Widths are fixed here so
                the second column's offset can't drift, which is what broke the
                prototype's hard-coded 220px. */}
            <th scope="col" className={`${TH} sticky left-0 top-0 z-30 w-11`}>
              #
            </th>
            <th scope="col" className={`${TH} sticky left-11 top-0 z-30 min-w-[220px]`}>
              Model
            </th>
            <th scope="col" className={`${TH} top-0 z-20`}>
              Provider
            </th>
            <th scope="col" className={`${TH} top-0 z-20 text-right`}>
              Input /1M
            </th>
            <th scope="col" className={`${TH} top-0 z-20 text-right`}>
              Cached /1M
            </th>
            <th scope="col" className={`${TH} top-0 z-20 text-right`}>
              Output /1M
            </th>
            <th scope="col" className={`${TH} top-0 z-20 text-right`}>
              Blended /1M
            </th>
            <th scope="col" className={`${TH} top-0 z-20 text-right`}>
              Context
            </th>
            <th scope="col" className={`${TH} top-0 z-20 min-w-[160px]`}>
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

const TH =
  'sticky bg-white px-3 py-2.5 text-left text-xs font-semibold text-neutral-500 whitespace-nowrap border-b border-neutral-200'

function PriceRow({
  entry,
  pinned,
  onTogglePin,
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

  const trend = row.trend
  const pctChange =
    trend && trend.series.length >= 2 && trend.series[0] > 0
      ? ((trend.series[trend.series.length - 1] - trend.series[0]) / trend.series[0]) * 100
      : 0
  const sparklineColor =
    pctChange < -0.5 ? '#059669' : pctChange > 0.5 ? '#DC2626' : '#A3A3A3'

  return (
    <>
      <tr
        style={{ background }}
        className="cursor-pointer border-b border-neutral-100 hover:bg-neutral-50"
        onClick={() => onToggle(row.model_id)}
      >
        <td style={cellStyle} className="sticky left-0 z-10 px-3 py-2.5 text-[13px] text-neutral-400">
          {rank}
        </td>
        <td style={cellStyle} className="sticky left-11 z-10 px-3 py-2.5">
          {/*
            The star stays on the name's first line. Previously the whole row
            was a wrap container, so a long name pushed the star onto a line of
            its own and doubled the row height on narrow screens.
          */}
          <div className="flex items-start gap-1.5">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                onTogglePin(row.model_id)
              }}
              aria-pressed={pinned}
              aria-label={
                pinned
                  ? `Remove ${row.display_name} from popular models`
                  : `Add ${row.display_name} to popular models`
              }
              title={pinned ? 'Remove from Popular models' : 'Add to Popular models'}
              className={`mt-0.5 shrink-0 rounded text-base leading-none focus-visible:outline-2 focus-visible:outline-emerald-600 ${
                pinned ? 'text-amber-500' : 'text-neutral-300 hover:text-neutral-500'
              }`}
            >
              {pinned ? '★' : '☆'}
            </button>
            {/* The row is clickable for mouse users, but the toggle is a real
                button so it's reachable and announced for keyboard users. */}
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                onToggle(row.model_id)
              }}
              aria-expanded={expanded}
              aria-controls={detailId}
              className="text-left font-semibold text-neutral-900 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-emerald-600"
            >
              {row.display_name}
            </button>
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
          <span className="inline-flex items-center gap-1.5 text-[13px] text-neutral-700">
            <span
              className="inline-block h-2 w-2 shrink-0 rounded-full"
              style={{ background: providerColor(row.provider) }}
            />
            {row.provider_name}
          </span>
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
          <td
            colSpan={9}
            className="border-b border-neutral-100 bg-neutral-50 px-4 pb-4 pt-3 text-[13px] text-neutral-600"
          >
            <div className="flex flex-wrap gap-x-8 gap-y-2">
              <span>
                <strong className="font-semibold text-neutral-800">Context:</strong>{' '}
                {formatContext(row.context_window)}
                {row.max_output_tokens
                  ? ` · max output ${formatContext(row.max_output_tokens)}`
                  : ''}
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
          </td>
        </tr>
      )}
    </>
  )
}

/**
 * Describe a model's price history in words.
 *
 * Net change and "did it move" are different questions: a price that rose and
 * fell back lands at 0% while having changed twice. Reporting that as
 * "up 0%" reads as a bug, so a round trip is called out as such.
 */
function describeTrend(
  trend: ExplorerRow['trend'],
  pctChange: number,
): string {
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

function Footer() {
  return (
    <footer className="mt-7 flex flex-wrap items-baseline justify-between gap-4 border-t border-neutral-300 pt-4">
      <p className="m-0 max-w-xl text-[12.5px] text-neutral-500">
        Data sources: first-party pricing pages where published, OpenRouter catalogue as fallback
        (marked <em>Via OpenRouter</em> — a reseller, whose prices can differ from the vendor&apos;s
        own). Standard tier only; batch and priority tiers are excluded.
      </p>
      <p className="m-0 text-[12.5px] text-neutral-500">
        Public API ·{' '}
        <code className="rounded bg-neutral-200 px-1.5 py-0.5 text-[11px] text-neutral-700">
          GET /api/v1/prices
        </code>
        <br />
        <a href="/sources" className="underline underline-offset-2 hover:text-neutral-800">
          Data sources
        </a>{' '}
        ·{' '}
        <a href="/about" className="underline underline-offset-2 hover:text-neutral-800">
          About
        </a>{' '}
        ·{' '}
        <a href="/terms" className="underline underline-offset-2 hover:text-neutral-800">
          Terms
        </a>
      </p>
    </footer>
  )
}
