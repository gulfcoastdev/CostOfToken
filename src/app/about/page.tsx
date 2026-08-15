import type { Metadata } from 'next'
import Link from 'next/link'
import { Breadcrumbs, JsonLd, PageShell } from '@/components/site-chrome.tsx'
import { getNetworkFeed, NETWORK_HOME } from '@/lib/network.ts'
import { absoluteUrl, breadcrumbSchema, SITE } from '@/lib/seo.ts'

/** Matches the feed's own ten-minute cache. */
export const revalidate = 600

const TITLE = 'About CostOfToken'
const DESCRIPTION =
  'Who builds CostOfToken and why: a daily-updated, independently maintained comparison of LLM API pricing from Gulf Coast Dev.'

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/about' },
  openGraph: {
    title: `${TITLE} — ${SITE.name}`,
    description: DESCRIPTION,
    url: '/about',
    type: 'website',
  },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
}

export default async function NetworkPage() {
  const feed = await getNetworkFeed()

  return (
    <PageShell>
      <JsonLd
        nodes={[
          breadcrumbSchema([
            { name: 'LLM pricing', path: '/' },
            { name: 'About', path: '/about' },
          ]),
          {
            '@type': 'WebPage',
            '@id': absoluteUrl('/about#page'),
            name: TITLE,
            url: absoluteUrl('/about'),
            description: DESCRIPTION,
            isPartOf: { '@id': absoluteUrl('/#website') },
            ...(feed
              ? {
                  mainEntity: {
                    '@type': 'ItemList',
                    name: feed.title,
                    numberOfItems: feed.projects.length,
                    itemListElement: feed.projects.map((project, index) => ({
                      '@type': 'ListItem',
                      position: index + 1,
                      name: project.name,
                      url: project.url,
                      description: project.description || undefined,
                    })),
                  },
                }
              : {}),
          },
        ]}
      />

      <Breadcrumbs trail={[{ name: 'LLM pricing', path: '/' }, { name: 'About' }]} />

      <header className="mb-7">
        <h1 className="m-0 text-3xl font-bold tracking-tight text-neutral-950">{TITLE}</h1>
        <p className="mt-2 max-w-3xl text-[15px] leading-relaxed text-neutral-700">
          CostOfToken tracks what large language model APIs actually cost. Prices are read from
          each provider&apos;s own published pricing every day, normalized to USD per 1M tokens so
          models can be compared directly, and recorded only when a number really changes.
        </p>
        <p className="mt-3 max-w-3xl text-[15px] leading-relaxed text-neutral-700">
          It exists because pricing lives on ten different pages in ten different shapes, several of
          which quote per-1K tokens, bury the standard rate behind a tab, or price long prompts
          differently without saying so on the same line. Answering &ldquo;what will this cost
          me&rdquo; should not require reading ten vendor pages.
        </p>
        <p className="mt-3 max-w-3xl text-[15px] leading-relaxed text-neutral-700">
          The data and the methodology are open:{' '}
          <Link href="/sources" className="font-medium text-emerald-700 underline underline-offset-2">
            every source is listed
          </Link>
          , and everything is available through a{' '}
          <Link href="/api-docs" className="font-medium text-emerald-700 underline underline-offset-2">
            free JSON API
          </Link>
          .
        </p>
      </header>

      <section className="mb-8 rounded-xl border border-neutral-200 bg-white px-5 py-4">
        <h2 className="m-0 text-lg font-semibold tracking-tight text-neutral-950">
          Who builds it
        </h2>
        <p className="m-0 mt-1.5 text-[15px] leading-relaxed text-neutral-700">
          CostOfToken is built and maintained by{' '}
          <a
            href={NETWORK_HOME}
            target="_blank"
            rel="noopener"
            className="font-medium text-emerald-700 underline underline-offset-2"
          >
            Gulf Coast Dev
          </a>
          , a small independent software studio. It is a product we own and keep running, not client
          work — which is why it is free, has no signup, and is not trying to sell you an LLM.
        </p>
      </section>

      {feed ? (
        <>
          <section className="mb-8">
            <h2 className="mb-3 text-xl font-semibold tracking-tight text-neutral-950">
              Other sites in the network
            </h2>
            <ul className="grid grid-cols-1 gap-3 p-0 sm:grid-cols-2">
              {feed.projects.map((project) => (
                <li key={project.url} className="list-none">
                  <a
                    href={project.url}
                    target="_blank"
                    rel="noopener"
                    className="flex h-full gap-4 rounded-xl border border-neutral-200 bg-white p-4 transition-colors hover:border-emerald-600"
                  >
                    {project.image && (
                      // Plain <img> keeps this page free of remote-image host
                      // configuration for a decorative thumbnail.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={project.image}
                        alt=""
                        width={96}
                        height={64}
                        loading="lazy"
                        decoding="async"
                        // Sources are wide screenshots; a square crop throws
                        // away most of the frame, so use a 3:2 box.
                        className="h-16 w-24 shrink-0 rounded-lg border border-neutral-100 object-cover"
                      />
                    )}
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <span className="font-semibold text-neutral-900">{project.name}</span>
                        <span className="truncate text-[12.5px] text-neutral-500">
                          {new URL(project.url).host}
                        </span>
                      </div>
                      {project.description && (
                        <p className="m-0 mt-1 text-[14px] leading-relaxed text-neutral-700">
                          {project.description}
                        </p>
                      )}
                      {project.categories.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {project.categories.map((category) => (
                            <span
                              key={category}
                              className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-600"
                            >
                              {category}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </a>
                </li>
              ))}
            </ul>
            {feed.updated && (
              <p className="mt-3 text-[12.5px] text-neutral-500">
                Network list last updated {feed.updated.slice(0, 10)}, read live from{' '}
                <a
                  href={NETWORK_HOME}
                  target="_blank"
                  rel="noopener"
                  className="underline underline-offset-2"
                >
                  cryptodev.info
                </a>
                .
              </p>
            )}
          </section>

          {feed.callout && (
            <section className="mb-8 rounded-xl border border-neutral-200 bg-white px-5 py-4">
              <h2 className="m-0 text-base font-semibold text-neutral-900">{feed.callout.title}</h2>
              {feed.callout.description && (
                <p className="m-0 mt-1.5 text-[15px] leading-relaxed text-neutral-700">
                  {feed.callout.description}
                </p>
              )}
              {feed.callout.cta && feed.callout.ctaUrl && (
                <p className="m-0 mt-2">
                  <a
                    href={feed.callout.ctaUrl}
                    target="_blank"
                    rel="noopener"
                    className="font-medium text-emerald-700 underline underline-offset-2"
                  >
                    {feed.callout.cta}
                  </a>
                </p>
              )}
            </section>
          )}
        </>
      ) : (
        <section className="mb-8 rounded-xl border border-neutral-200 bg-white px-5 py-4">
          <p className="m-0 text-[15px] text-neutral-700">
            The full list of sites lives at{' '}
            <a
              href={NETWORK_HOME}
              target="_blank"
              rel="noopener"
              className="font-medium text-emerald-700 underline underline-offset-2"
            >
              cryptodev.info/network.php
            </a>
            .
          </p>
        </section>
      )}
    </PageShell>
  )
}
