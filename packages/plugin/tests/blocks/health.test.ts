import { expect, test } from 'vitest'
import { canonicalHealth, mergePageHealth } from '../../src/results/health.js'
import { healthDot } from '../../src/admin/surface/home.model.js'
import { dataQuality } from '../../src/admin/results/results.model.js'
import { makeSnapshot } from '../admin/results/fixtures.js'
import { validateSnapshot } from '../../src/results/snapshot.js'

test('page refresh merges goal health and canonical keys detect a different asymmetric goal', () => {
  const goal = { code: 'goal-in-some-versions' as const, metricId: 'a', name: 'Clicked' }
  const page = { code: 'version-page-unchecked' as const, path: '/' }
  const snapshot = makeSnapshot({ health: [goal, page] })
  expect(() => validateSnapshot(snapshot)).not.toThrow()
  expect(healthDot({ id: 1, name: 'Test', status: 'running', kind: 'block', unitType: 'visitor' }, { health: [goal], exposures: 0, days: 0, verdict: null })).toBe('amber')
  expect(dataQuality(snapshot).map(row => row.id)).toEqual(expect.arrayContaining(['goal-in-some-versions:a', 'version-page-unchecked:/']))
  expect(mergePageHealth([goal, { code: 'version-page-unavailable', path: '/old' }], [page])).toEqual([goal, page])
  expect(canonicalHealth({ health: [goal, page] })).toBe(canonicalHealth({ health: [page, goal] }))
  expect(canonicalHealth({ health: [goal] })).not.toBe(canonicalHealth({ health: [{ ...goal, metricId: 'b' }] }))
})
