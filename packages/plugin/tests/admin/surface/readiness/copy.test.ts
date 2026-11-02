import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import * as copy from '../../../../src/admin/copy/readiness.js'

test('readiness copy uses editor language, including generated sentences', () => {
  const forbidden = /\b(arms?|phases?|flag point|unit type|CUPED|exposure policy)\b/i
  const source = readFileSync(new URL('../../../../src/admin/copy/readiness.ts', import.meta.url), 'utf8')
  expect(source).not.toMatch(forbidden)
  for (const value of Object.values(copy)) {
    if (typeof value === 'object') for (const sentence of Object.values(value)) expect(sentence).not.toMatch(forbidden)
  }
  for (const sentence of [copy.contentNext('Original'), copy.parameterNext('Headline', 'Variant A'), copy.stoppedCopy(null),
    copy.decidedCopy(null, 'Variant A'), copy.runningCopy(null, 100, 2)]) expect(sentence).not.toMatch(forbidden)
})
