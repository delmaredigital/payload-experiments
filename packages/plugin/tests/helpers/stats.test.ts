import { expect, test, vi } from 'vitest'
import { manifest } from '../../../stats/tests/parity/manifest.js'
import { isStatsPending, skipUntilStats } from '../_helpers/stats.js'

// Keep helper tests stable as real stats implementations merge and the pending list shrinks.
vi.mock('../../../stats/tests/parity/pending.js', () => ({ pending: new Set(['statistics.createThetaAdjustedStatistics']) }))

test('known stats symbols resolve to their pending fixture ids', () => {
  expect(isStatsPending('createThetaAdjustedStatistics')).toBe(true)
  expect(isStatsPending('hash')).toBe(false)
})

skipUntilStats('createThetaAdjustedStatistics')('known-pending stats tests are skipped', () => {
  throw new Error('This callback must never run')
})
skipUntilStats('hash')('implemented stats tests run', () => {
  expect(isStatsPending('hash')).toBe(false)
})

test('an unknown symbol fails loudly rather than silently running', () => {
  expect(() => skipUntilStats('nope')).toThrow('unknown stats symbol nope')
})

test('any pending fixture for a symbol keeps it skipped', () => {
  const entry = { key: 'hash', fixture: 'statistics.createThetaAdjustedStatistics', symbol: 'extra helper-test fixture' }
  manifest.push(entry)
  try { expect(isStatsPending('hash')).toBe(true) }
  finally { manifest.splice(manifest.indexOf(entry), 1) }
})
