import type { Metadata } from 'next'
import Link from 'next/link'
import { Breadcrumbs, PageShell } from '@/components/site-chrome.tsx'
import { formatPrice } from '@/lib/format.ts'
import { getPromoOffers } from '@/lib/queries.ts'
import { modelPath } from '@/lib/seo.ts'

export const revalidate = 3600

const TITLE = 'Discounted AI Models'
const DESCRIPTION =
  'AI model offers whose seller currently declares a discount — the promo price, who is running it, and when it ends. Promos are seller-declared only, never inferred from a low price.'

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/discounts' },
  openGraph: { title: `${TITLE} — CostOfToken`, description: DESCRIPTION, url: '/discounts' },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
}

export default async function DiscountsPage() {
  const promos = await getPromoOffers().catch(() => [])

  return (
    <PageShell>
      <Breadcrumbs trail={[{ name: 'Home', path: '/' }, { name: 'Discounts' }]} />
      <h1 className="mb-2 text-3xl font-bold tracking-tight text-neutral-950">
        Models on a declared discount
      </h1>
      <p className="mb-2 max-w-3xl text-[15px] text-neutral-600">
        Only sellers that <em>declare</em> a promotion in their own pricing
        data appear here, with the deadline they publish. A merely low price
        is not a promo; a reseller undercutting a vendor is on the
        model&apos;s comparison table, not here.
      </p>
      <p className="mb-6 max-w-3xl text-sm text-neutral-500">
        Promos die — the price shown reverts when the deadline passes.
        Always confirm with the provider before committing spend.
      </p>

      {promos.length === 0 ? (
        <p className="text-neutral-600">
          No seller-declared promos in today&apos;s catalogue. Time-boxed
          discounts come and go; this page updates with the daily collection
          run.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
                <th className="px-4 py-3 font-medium">Model</th>
                <th className="px-4 py-3 font-medium">Seller</th>
                <th className="px-4 py-3 font-medium">Promo input /1M</th>
                <th className="px-4 py-3 font-medium">Promo output /1M</th>
                <th className="px-4 py-3 font-medium">Ends</th>
              </tr>
            </thead>
            <tbody>
              {promos.map((promo) => (
                <tr
                  key={`${promo.providerSlug}:${promo.modelId}`}
                  className="border-b border-neutral-100 last:border-0"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={modelPath(promo.providerSlug, promo.modelId)}
                      className="font-medium text-neutral-900 underline-offset-2 hover:underline"
                    >
                      {promo.displayName}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{promo.providerName}</td>
                  <td className="px-4 py-3 tabular-nums">{formatPrice(promo.inputPrice)}</td>
                  <td className="px-4 py-3 tabular-nums">{formatPrice(promo.outputPrice)}</td>
                  <td className="px-4 py-3 tabular-nums">
                    {promo.promoEndsAt ?? 'no date published'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PageShell>
  )
}
