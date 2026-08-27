import Link from 'next/link'
import { formatCost, formatPrice } from '@/lib/format.ts'
import { rankOffers, type Offer } from '@/lib/offers.ts'
import { HEADLINE_WORKLOAD } from '@/pipeline/monitor.ts'
import { modelPath } from '@/lib/seo.ts'

/**
 * 013: the cross-provider comparison on a model's page — every seller of
 * the same canonical model, ranked by what the standard workload costs,
 * cheapest called out, savings measured against buying from the vendor
 * directly. Ranking comes from the one comparison engine (lib/offers.ts);
 * this component only renders its answer.
 */

const TYPE_LABELS: Record<string, string> = {
  vendor: 'Vendor',
  cloud: 'Cloud',
  router: 'Host',
}

function promoBadge(offer: Offer) {
  if (offer.priceLayer !== 'promo') return null
  const ends = offer.promoEndsAt ? ` · ends ${offer.promoEndsAt.slice(0, 10)}` : ''
  return (
    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">
      promo{ends}
    </span>
  )
}

export function OfferComparison({
  offers,
  viewedProvider,
}: {
  offers: Offer[]
  viewedProvider: string
}) {
  const ranked = rankOffers(offers, HEADLINE_WORKLOAD)
  const freeRoutes = offers.filter((o) => o.offerTier === 'free')
  if (ranked.priced.length + ranked.unpriced.length + freeRoutes.length < 2) return null

  return (
    <>
    <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
      <table className="w-full min-w-[720px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
            <th className="px-4 py-3 font-medium">Provider</th>
            <th className="px-4 py-3 font-medium">Input /1M</th>
            <th className="px-4 py-3 font-medium">Cached /1M</th>
            <th className="px-4 py-3 font-medium">Output /1M</th>
            <th className="px-4 py-3 font-medium">1M in + 1M out</th>
            <th className="px-4 py-3 font-medium">vs vendor</th>
          </tr>
        </thead>
        <tbody>
          {ranked.priced.map(({ offer, cost, savingsVsVendor }, index) => (
            <tr
              key={`${offer.providerSlug}:${offer.modelId}`}
              className={`border-b border-neutral-100 last:border-0 ${
                index === 0 ? 'bg-emerald-50/60' : ''
              }`}
            >
              <td className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={modelPath(offer.providerSlug, offer.modelId)}
                    className="font-medium text-neutral-900 underline-offset-2 hover:underline"
                  >
                    {offer.providerName}
                  </Link>
                  <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[11px] text-neutral-600">
                    {TYPE_LABELS[offer.providerType] ?? offer.providerType}
                  </span>
                  {index === 0 ? (
                    <span className="rounded bg-emerald-600 px-1.5 py-0.5 text-[11px] font-semibold text-white">
                      Cheapest
                    </span>
                  ) : null}
                  {promoBadge(offer)}
                  {offer.providerSlug === viewedProvider ? (
                    <span className="text-[11px] text-neutral-400">viewing</span>
                  ) : null}
                </div>
              </td>
              <td className="px-4 py-3 tabular-nums">{formatPrice(offer.inputPrice)}</td>
              <td className="px-4 py-3 tabular-nums">{formatPrice(offer.cachedInputPrice)}</td>
              <td className="px-4 py-3 tabular-nums">{formatPrice(offer.outputPrice)}</td>
              <td className="px-4 py-3 font-medium tabular-nums">{formatCost(cost)}</td>
              <td className="px-4 py-3 tabular-nums">
                {savingsVsVendor === null || savingsVsVendor === 0
                  ? '—'
                  : savingsVsVendor > 0
                    ? `−${Math.round(savingsVsVendor * 100)}%`
                    : `+${Math.round(-savingsVsVendor * 100)}%`}
              </td>
            </tr>
          ))}
          {ranked.unpriced.map((offer) => (
            <tr
              key={`${offer.providerSlug}:${offer.modelId}`}
              className="border-b border-neutral-100 text-neutral-400 last:border-0"
            >
              <td className="px-4 py-3">
                <Link
                  href={modelPath(offer.providerSlug, offer.modelId)}
                  className="underline-offset-2 hover:underline"
                >
                  {offer.providerName}
                </Link>{' '}
                <span className="text-[11px]">({TYPE_LABELS[offer.providerType] ?? offer.providerType})</span>
              </td>
              <td className="px-4 py-3 tabular-nums">{formatPrice(offer.inputPrice)}</td>
              <td className="px-4 py-3 tabular-nums">{formatPrice(offer.cachedInputPrice)}</td>
              <td className="px-4 py-3 tabular-nums">{formatPrice(offer.outputPrice)}</td>
              {/* An unpublished price is unknown, never zero — this offer
                  cannot be ranked for the workload and says so. */}
              <td className="px-4 py-3">not comparable</td>
              <td className="px-4 py-3">—</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    {freeRoutes.length > 0 ? (
      <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50/60 px-4 py-3">
        <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-sky-900">
          Free routes
          <span className="rounded bg-sky-600 px-1.5 py-0.5 text-[11px] font-semibold text-white">
            $0
          </span>
        </div>
        <ul className="m-0 list-none space-y-1 p-0 text-sm text-sky-900">
          {freeRoutes.map((route) => (
            <li key={`${route.providerSlug}:${route.modelId}`}>
              <Link
                href={modelPath(route.providerSlug, route.modelId)}
                className="font-medium underline underline-offset-2"
              >
                {route.providerName}
              </Link>{' '}
              <code className="rounded bg-white px-1 py-0.5 font-mono text-xs">
                {route.modelId}
              </code>
            </li>
          ))}
        </ul>
        {/* Kept out of the paid ranking on purpose: $0 with strings attached
            is a different product from a metered price. */}
        <p className="mb-0 mt-2 text-xs text-sky-800">
          Free routes are rate-limited, can rotate off the roster without
          notice, and may differ in context, tools or caching from the paid
          door. Always confirm on the provider&apos;s page before depending
          on one.
        </p>
      </div>
    ) : null}
    </>
  )
}
