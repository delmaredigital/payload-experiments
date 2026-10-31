import { test } from 'vitest'
import { pending } from '../../../stats/tests/parity/pending.js'

export function skipUntilStats(symbol: string) {
  return test.skipIf(pending.has(symbol))
}
