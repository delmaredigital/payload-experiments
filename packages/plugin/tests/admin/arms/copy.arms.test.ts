import { expect, test } from 'vitest'
import type { ArmIssueCode } from '../../../src/types/endpoints.js'
import { ARMS_COPY, GROUP_LABELS, ISSUE_COPY, issueMessage } from '../../../src/testSurface/copy/arms.js'

const codes: ArmIssueCode[] = ['weights-total', 'control-count', 'control-first', 'holdout-last', 'holdout-count', 'variant-count', 'duplicate-key', 'duplicate-slot', 'slot-required', 'invalid-key']
const exhaustive: Record<ArmIssueCode, string> = ISSUE_COPY
test('copy covers all ten shared issue codes and uses user vocabulary', () => {
  expect(Object.keys(exhaustive).sort()).toEqual([...codes].sort())
  expect(Object.keys(ISSUE_COPY)).toHaveLength(10)
  for (const value of [...Object.values(ISSUE_COPY), ...Object.values(ARMS_COPY), ...Object.values(GROUP_LABELS)]) expect(value).not.toMatch(/\b(arms?|phases?)\b/i)
})
test('required copy is verbatim and unknown codes fall back to server messages', () => {
  expect(ISSUE_COPY['invalid-key']).toBe('Use the standard group names: Original, Variant A–C, Holdout.')
  expect(issueMessage({ code: 'weights-total', message: 'server' }, 90)).toBe('Weights must add up to 100%. They add up to 90% now.')
  expect(issueMessage({ code: 'future-code', message: 'Server explanation.' }, 100)).toBe('Server explanation.')
  expect(ARMS_COPY.holdout).toBe('The holdout sees the Original and is measured but not compared during the test. After you decide, it keeps seeing the Original so the winner can be compared with it.')
})
