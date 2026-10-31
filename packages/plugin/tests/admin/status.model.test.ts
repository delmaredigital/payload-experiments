import { expect, test } from 'vitest'
import { statusPill } from '../../src/admin/status.model.js'
import { STATUS_TOOLTIPS } from '../../src/admin/copy/status.js'
import type { Status } from '../../src/types/contracts.js'

const cases = {
  draft: ['Draft', 'neutral'], running: ['Running', 'success'], stopped: ['Stopped', 'warning'],
  decided: ['Decided', 'info'], archived: ['Archived', 'muted'],
} as const satisfies Record<Status, readonly [string, string]>
for (const status of Object.keys(cases) as Status[]) test(status, () => {
  expect(statusPill({ status })).toEqual({ label: cases[status][0], tone: cases[status][1], tooltip: STATUS_TOOLTIPS[status] })
})
test.each([
  ['variantA', [{ key: 'control' }, { key: 'holdout' }], STATUS_TOOLTIPS.decidedWithHoldout],
  ['control', [{ key: 'control' }, { key: 'holdout' }], STATUS_TOOLTIPS.decided],
  ['variantA', [{ key: 'control' }], STATUS_TOOLTIPS.decided],
  [undefined, [{ key: 'holdout' }], STATUS_TOOLTIPS.decided],
] as const)('decided winner %s', (winnerArm, arms, tooltip) => {
  expect(statusPill({ status: 'decided', arms, decision: { winnerArm } }).tooltip).toBe(tooltip)
})
test('a running holdout is still running', () => {
  expect(statusPill({ status: 'running', arms: [{ key: 'holdout' }], decision: { winnerArm: 'variantA' } }).tooltip).toBe('Running')
})

test.each([undefined, null, '2026-10-30T21:22:00Z'])('holdout release timestamp %s', holdoutReleasedAt => {
  expect(statusPill({ status: 'decided', arms: [{ key: 'holdout' }], decision: { winnerArm: 'variantA', holdoutReleasedAt } }).tooltip)
    .toBe(holdoutReleasedAt ? STATUS_TOOLTIPS.decided : STATUS_TOOLTIPS.decidedWithHoldout)
})
