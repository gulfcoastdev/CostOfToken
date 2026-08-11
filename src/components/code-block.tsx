'use client'

import { useState } from 'react'

/**
 * A code sample with a copy button.
 *
 * The code is rendered as plain text in the markup rather than injected by
 * script, so it is present for crawlers and readable with JavaScript disabled;
 * only the copy affordance needs the client.
 */
export function CodeBlock({
  code,
  label,
  language,
}: {
  code: string
  label?: string
  language?: string
}) {
  const [copied, setCopied] = useState(false)

  const copy = () => {
    navigator.clipboard?.writeText(code).catch(() => {})
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  return (
    <figure className="m-0">
      <div className="flex items-center justify-between rounded-t-xl border border-b-0 border-neutral-800 bg-neutral-800 px-4 py-2">
        <figcaption className="text-[12px] font-medium text-neutral-300">
          {label ?? language ?? 'Example'}
        </figcaption>
        <button
          type="button"
          onClick={copy}
          className="rounded px-2 py-0.5 text-[12px] font-medium text-neutral-300 transition-colors hover:bg-neutral-700 hover:text-white focus-visible:outline-2 focus-visible:outline-emerald-500"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="m-0 overflow-x-auto rounded-b-xl border border-neutral-800 bg-neutral-900 p-4 text-[13px] leading-relaxed text-neutral-100">
        <code>{code}</code>
      </pre>
    </figure>
  )
}
