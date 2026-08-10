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
      <body className="min-h-screen bg-white text-slate-900 antialiased dark:bg-slate-950 dark:text-slate-100">
        {children}
      </body>
    </html>
  )
}
