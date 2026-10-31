import { expect, test, vi } from 'vitest'
import { assignArm, hash, inRange, layerSlice, rolloutBucketRanges } from '@delmaredigital/experiments-stats'
import { assign } from '../../src/runtime/assign.js'
import type { Manifest, ManifestExperiment } from '../../src/types/manifest.js'
import { encodeAssignmentsHeader } from '../../src/runtime/header.js'

const now = 1_800_000_000
const experiment = (patch: Partial<ManifestExperiment> = {}): ManifestExperiment => ({
  id: 'e1', slug: 'test', kind: 'flag', flagPoint: 'hero', unitType: 'visitor', status: 'running',
  phase: 1, phaseKind: 'test', seed: '0123456789abcdef0123456789abcdef|', coverage: 0.5,
  arms: [
    { key: 'control', kind: 'control', weight: 5, params: { label: 'original' } },
    { key: 'variantA', kind: 'variant', weight: 93, params: { label: 'winner' } },
    { key: 'holdout', kind: 'holdout', weight: 2 },
  ], targeting: [], exposurePolicy: 'manual', deferrable: false, ...patch,
})
const manifest = (e = experiment()): Manifest => ({ v: 1, revision: 3, experiments: [e], flagDefaults: {}, archivedWinners: { archived: 'variantB' }, archivedPages: {} })
const run = (e: ManifestExperiment, visitorId: string) => assign(manifest(e), { visitorId }, {}, { now })

