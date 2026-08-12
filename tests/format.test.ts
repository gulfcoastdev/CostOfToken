import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  blendedPrice,
  formatCompact,
  formatContext,
  formatCost,
  formatPrice,
  formatRelativeTime,
} from '../src/lib/format.ts'

test('formatPrice distinguishes free from unpublished', () => {
  // The distinction the whole dataset rests on: 0 is a real price, null is
  // "this provider publishes no such tier".
  assert.equal(formatPrice(0), 'Free')
  assert.equal(formatPrice(null), '—')
  assert.equal(formatPrice(undefined), '—')
})

test('formatPrice keeps sub-dollar precision', () => {
  // Sub-cent prices are common and rounding to 2dp would show several models
  // as identical.
  assert.equal(formatPrice(0.075), '$0.075')
  assert.equal(formatPrice(0.02), '$0.020')
  assert.equal(formatPrice(1), '$1.00')
  assert.equal(formatPrice(12.5), '$12.50')
  assert.equal(formatPrice(150), '$150.00')
})

test('formatContext renders the same window one way', () => {
  // Regression: 1,000,000 read as "1M" while 1,048,576 read as "1.0M",
  // which looked like two different context sizes in one column.
  assert.equal(formatContext(1_000_000), '1M')
  assert.equal(formatContext(1_048_576), '1M')
  assert.equal(formatContext(1_050_000), '1.1M')
  assert.equal(formatContext(200_000), '200K')
  assert.equal(formatContext(8_192), '8K')
  assert.equal(formatContext(null), '—')
  assert.equal(formatContext(0), '—')
})

test('blendedPrice needs both sides to mean anything', () => {
  assert.equal(blendedPrice(1, 3), 2)
  assert.equal(blendedPrice(null, 3), null)
  assert.equal(blendedPrice(1, null), null)
  assert.equal(blendedPrice(0, 0), 0)
})

test('formatCompact and formatCost scale sensibly', () => {
  assert.equal(formatCompact(1_500), '2K')
  assert.equal(formatCompact(1_500_000), '1.5M')
  assert.equal(formatCompact(6_400_000_000), '6.4B')

  assert.equal(formatCost(0), '$0.00')
  assert.equal(formatCost(1.5), '$1.50')
  assert.equal(formatCost(5_570), '$6K')
})

test('formatRelativeTime handles hours, days and nothing', () => {
  const now = Date.now()
  assert.equal(formatRelativeTime(null), 'never')
  assert.equal(formatRelativeTime(new Date(now - 60 * 60 * 1000).toISOString()), '1 hour ago')
  assert.equal(formatRelativeTime(new Date(now - 5 * 60 * 60 * 1000).toISOString()), '5 hours ago')
  assert.equal(formatRelativeTime(new Date(now - 26 * 60 * 60 * 1000).toISOString()), '1 day ago')
  assert.equal(formatRelativeTime(new Date(now - 72 * 60 * 60 * 1000).toISOString()), '3 days ago')
})
