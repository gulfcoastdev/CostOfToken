import Link from 'next/link'
import { jsonLdGraph } from '@/lib/seo.ts'

/** Structured data, emitted as a single @graph document per page. */
export function JsonLd({ nodes }: { nodes: Array<Record<string, unknown>> }) {
  return (
    <script
      type="application/ld+json"
      // Content is built from our own database, not user input.
      dangerouslySetInnerHTML={{ __html: jsonLdGraph(nodes) }}
    />
  )
}

export function Breadcrumbs({ trail }: { trail: Array<{ name: string; path?: string }> }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-4 text-[13px] text-neutral-500">
      <ol className="flex flex-wrap items-center gap-1.5">
        {trail.map((entry, index) => (
          <li key={entry.name} className="flex items-center gap-1.5">
            {index > 0 && <span aria-hidden="true">/</span>}
            {entry.path ? (
              <Link href={entry.path} className="underline underline-offset-2 hover:text-neutral-800">
                {entry.name}
              </Link>
            ) : (
              <span className="text-neutral-700">{entry.name}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  )
}

export function PageShell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto max-w-[1120px] px-5 pb-14 pt-7">{children}</main>
}

export function SiteFooter() {
  return (
    <footer className="mt-10 border-t border-neutral-300 pt-5 text-[12.5px] text-neutral-500">
      <p className="m-0 max-w-2xl">
        Prices are read daily from each vendor&apos;s published pricing page where one is machine
        readable, and from the OpenRouter catalogue otherwise (marked <em>Via OpenRouter</em> — a
        reseller, whose prices can differ from the vendor&apos;s own). Standard tier only; batch and
        priority tiers are excluded. Always confirm against the vendor before committing spend.
      </p>
      <p className="m-0 mt-2">
        <Link href="/" className="underline underline-offset-2 hover:text-neutral-800">
          All models
        </Link>{' '}
        ·{' '}
        <a href="/api/v1/prices" className="underline underline-offset-2 hover:text-neutral-800">
          JSON API
        </a>{' '}
        ·{' '}
        <a href="/llms.txt" className="underline underline-offset-2 hover:text-neutral-800">
          llms.txt
        </a>
      </p>
    </footer>
  )
}

/** Compact price row used on provider and model pages. */
export function PriceStat({
  label,
  value,
  accent,
}: {
  label: string
  value: string
  accent?: boolean
}) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white px-4 py-3">
      <div
        className={`text-2xl font-bold tabular-nums tracking-tight ${
          accent ? 'text-emerald-600' : 'text-neutral-900'
        }`}
      >
        {value}
      </div>
      <div className="mt-0.5 text-xs text-neutral-500">{label}</div>
    </div>
  )
}
