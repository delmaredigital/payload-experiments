import { expect, test } from 'vitest'
import { assignments, experiment, manifest, page } from './helpers.js'
import { toClientAssignments } from '../../src/server/toClientAssignments.js'

test('allow-list defaults to none and no unit ids escape', () => {
  const result = toClientAssignments(assignments(), { pathname: '/' })
  expect(result).toStrictEqual({ v: 1, revision: 3, apiRoute: '/api', experiments: {}, flagPoints: {}, pageviews: [], clickGoalsArmed: true })
  expect(Object.getPrototypeOf(result.experiments)).toBe(Object.prototype)
  expect(Object.getPrototypeOf(result.flagPoints)).toBe(Object.prototype)
  expect(JSON.stringify(result)).not.toContain('visitor'); expect(JSON.stringify(result)).not.toContain('private-user')
})
test('only named entries, params and experimentId are included', () => {
  const a = assignments(manifest([experiment({ flagPoint: 'point', kind: 'flag', exposurePolicy: 'manual' })]))
  const result = toClientAssignments(a, { pathname: '/', apiRoute: '/backend', experiments: ['hero', 'unknown', 'constructor'], flagPoints: ['point', 'toString'] })
  expect(Object.keys(result.experiments)).toEqual(['hero']); expect(Object.keys(result.flagPoints)).toEqual(['point'])
  expect(result.experiments.hero).toMatchObject({ experimentId: 7, params: { text: 'winner' } })
  expect(result.flagPoints.point).toMatchObject({ source: 'experiment', experimentId: 7 })
  expect(result.apiRoute).toBe('/backend')
  expect(Object.getPrototypeOf(result.experiments)).toBe(Object.prototype)
  expect(Object.getPrototypeOf(result.flagPoints)).toBe(Object.prototype)
})
test.each(['staff', 'bot', 'preview'] as const)('%s suppresses all client exposure', flag => {
  const a = assignments(manifest([page({ flagPoint: 'point' })])); a[flag] = true
  const result = toClientAssignments(a, { pathname: '/variant', experiments: ['hero'], flagPoints: ['point'] })
  expect(result.experiments.hero!.exposable).toBe(false); expect(result.flagPoints.point!.exposable).toBe(false)
  expect(result.pageviews).toEqual([])
  expect(result.clickGoalsArmed).toBe(false)
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

test('__proto__ allow-listed keys are own data properties on plain objects', () => {
  const a = assignments()
  a.bySlug = Object.fromEntries([['__proto__', { ...a.bySlug.hero!, slug: '__proto__' }]])
  a.flagPoints = Object.fromEntries([['__proto__', { arm: 'control', params: {}, source: 'default' as const, exposable: false }]])
  const result = toClientAssignments(a, { pathname: '/', experiments: ['__proto__'], flagPoints: ['__proto__'] })
  expect(result.experiments).toStrictEqual(Object.fromEntries([['__proto__', { arm: 'variantA', experimentId: 7, phase: 1, params: {}, policy: 'render', exposable: true }]]))
  expect(result.flagPoints).toStrictEqual(Object.fromEntries([['__proto__', { arm: 'control', params: {}, source: 'default', exposable: false }]]))
  expect(Object.getPrototypeOf(result.experiments)).toBe(Object.prototype)
  expect(Object.getPrototypeOf(result.flagPoints)).toBe(Object.prototype)
  expect(Object.hasOwn(result.experiments, '__proto__')).toBe(true)
  expect(Object.hasOwn(result.flagPoints, '__proto__')).toBe(true)
})

 test('decided rollout holdout and winner enrolments arm click goals even without allow-lists', () => {
  const m = manifest([experiment({ status: 'decided', phaseKind: 'rollout', winnerArm: 'variantA', holdoutKey: 'holdout', arms: [
    { key: 'control', kind: 'control', weight: 45 }, { key: 'variantA', kind: 'variant', weight: 45 }, { key: 'holdout', kind: 'holdout', weight: 10 },
  ] })])
  const a = assignments(m)
  for (const arm of ['holdout', 'variantA']) {
    a.bySlug.hero!.arm = arm; a.bySlug.hero!.exposable = true
    expect(toClientAssignments(a, { pathname: '/' }).clickGoalsArmed).toBe(true)
  }
  a.bySlug.hero!.exposable = false
  expect(toClientAssignments(a, { pathname: '/' }).clickGoalsArmed).toBe(false)
})
