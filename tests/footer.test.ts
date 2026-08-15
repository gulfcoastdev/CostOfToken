import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

/**
 * Where the footer is rendered from.
 *
 * This is a source-level check, which is normally a poor proxy for a rendered
 * property — but the fault it guards is real and has happened twice. The
 * footer used to be rendered by each page individually: the home page ended up
 * with a smaller footer of its own instead, and the error state had none at
 * all, so a reader who hit a failed page had no way onward. Adding the shared
 * footer to the home page then produced a page with *two*.
 *
 * Rendering it once from the layout makes "exactly one footer, on every page"
 * structural. Nothing at runtime can assert that a page did not render a
 * second one — by the time you can count them, the regression has shipped —
 * so the invariant is held here instead: the layout renders it, and no page
 * does.
 */

const APP_DIR = fileURLToPath(new URL('../src/app', import.meta.url))

function pageFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return pageFiles(path)
    return entry === 'page.tsx' ? [path] : []
  })
}

test('the root layout renders the site footer', () => {
  const layout = readFileSync(join(APP_DIR, 'layout.tsx'), 'utf8')

  assert.match(layout, /<SiteFooter\s*\/>/, 'layout.tsx must render <SiteFooter />')
  assert.match(layout, /SiteFooter/, 'layout.tsx must import SiteFooter')
})

test('no page renders its own footer', () => {
  const offenders = pageFiles(APP_DIR)
    .filter((path) => /<SiteFooter\s*\/>/.test(readFileSync(path, 'utf8')))
    .map((path) => path.replace(`${APP_DIR}/`, ''))

  assert.deepEqual(
    offenders,
    [],
    `these pages render a second footer on top of the layout's: ${offenders.join(', ')}`,
  )
})

test('every page is covered, including ones that render no shell', () => {
  // The point of the layout move: coverage no longer depends on a page
  // remembering anything. If this ever needs a per-page allowlist, the footer
  // has moved back out of the layout and the guarantee is gone.
  const pages = pageFiles(APP_DIR)

  assert.ok(pages.length > 5, `expected the app to have pages, found ${pages.length}`)
})
