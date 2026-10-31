import { expect, test } from 'vitest'
import { phaseHistory } from '../../../src/admin/phaseHistory.model.js'

const phase = { phase: 2, phaseKind: 'test' as const, startedAt: '2026-10-03T00:00:00Z', endedAt: '2026-10-17T23:00:00Z', arms: [{ weight: 45 }, { weight: 45 }, { weight: 10 }] }
test('round text is sorted by round, includes kind, dates and weights in stored order', () => {
  const phases = [phase, { ...phase, phase: 1 }]
  expect(phaseHistory(phases).rows).toEqual([
    { phase: 1, phaseKind: 'test', text: 'Round 1 · during the test · Oct 3 – Oct 17 · 45/45/10' },
    { phase: 2, phaseKind: 'test', text: 'Round 2 · during the test · Oct 3 – Oct 17 · 45/45/10' },
  ])
  expect(phases[0]?.phase).toBe(2)
})
test('test and rollout rounds sharing a number are sorted by start time', () => {
  const rollout = { ...phase, phaseKind: 'rollout' as const, startedAt: '2026-10-17T23:00:00Z', endedAt: null }
  expect(phaseHistory([rollout, { ...phase, phase: 3 }, phase]).rows.map(row => [row.phase, row.phaseKind]))
    .toEqual([[2, 'test'], [2, 'rollout'], [3, 'test']])
})
test('an open rollout ends now', () => {
  expect(phaseHistory([{ ...phase, phaseKind: 'rollout', endedAt: null }]).rows[0]?.text)
    .toBe('Round 2 · after shipping · Oct 3 – now · 45/45/10')
})
test('decision wording never presents the opaque user id as a name', () => {
  const result = phaseHistory([phase], { decidedBy: 'opaque-user-123' })
  expect(result.decision).toBe('Decided by an editor')
  expect(JSON.stringify(result)).not.toContain('opaque-user-123')
  expect(phaseHistory([phase]).decision).toBeNull()
})