test('10,000 assignments equal the stats engine; non-enrolled units get non-exposable control', () => {
  const e = experiment()
  let enrolled = 0, outside = 0
  for (let i = 0; i < 10_000; i++) {
    const id = `visitor-${i}`
    const index = assignArm({ seed: e.seed, unitId: id, weights: e.arms.map(a => a.weight), coverage: e.coverage })
    const result = run(e, id)
    expect(result.bySlug.test).toMatchObject({ arm: index === -1 ? 'control' : e.arms[index]!.key, exposable: index !== -1 })
    if (index === -1) outside++; else enrolled++
  }
  expect(enrolled).toBeGreaterThan(0)
  expect(outside).toBeGreaterThan(0)
})
test('raising coverage never changes an already enrolled arm', () => {
  const e = experiment({ coverage: 0.3 })
  let compared = 0
  for (let i = 0; i < 10_000; i++) {
    const before = run(e, String(i)).bySlug.test!
    if (!before.exposable) continue
    const after = run({ ...e, coverage: 0.8 }, String(i)).bySlug.test!
    expect(after.arm).toBe(before.arm)
    expect(after.exposable).toBe(true)
    compared++
  }
  expect(compared).toBeGreaterThan(0)
})
test('layer slices are the allocation and assignment inside them uses coverage 1', () => {
  const e = experiment({ layer: { slug: 'layer', slices: [0, 1, 2, 3, 4] } })
  let inside = 0, outside = 0
  for (let i = 0; i < 1000; i++) {
    const id = String(i), result = run(e, id).bySlug.test!
    if (e.layer!.slices.includes(layerSlice('layer', id))) {
      const index = assignArm({ seed: e.seed, unitId: id, weights: e.arms.map(a => a.weight), coverage: 1 })
      expect(result).toMatchObject({ arm: e.arms[index]!.key, exposable: true })
      inside++
    } else { expect(result).toMatchObject({ arm: 'control', exposable: false }); outside++ }
  }
  expect(inside).toBeGreaterThan(0)
  expect(outside).toBeGreaterThan(0)
})
test.each([false, true])('rollout preserves holdout membership exactly and serves winner elsewhere (layered=%s)', layered => {
  const e = experiment(layered ? { layer: { slug: 'layer', slices: Array.from({ length: 50 }, (_, i) => i) } } : {})
  const rollout = { ...e, status: 'decided' as const, phase: 2, phaseKind: 'rollout' as const, winnerArm: 'variantA', holdoutKey: 'holdout' }
  const ranges = rolloutBucketRanges(e.arms.map(a => a.weight), layered ? 1 : e.coverage)
  let holdouts = 0, winnerExposed = 0, winnerUnexposed = 0, outsideSlices = 0
  for (let i = 0; i < 10_000; i++) {
    const id = String(i), before = run(e, id).bySlug.test!, after = run(rollout, id).bySlug.test!
    const inLayer = !e.layer || e.layer.slices.includes(layerSlice(e.layer.slug, id))
    const bucket = hash(e.seed, id, 2)!
    expect(after.arm === 'holdout').toBe(before.arm === 'holdout')
    expect(after.arm).toBe(inLayer && inRange(bucket, ranges.holdout) ? 'holdout' : 'variantA')
    expect(after.exposable).toBe(inLayer && (inRange(bucket, ranges.holdout) || inRange(bucket, ranges.winner)))
    if (after.arm === 'holdout') holdouts++
    else if (after.exposable) winnerExposed++
    else winnerUnexposed++
    if (!inLayer) { expect(after).toMatchObject({ arm: 'variantA', exposable: false }); outsideSlices++ }
  }
  expect(holdouts).toBeGreaterThan(0)
  expect(winnerExposed).toBeGreaterThan(0)
  expect(winnerUnexposed).toBeGreaterThan(0)
  if (layered) expect(outsideSlices).toBeGreaterThan(0)
})
test('decided without rollout serves winner non-exposably in and outside former slices; targeting still applies', () => {
  const e = experiment({ status: 'decided', winnerArm: 'variantA', layer: { slug: 'layer', slices: [1] }, targeting: [{ attribute: 'loggedIn', op: 'eq', value: true }] })
  for (let i = 0; i < 500; i++) {
    expect(assign(manifest(e), { visitorId: String(i) }, { loggedIn: true }, { now }).bySlug.test).toMatchObject({ arm: 'variantA', exposable: false })
  }
  expect(assign(manifest(e), { visitorId: 'visitor' }, { loggedIn: false }, { now }).bySlug.test).toMatchObject({ arm: 'control', exposable: false })
})
test('user units without an id and session-dependent unknown targeting are deferred', () => {
  const user = experiment({ unitType: 'user' })
  expect(assign(manifest(user), { visitorId: 'v' }, {}, { now })).toMatchObject({ bySlug: {}, deferred: ['test'] })
  expect(assign(manifest(user), { userId: 'u' }, {}, { now }).deferred).toEqual([])
  for (const attribute of ['staff', 'loggedIn']) {
    const e = experiment({ targeting: [{ attribute, op: 'eq', value: false }] })
    expect(assign(manifest(e), { visitorId: 'v', sessionUnknown: true }, { [attribute]: false }, { now })).toMatchObject({ bySlug: {}, deferred: ['test'], sessionUnknown: true })
  }
  expect(assign(manifest(), { visitorId: 'v', sessionUnknown: true }, {}, { now }).deferred).toEqual([])
})
test.each(['running', 'decided'] as const)('visitor without a cookie gets non-exposable control, never deferred (%s)', status => {
  const e = experiment({ status, ...(status === 'decided' ? { phaseKind: 'rollout', winnerArm: 'variantA', holdoutKey: 'holdout' } : {}) })
  const result = assign(manifest(e), { userId: 'user', sessionUnknown: true }, {}, { now })
  expect(result.deferred).toEqual([])
  expect(result.bySlug.test).toMatchObject({ arm: 'control', exposable: false, source: 'fallback' })
  expect(result.flagPoints.hero).toMatchObject({ params: { label: 'original' }, exposable: false })
  expect(encodeAssignmentsHeader(result, { secrets: ['key'] })).toContain('.test=control!.')
})
test('rollout targeting failure serves control rather than winner, and missing user id is deferred', () => {
  const e = experiment({ status: 'decided', phaseKind: 'rollout', winnerArm: 'variantA', holdoutKey: 'holdout', targeting: [{ attribute: 'loggedIn', op: 'eq', value: true }] })
  expect(assign(manifest(e), { visitorId: 'v' }, { loggedIn: false }, { now }).bySlug.test).toMatchObject({ arm: 'control', exposable: false })
  const result = assign(manifest({ ...e, unitType: 'user' }), { visitorId: 'v' }, { loggedIn: true }, { now })
  expect(result).toMatchObject({ bySlug: {}, deferred: ['test'] })
})
test('rollout rejects a seed without the same separator required by assignArm', () => {
  const e = experiment({ status: 'decided', phaseKind: 'rollout', winnerArm: 'variantA', holdoutKey: 'holdout', seed: 'missing-separator' })
  let expected: unknown
  try { assignArm({ seed: e.seed, unitId: 'v', weights: [50, 50], coverage: 1 }) } catch (error) { expected = error }
  expect(expected).toBeInstanceOf(RangeError)
  expect(() => run(e, 'v')).toThrow(expected as RangeError)
})
test.each([
  { phaseKind: 'test', winnerArm: undefined, holdoutKey: undefined, reason: 'invalid-winner-arm' },
  { phaseKind: 'test', winnerArm: 'absent', holdoutKey: undefined, reason: 'invalid-winner-arm' },
  { phaseKind: 'rollout', winnerArm: undefined, holdoutKey: 'holdout', reason: 'invalid-winner-arm' },
  { phaseKind: 'rollout', winnerArm: 'absent', holdoutKey: 'holdout', reason: 'invalid-winner-arm' },
  { phaseKind: 'rollout', winnerArm: 'variantA', holdoutKey: 'absent', reason: 'invalid-holdout-key' },
  { phaseKind: 'rollout', winnerArm: 'variantA', holdoutKey: undefined, reason: 'invalid-holdout-key' },
] as const)('invalid decided/rollout arms are skipped and reported: %j', ({ reason, ...patch }) => {
  const invalid = experiment({ status: 'decided', ...patch }), onInvalid = vi.fn()
  const m = manifest(invalid)
  m.experiments.push(experiment({ id: 'valid', slug: 'valid', flagPoint: 'valid' }))
  const result = assign(m, { visitorId: 'v' }, {}, { now, onInvalid })
  expect(Object.keys(result.bySlug)).toEqual(['valid'])
  expect(result.flagPoints.hero).toBeUndefined()
  expect(onInvalid).toHaveBeenCalledExactlyOnceWith('test', reason)
  expect(() => encodeAssignmentsHeader(result, { secrets: ['key'] })).not.toThrow()
  expect(assign(manifest(invalid), { visitorId: 'v' }, {}, { now }).bySlug.test).toBeUndefined()
})
test.each(['staff', 'bot', 'preview', 'HEAD'])('%s suppresses every assignment and flag exposure', flag => {
  const e = experiment({ coverage: 1 }), m = manifest(e)
  m.experiments.push(experiment({ id: 'e2', slug: 'other', flagPoint: 'other', coverage: 1 }))
  const result = assign(m, { visitorId: 'v' }, flag === 'staff' ? { staff: true } : {}, { now, ...flag === 'HEAD' ? { method: 'HEAD' } : { [flag]: true } })
  expect(Object.values(result.bySlug).every(a => !a.exposable)).toBe(true)
  expect(Object.values(result.flagPoints).every(a => !a.exposable)).toBe(true)
})
test('flag results use control params for holdouts, preserve defaults and copy archived winners without mutating inputs', () => {
  const e = experiment({ arms: [{ key: 'control', kind: 'control', weight: 0, params: { label: 'original' } }, { key: 'holdout', kind: 'holdout', weight: 100 }], coverage: 1 })
  const m = manifest(e)
  m.flagDefaults.fallback = { winnerArm: 'variantB', params: { label: 'default' }, experiment: 'archived', decidedAt: '' }
  const original = JSON.stringify(m)
  const result = assign(m, { visitorId: 'v' }, {}, { now })
  expect(result.flagPoints.hero).toMatchObject({ arm: 'holdout', params: { label: 'original' }, experimentId: 'e1', exposable: true })
  expect(result.flagPoints.fallback).toMatchObject({ arm: 'variantB', source: 'default', exposable: false })
  expect(result.archivedWinners).toEqual(m.archivedWinners)
  expect(result.archivedWinners).not.toBe(m.archivedWinners)
  expect(JSON.stringify(m)).toBe(original)
  expect(assign(m, { visitorId: 'v' }, {}, { now })).toEqual(result)
})
test('experiment slugs and flag points that match prototype keys remain own dictionary entries', () => {
  const e = experiment({ slug: '__proto__', flagPoint: '__proto__', coverage: 1 })
  const result = run(e, 'v')
  expect(Object.keys(result.bySlug)).toEqual(['__proto__'])
  expect(Object.keys(result.flagPoints)).toEqual(['__proto__'])
  expect(result.bySlug.__proto__).toMatchObject({ slug: '__proto__', experimentId: 'e1', exposable: true })
  expect(result.flagPoints.__proto__).toMatchObject({ experiment: '__proto__', exposable: true })
})
