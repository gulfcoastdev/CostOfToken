import Script from 'next/script'

/**
 * Google Analytics 4.
 *
 * Rendered only when a measurement id is configured *and* we're in production,
 * so local development and preview deployments don't pollute the reports with
 * traffic that isn't real. The id is not a secret — it ships in the page
 * source by design — but keeping it in an environment variable means a fork or
 * a staging copy doesn't silently report into this property.
 *
 * `afterInteractive` lets the page become usable before the tag loads;
 * analytics should never sit on the critical path of a pricing table.
 *
 * Client-side navigation is handled by GA4's own enhanced measurement, which
 * listens for History API changes. Firing page_view manually on route change
 * as well would double-count every navigation.
 */
export function Analytics() {
  const measurementId = process.env.NEXT_PUBLIC_GA_ID

  if (!measurementId || process.env.NODE_ENV !== 'production') return null

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${measurementId}`}
        strategy="afterInteractive"
      />
      <Script id="ga4-init" strategy="afterInteractive">
        {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${measurementId}');`}
      </Script>
    </>
  )
}
