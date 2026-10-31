import { test } from 'vitest'
import { manifest } from '../../../stats/tests/parity/manifest.js'
import { pending } from '../../../stats/tests/parity/pending.js'

export function isStatsPending(symbol: string): boolean {
  const entries = manifest.filter(entry => entry.key === symbol)
  if (!entries.length) throw new Error(`skipUntilStats: unknown stats symbol ${symbol}`)
  return entries.some(entry => pending.has(entry.fixture))
}

export function skipUntilStats(symbol: string) {
  return test.skipIf(isStatsPending(symbol))
}
