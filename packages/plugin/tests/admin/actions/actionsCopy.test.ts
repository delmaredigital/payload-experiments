import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { ACTIONS_COPY, contentReportCopy, decideCopy, hardCodedLabel, makeContentCopy, releaseCopy } from '../../../src/testSurface/copy/actions.js'
import { expectedConfirm } from '../../../src/transitions/confirmPhrases.js'

test('forbidden content reports explain how to archive a deleted or trashed page', () => {
  expect(contentReportCopy('forbidden')).toBe("You can't read or update this page. Ask someone with access to update it by hand. If it was deleted or moved to trash, discard the winner to archive this test.")
})

test('copy uses editor vocabulary and never stores a typed phrase', () => {
  const phrases = (['decide', 'discard', 'hard-coded'] as const).map(action => expectedConfirm(action, 'Variant A'))
  const values = [...Object.values(ACTIONS_COPY).flatMap(value => typeof value === 'string' ? [value] : Object.values(value)), decideCopy('Variant A', true, false), releaseCopy('Variant A'), makeContentCopy('Variant A', 'block'), makeContentCopy('Variant A', 'flag'), hardCodedLabel('Variant A')]
  for (const value of values) {
    expect(value).not.toMatch(/\b(arms?|phases?)\b/i)
    expect(phrases).not.toContain(value)
  }
  const source = readFileSync(new URL('../../../src/testSurface/copy/actions.ts', import.meta.url), 'utf8')
  expect(source).not.toContain("'discard winner'")
  expect(source).not.toContain('`the developer has hard-coded')
})
