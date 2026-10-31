import { expect, test } from 'vitest'
import { pageTargetIssue, setPageTarget, showsPageTarget } from '../../../src/admin/arms/pageTarget.model.js'
import { ARMS_COPY } from '../../../src/admin/copy/arms.js'
import type { Arm, ExperimentKind } from '../../../src/types/contracts.js'

test('only page experiments show paths, and never for holdout', () => {
  for (const kind of ['block', 'flag', 'code', 'page'] satisfies ExperimentKind[]) {
    expect(showsPageTarget(kind, 'control')).toBe(kind === 'page')
    expect(showsPageTarget(kind, 'variant')).toBe(kind === 'page')
    expect(showsPageTarget(kind, 'holdout')).toBe(false)
  }
})
test.each(['control', 'variant'] as const)('%s requires a page path', group => {
  for (const value of [undefined, null, '', ' ']) expect(pageTargetIssue(value, group)).toBe(ARMS_COPY.pageRequired)
  for (const value of ['https://example.com/page', '//example.com', 'page', '/page?x=1', '/page#fragment', '/\\example.com', '/ a']) expect(pageTargetIssue(value, group)).toBe(ARMS_COPY.pageInvalid)
  for (const value of ['/', '/page', '/nested/page']) expect(pageTargetIssue(value, group)).toBeNull()
})
test('holdout stores no path and needs none', () => {
  const holdout: Arm = { key: 'holdout', kind: 'holdout', label: 'Holdout', weight: 10, pageTarget: '/stale' }
  expect(pageTargetIssue(undefined, 'holdout')).toBeNull()
  expect(setPageTarget(holdout, '/ignored')).not.toHaveProperty('pageTarget')
  const original: Arm = { key: 'control', kind: 'control', label: 'Original', weight: 50 }
  expect(setPageTarget(original, '/page').pageTarget).toBe('/page')
  expect(original).not.toHaveProperty('pageTarget')
})
