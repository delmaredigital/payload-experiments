import { expect, test } from 'vitest'
import { assignments, experiment, manifest, page } from './helpers.js'
import { toClientAssignments } from '../../src/server/toClientAssignments.js'

test('allow-list defaults to none and no unit ids escape', () => {
  const result = toClientAssignments(assignments(), { pathname: '/' })
  expect(result).toEqual({ v: 1, revision: 3, apiRoute: '/api', experiments: {}, flagPoints: {}, pageviews: [] })
  expect(JSON.stringify(result)).not.toContain('visitor'); expect(JSON.stringify(result)).not.toContain('private-user')
})
test('only named entries, params and experimentId are included', () => {
  const a = assignments(manifest([experiment({ flagPoint: 'point', kind: 'flag', exposurePolicy: 'manual' })]))
  const result = toClientAssignments(a, { pathname: '/', apiRoute: '/backend', experiments: ['hero', 'unknown', 'constructor'], flagPoints: ['point', 'toString'] })
  expect(Object.keys(result.experiments)).toEqual(['hero']); expect(Object.keys(result.flagPoints)).toEqual(['point'])
  expect(result.experiments.hero).toMatchObject({ experimentId: 7, params: { text: 'winner' } })
  expect(result.flagPoints.point).toMatchObject({ source: 'experiment', experimentId: 7 })
  expect(result.apiRoute).toBe('/backend')
})
test.each(['staff', 'bot', 'preview'] as const)('%s suppresses all client exposure', flag => {
  const a = assignments(manifest([page({ flagPoint: 'point' })])); a[flag] = true
  const result = toClientAssignments(a, { pathname: '/variant', experiments: ['hero'], flagPoints: ['point'] })
  expect(result.experiments.hero!.exposable).toBe(false); expect(result.flagPoints.point!.exposable).toBe(false)
  expect(result.pageviews).toEqual([])
})
test('pageviews match served page; holdout serves control; unenrolled is excluded', () => {
  const m = manifest([page()]), a = assignments(m)
  expect(toClientAssignments(a, { pathname: '/variant' }).pageviews).toEqual([{ slug: 'hero', phase: 1, arm: 'variantA' }])
  expect(toClientAssignments(a, { pathname: '/original' }).pageviews).toEqual([])
  a.bySlug.hero!.arm = 'holdout'
  expect(toClientAssignments(a, { pathname: '/original' }).pageviews).toEqual([{ slug: 'hero', phase: 1, arm: 'holdout' }])
  a.bySlug.hero!.exposable = false
  expect(toClientAssignments(a, { pathname: '/original' }).pageviews).toEqual([])
})
