'use client'

import { useEffect, useState } from 'react'

/**
 * Cookie consent, shown only where it is required.
 *
 * Google Consent Mode v2: analytics storage starts denied for everyone (set in
 * an inline script before gtag loads, see analytics.tsx), then this component
 * grants it — silently outside Europe, and only on an explicit click within
 * it. Starting denied and granting is the safe order; the reverse would drop a
 * cookie before the visitor could decline.
 *
 * Region comes from a cookie set at the edge from Vercel's geolocation. Where
 * that's missing — local development, or a request that skipped middleware —
 * it falls back to the browser's timezone, which is a reasonable proxy and
 * requires no IP lookup of our own.
 */

const STORAGE_KEY = 'cot-consent.v1'
const REGION_COOKIE = 'cot-region'

type Choice = 'granted' | 'denied'

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : null
}

function needsConsent(): boolean {
  const region = readCookie(REGION_COOKIE)
  if (region === 'eu') return true
  if (region === 'other') return false

  // No region cookie: infer from timezone rather than assuming either way.
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? ''
    return zone.startsWith('Europe/') || zone === 'Atlantic/Canary' || zone === 'Atlantic/Madeira'
  } catch {
    // If we cannot tell, assume consent is required. Erring toward asking is
    // the only direction that is safe.
    return true
  }
}

function applyConsent(choice: Choice) {
  const gtag = (window as unknown as { gtag?: (...args: unknown[]) => void }).gtag
  gtag?.('consent', 'update', {
    analytics_storage: choice,
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
  })
}

export function ConsentBanner() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    let stored: string | null = null
    try {
      stored = window.localStorage.getItem(STORAGE_KEY)
    } catch {
      // Private mode: treat as no stored choice.
    }

    if (stored === 'granted' || stored === 'denied') {
      applyConsent(stored)
      return
    }

    if (needsConsent()) {
      setVisible(true)
      return
    }

    // Outside the consent regimes, analytics runs without prompting.
    applyConsent('granted')
  }, [])

  const decide = (choice: Choice) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, choice)
    } catch {
      // A failure to persist only means we ask again next visit.
    }
    applyConsent(choice)
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby="consent-title"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-neutral-200 bg-white/95 backdrop-blur"
    >
      <div className="mx-auto flex max-w-[1120px] flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p id="consent-title" className="m-0 text-sm font-semibold text-neutral-900">
            Analytics cookies
          </p>
          <p className="m-0 mt-1 max-w-2xl text-[13px] leading-relaxed text-neutral-600">
            We use Google Analytics to count visits and see which pricing pages are useful. No
            advertising or cross-site tracking. Declining changes nothing about the prices you see.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => decide('denied')}
            className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
          >
            Decline
          </button>
          <button
            type="button"
            onClick={() => decide('granted')}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  )
}
