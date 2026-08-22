import { scaleSeries } from '@/lib/chart-scale.ts'

/**
 * Both charts here scale through `scaleSeries`, which floors the range they
 * plot against. They previously scaled to the series' own min and max, so any
 * movement at all — including one the card's own badge called "Flat" — was
 * stretched to the full height of the box. See src/lib/chart-scale.ts.
 */

/** Tiny inline price sparkline. Pure presentation, no state. */
export function Sparkline({
  series,
  width = 70,
  height = 20,
  color,
}: {
  series: number[]
  width?: number
  height?: number
  color: string
}) {
  if (series.length < 2) return null

  const padding = 2
  const ys = scaleSeries(series, height, padding)

  const points = series
    .map((_value, index) => {
      const x = (index / (series.length - 1)) * (width - padding * 2) + padding
      return `${x.toFixed(1)},${ys[index].toFixed(1)}`
    })
    .join(' ')

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="shrink-0"
      aria-hidden="true"
      focusable="false"
    >
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  )
}

/** Filled area chart for the page-level blended-price trend. */
export function TrendChart({ series }: { series: number[] }) {
  if (series.length < 2) {
    return <div className="h-[90px] rounded-lg bg-neutral-100" aria-hidden="true" />
  }

  const width = 320
  const height = 100
  const padding = 8

  const ys = scaleSeries(series, height - 6, padding)
  const x = (index: number) => (index / (series.length - 1)) * 300 + 10

  const line = series.map((_value, index) => `${x(index).toFixed(1)},${ys[index].toFixed(1)}`).join(' ')
  const area = `${line} ${x(series.length - 1).toFixed(1)},90 10,90`

  return (
    <svg
      width="100%"
      height="90"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="mt-2 block"
      aria-hidden="true"
      focusable="false"
    >
      <polygon points={area} fill="rgba(5,150,105,0.12)" />
      <polyline points={line} fill="none" stroke="#059669" strokeWidth="2.5" />
    </svg>
  )
}
