import type { Metadata } from 'next'
import Link from 'next/link'
import { Breadcrumbs, JsonLd, PageShell, SiteFooter } from '@/components/site-chrome.tsx'
import { absoluteUrl, breadcrumbSchema, SITE } from '@/lib/seo.ts'

export const revalidate = 86400

const TITLE = 'Terms of Use'
const DESCRIPTION =
  'Terms for using CostOfToken and its pricing API: licence, attribution requirement, accuracy disclaimer, and acceptable use.'

/** Update when the substance changes, not on every wording tweak. */
const LAST_UPDATED = '11 August 2026'

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/terms' },
  openGraph: { title: `${TITLE} — CostOfToken`, description: DESCRIPTION, url: '/terms' },
  robots: { index: true, follow: true },
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-7">
      <h2 className="mb-2 text-xl font-semibold tracking-tight text-neutral-950">{title}</h2>
      <div className="space-y-3 text-[15px] leading-relaxed text-neutral-700">{children}</div>
    </section>
  )
}

export default function TermsPage() {
  return (
    <PageShell>
      <JsonLd
        nodes={[
          breadcrumbSchema([
            { name: 'LLM pricing', path: '/' },
            { name: 'Terms', path: '/terms' },
          ]),
          {
            '@type': 'WebPage',
            '@id': absoluteUrl('/terms#page'),
            name: TITLE,
            description: DESCRIPTION,
            url: absoluteUrl('/terms'),
            isPartOf: { '@id': absoluteUrl('/#website') },
          },
        ]}
      />

      <Breadcrumbs trail={[{ name: 'LLM pricing', path: '/' }, { name: 'Terms' }]} />

      <header className="mb-7">
        <h1 className="m-0 text-3xl font-bold tracking-tight text-neutral-950">Terms of use</h1>
        <p className="mt-2 text-[13px] text-neutral-500">Last updated {LAST_UPDATED}</p>
      </header>

      <Section title="Who we are">
        <p>
          {SITE.name} is operated by Gulf Coast Dev LLC. Using this site or its API means accepting
          these terms. If you do not accept them, please do not use the service.
        </p>
      </Section>

      <Section title="The data is informational, not authoritative">
        <p>
          Prices are read automatically from providers&apos; published pages once a day. Those pages
          change without notice, parsers break, and some rows come from a reseller catalogue rather
          than the vendor itself. Figures here may be out of date, incomplete, or wrong.
        </p>
        <p>
          <strong>
            Confirm any price against the provider before making a purchasing or engineering
            decision that depends on it.
          </strong>{' '}
          Every model page links to the exact source used and shows when it was last confirmed. See{' '}
          <Link href="/sources" className="text-emerald-700 underline underline-offset-2">
            data sources
          </Link>{' '}
          for the full methodology and what is deliberately excluded.
        </p>
        <p>
          The service is provided &ldquo;as is&rdquo;, without warranties of any kind. To the extent
          permitted by law, Gulf Coast Dev LLC is not liable for losses arising from reliance on
          this data or from any interruption of the service.
        </p>
      </Section>

      <Section title="Using the data — attribution required">
        <p>
          The pricing data is free to use, including commercially and in paid products, under{' '}
          <a
            href="https://opendatacommons.org/licenses/by/1-0/"
            target="_blank"
            rel="noopener"
            className="text-emerald-700 underline underline-offset-2"
          >
            ODC-BY 1.0
          </a>
          . The one condition is attribution: anywhere the data is displayed must carry a visible
          credit linking back to this site.
        </p>
        <pre className="overflow-x-auto rounded-lg border border-neutral-200 bg-white p-3 text-[13px] text-neutral-800">
          <code>{`Pricing data from <a href="${SITE.url}">CostOfToken</a>`}</code>
        </pre>
        <p>
          Full details, including the machine-readable form returned with every response, are on the{' '}
          <Link href="/api-docs#attribution" className="text-emerald-700 underline underline-offset-2">
            API page
          </Link>
          .
        </p>
      </Section>

      <Section title="Acceptable use of the API">
        <p>
          The API is rate limited to 60 requests per hour per IP. Do not attempt to evade that limit
          by rotating addresses or distributing requests. If you need a higher allowance, get in
          touch rather than working around it — that is what the contact below is for.
        </p>
        <p>
          Do not use the service in a way that degrades it for others, or present the data as
          your own original research.
        </p>
      </Section>

      <Section title="Trademarks and third-party content">
        <p>
          Model and company names — OpenAI, GPT, Anthropic, Claude, Google, Gemini, xAI, Grok,
          DeepSeek, Qwen, Kimi, GLM, Doubao, ERNIE and others — are the trademarks of their
          respective owners, used here descriptively to identify the products being compared.
          CostOfToken is independent and is not affiliated with, endorsed by, or sponsored by any
          provider listed.
        </p>
        <p>
          Links to provider pricing pages are provided for verification. We are not responsible for
          the content of external sites.
        </p>
      </Section>

      <Section title="Analytics and cookies">
        <p>
          We use Google Analytics to count visits and see which pages are useful. No advertising or
          cross-site tracking is used, and advertising signals are disabled. Visitors in the EU, EEA,
          UK and Switzerland are asked for consent before any analytics cookie is set, and declining
          changes nothing about the data you can see.
        </p>
      </Section>

      <Section title="Changes">
        <p>
          These terms may change as the service does. The date at the top reflects the last
          substantive revision. Continuing to use the service after a change means accepting it.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          Questions about these terms, corrections to a price, or a request for a higher API
          allowance:{' '}
          <a
            href="mailto:gulfcoastdevs@gmail.com"
            className="text-emerald-700 underline underline-offset-2"
          >
            gulfcoastdevs@gmail.com
          </a>
          .
        </p>
      </Section>

      <p className="mb-6 rounded-xl border border-neutral-200 bg-white px-5 py-4 text-[13.5px] leading-relaxed text-neutral-600">
        This page is written in plain language for clarity and is not legal advice. If the service
        starts carrying commercial weight, have a lawyer review it.
      </p>

      <SiteFooter />
    </PageShell>
  )
}
