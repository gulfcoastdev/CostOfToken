import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'CostOfToken — LLM API pricing, updated daily',
  description:
    'Normalized, daily-updated pricing for LLM APIs across OpenAI, Anthropic, Google, xAI, DeepSeek and more. Free public JSON API.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      {/*
        The design frames light content cards against a near-black page. An
        explicit text colour is set here rather than inherited: the prototype
        left `color:#171717` on a `#0A0808` background, so any text added
        outside a white card would have been near-black on near-black.
      */}
      <body className="min-h-screen bg-[#0A0808] text-neutral-200 antialiased">{children}</body>
    </html>
  )
}
