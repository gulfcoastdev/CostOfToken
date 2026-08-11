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
        Light page, white cards. The page sits a shade off pure white so the
        cards read as raised surfaces against it rather than dissolving into
        the background. Body text colour is set explicitly rather than left to
        inherit, so anything added outside a card is legible by default.
      */}
      <body className="min-h-screen bg-[#F7F6F4] text-neutral-900 antialiased">{children}</body>
    </html>
  )
}
