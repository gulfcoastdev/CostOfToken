'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const LINKS = [
  { href: '/', label: 'Home' },
  { href: '/providers', label: 'Providers' },
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
          className="mr-3 text-[15px] font-bold tracking-tight text-neutral-950 hover:text-emerald-700"
        >
          CostOfToken
        </Link>
        <ul className="flex flex-wrap items-center gap-1 p-0">
          {LINKS.map((link) => {
            const active = isActive(link.href)
            return (
              <li key={link.href} className="list-none">
                <Link
                  href={link.href}
                  aria-current={active ? 'page' : undefined}
                  className={`inline-block rounded-lg px-3 py-1.5 text-[14px] font-medium transition-colors ${
                    active
                      ? 'bg-emerald-50 text-emerald-700'
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
