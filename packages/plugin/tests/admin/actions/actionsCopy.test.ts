import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { ACTIONS_COPY, decideCopy, hardCodedLabel, makeContentCopy, releaseCopy } from '../../../src/admin/copy/actions.js'
import { expectedConfirm } from '../../../src/transitions/confirmPhrases.js'

test('copy uses editor vocabulary and never stores a typed phrase', () => {
  const phrases = (['decide', 'discard', 'hard-coded'] as const).map(action => expectedConfirm(action, 'Variant A'))
  const values = [...Object.values(ACTIONS_COPY), decideCopy('Variant A', true, false), releaseCopy('Variant A'), makeContentCopy('Variant A'), hardCodedLabel('Variant A')]
  for (const value of values) {
    expect(value).not.toMatch(/\b(arms?|phases?)\b/i)
    expect(phrases).not.toContain(value)
  }
  const source = readFileSync(new URL('../../../src/admin/copy/actions.ts', import.meta.url), 'utf8')
  expect(source).not.toContain("'discard winner'")
  expect(source).not.toContain('`the developer has hard-coded')
})
