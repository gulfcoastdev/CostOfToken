'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

/**
 * `accent` marks the one link worth pulling out of the row.
 *
 * The calculator answers the question the table only approximates — cost at
 * your own workload — and as a plain link it read as one of five equals.
 */
const LINKS: Array<{ href: string; label: string; accent?: boolean }> = [
  { href: '/', label: 'Home' },
  { href: '/providers', label: 'Providers' },
  { href: '/calculator', label: 'Calculator', accent: true },
  { href: '/about', label: 'About' },
  { href: '/api-docs', label: 'API' },
]

/**
 * Site navigation, rendered from the root layout so every page carries it.
 *
 * These are real anchors rather than script-driven navigation, so the links
 * are followable by crawlers — which is also what lets the provider hub and
 * the API page be discovered from anywhere on the site.
 */
export function SiteNav() {
  const pathname = usePathname()

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`)

  return (
    <nav aria-label="Main" className="border-b border-neutral-200 bg-white/80 backdrop-blur">
      <div className="mx-auto flex max-w-[1120px] items-center gap-1 px-5 py-2.5">
        <Link
          href="/"
          className="mr-3 shrink-0 text-[15px] font-bold tracking-tight text-neutral-950 hover:text-emerald-700"
        >
          CostOfToken
        </Link>
        {/*
          Scrolls rather than wraps. Wrapped, the last links dropped onto a
          second line under the logo, which read as a stray heading rather than
          navigation. `min-w-0` lets the list actually shrink inside the flex
          row — without it the container refuses to go below its content width
          and nothing scrolls.
        */}
        <ul className="-mx-1 flex min-w-0 items-center gap-1 overflow-x-auto px-1 p-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {LINKS.map((link) => {
            const active = isActive(link.href)
            return (
              <li key={link.href} className="list-none">
                <Link
                  href={link.href}
                  aria-current={active ? 'page' : undefined}
                  className={`inline-block whitespace-nowrap rounded-lg px-3 py-1.5 text-[14px] font-medium transition-colors ${
                    active
                      ? 'bg-emerald-50 text-emerald-700'
                      : link.accent
                        ? 'border border-emerald-200 bg-emerald-50/60 text-emerald-700 hover:bg-emerald-50'
                        : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900'
                  }`}
                >
                  {link.label}
                </Link>
              </li>
            )
          })}
        </ul>
      </div>
    </nav>
  )
}
