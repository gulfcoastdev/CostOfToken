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
      {/*
        Consent Mode v2 defaults, set with beforeInteractive so they are in the
        dataLayer before gtag.js runs. Denied first, granted later: the reverse
        order would drop a cookie before a visitor in a consent regime had any
        chance to decline. Advertising signals stay denied permanently — this
        site does not run ads.
      */}
      <Script id="ga4-consent-default" strategy="beforeInteractive">
        {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
window.gtag = window.gtag || gtag;
gtag('consent', 'default', {
  analytics_storage: 'denied',
  ad_storage: 'denied',
  ad_user_data: 'denied',
  ad_personalization: 'denied',
  wait_for_update: 500
});`}
      </Script>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${measurementId}`}
        strategy="afterInteractive"
      />
      <Script id="ga4-init" strategy="afterInteractive">
        {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
window.gtag = window.gtag || gtag;
gtag('js', new Date());
gtag('config', '${measurementId}', { anonymize_ip: true });`}
      </Script>
    </>
  )
}
