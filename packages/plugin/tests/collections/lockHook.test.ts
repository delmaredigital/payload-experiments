import { expect, test, vi } from 'vitest'
import type { CollectionBeforeChangeHook, PayloadRequest } from 'payload'
import type { Status } from '../../src/types/contracts.js'
import { lockHook } from '../../src/collections/experiments/lockHook.js'
import { EDITABLE_BY_STATUS, isEditable } from '../../src/collections/experiments/editability.js'
import { XpLockedFieldError } from '../../src/errors.js'
import { xpOptionsFromReq } from '../../src/options/fromReq.js'
import { fakeReq } from '../_fakes/req.js'
import { fakePayload } from '../_fakes/payload.js'

const statuses: Status[] = ['draft', 'stopped', 'running', 'decided', 'archived']
const expected: Record<Status, string[]> = {
  draft: ['name', 'hypothesis', 'arms', 'targeting', 'allocation', 'flagPoint', 'metrics', 'analysis', 'exposurePolicy'],
  stopped: ['name', 'hypothesis', 'arms', 'targeting', 'allocation', 'metrics', 'analysis', 'exposurePolicy'],
  running: ['name', 'hypothesis'], decided: ['name', 'hypothesis'], archived: [],
}
const request = (admin?: unknown, context = {}) => fakeReq({ context, payload: fakePayload({ config: { custom: { xp: {
  access: { manage: vi.fn(() => true), ...(admin === undefined ? {} : { admin: vi.fn(() => admin) }) },
} } } }) })
const fixture = (status: Status = 'draft') => ({
  id: 1, name: 'Original name', hypothesis: 'Original hypothesis', slug: 'course-card', kind: 'flag', unitType: 'visitor', status,
  allocation: 100, flagPoint: 'course-card', layer: 7, layerSlices: [1, 2], phase: 1, seed: 'seed',
  arms: [{ id: 'old-control', key: 'control', kind: 'control', label: 'Original', weight: 50, params: { id: 'business-id', nested: { b: 2, a: 1 } } },
    { id: 'old-variant', key: 'variantA', kind: 'variant', label: 'Variant A', weight: 50, params: { text: 'Variant' } }],
  targeting: [{ id: 'old-rule', attribute: 'locale', op: 'eq', value: 'en' }],
  metrics: { primary: 8, secondary: [9], guardrails: [10] },
  analysis: { method: 'sequential', cuped: 'auto', minExposuresPerArm: 200, plannedDurationDays: 14,
    attributionWindowHours: 24, sequentialTuningParameter: 100, reachPerDay: 1000 },
  exposurePolicy: 'manual', startedAt: '2026-10-30T14:00:00.000Z', stoppedAt: undefined, decidedAt: undefined, archivedAt: undefined,
  decision: { winnerArm: 'variantA', verdictCode: 'winner', note: 'Ship', decidedBy: 12, snapshotId: 13, discardedAt: undefined },
  createdAt: '2026-10-29T14:00:00.000Z', updatedAt: '2026-10-30T14:00:00.000Z',
})
function run(data: Record<string, unknown>, originalDoc = fixture(), req = request(true), operation: 'create' | 'update' = 'update') {
  return lockHook({ data, originalDoc, req, operation } as Parameters<CollectionBeforeChangeHook>[0])
}
const changes: Record<string, unknown> = {
  id: 2, name: 'New name', hypothesis: 'New hypothesis', slug: 'another-slug', kind: 'page', unitType: 'user', status: 'running',
  allocation: 90, flagPoint: 'another-point', layer: 11, layerSlices: [3], phase: 2, seed: 'another-seed',
  arms: fixture().arms.map(arm => ({ ...arm, label: `${arm.label} edited` })),
  targeting: [{ attribute: 'locale', op: 'eq', value: 'fr' }],
  metrics: { primary: 20 }, analysis: { plannedDurationDays: 21 }, exposurePolicy: 'viewport',
  startedAt: '2026-10-31T14:00:00Z', stoppedAt: '2026-10-31T14:00:00Z', decidedAt: '2026-10-31T14:00:00Z', archivedAt: '2026-10-31T14:00:00Z',
  decision: { note: 'Changed' }, createdAt: '2026-10-31T14:00:00Z', updatedAt: '2026-10-31T14:00:00Z', surpriseField: true,
}
test('editability table exactly matches the per-status contract', () => {
  expect(EDITABLE_BY_STATUS).toEqual(expected)
  for (const status of statuses) for (const field of expected.draft) {
    expect(isEditable(status, field as Parameters<typeof isEditable>[1])).toBe(expected[status].includes(field))
  }
})
test.each(statuses.flatMap(status => Object.entries(changes).map(([field, value]) => ({ status, field, value }))))('$status × $field', async ({ status, field, value }) => {
  if (field === 'status' && value === status) value = 'stopped'
  const result = run({ [field]: value }, fixture(status))
  if (expected[status].includes(field) || ['createdAt', 'updatedAt'].includes(field)) await expect(result).resolves.toEqual({ [field]: value })
  else await expect(result).rejects.toBeInstanceOf(XpLockedFieldError)
})
const nestedChanges = {
  'analysis.method': 'bayesian', 'analysis.cuped': 'off', 'analysis.minExposuresPerArm': 300, 'analysis.plannedDurationDays': 21,
  'analysis.attributionWindowHours': 48, 'analysis.sequentialTuningParameter': 200, 'analysis.reachPerDay': 500,
  'metrics.primary': 20, 'metrics.secondary': [21], 'metrics.guardrails': [22],
  'decision.winnerArm': 'control', 'decision.verdictCode': 'mixed', 'decision.note': 'Changed', 'decision.decidedBy': 20,
  'decision.snapshotId': 21, 'decision.discardedAt': '2026-10-31T14:00:00Z',
  'decision.contentReport': { docs: [{ collection: 'pages', id: 1, ok: true }] },
}
test.each(statuses.flatMap(status => Object.entries(nestedChanges).map(([field, value]) => ({ status, field, value }))))('$status × $field subfield', async ({ status, field, value }) => {
  const [group, key] = field.split('.') as [string, string]
  const result = run({ [group]: { [key]: value } }, fixture(status))
  if (expected[status].includes(group)) await expect(result).resolves.toEqual({ [group]: { [key]: value } })
  else await expect(result).rejects.toMatchObject({ field, experimentStatus: status, status: 400 })
})
test('draft PATCH of status is refused', async () => {
  await expect(run({ status: 'running' })).rejects.toMatchObject({ field: 'status', experimentStatus: 'draft', status: 400 })
})
test.each(Object.entries(changes).filter(([field]) => ![...expected.running, 'createdAt', 'updatedAt'].includes(field)))('Restore refuses locked change to %s', async (field, value) => {
  if (field === 'status') value = 'stopped'
  await expect(run({ [field]: value }, fixture('running'), request(true, { isRestoringVersion: true }))).rejects.toBeInstanceOf(XpLockedFieldError)
})
test.each(['draft', 'stopped'] as const)('Restore of a complete older %s version accepts editable differences', async status => {
  const original = fixture(status)
  const older = {
    ...structuredClone(original), name: 'Older name', hypothesis: 'Older hypothesis', updatedAt: '2026-10-29T15:00:00Z',
    arms: original.arms.map((arm, index) => ({ ...arm, label: `Older ${arm.label}`, weight: index === 0 ? 40 : 60 })),
    allocation: 90, metrics: { primary: 20, secondary: [], guardrails: [] },
    analysis: { ...original.analysis, plannedDurationDays: 21 },
  }
  await expect(run(older, original, request(false, { isRestoringVersion: true }))).resolves.toBe(older)
})
test('Restore of a complete older running version accepts only editorial differences', async () => {
  const original = fixture('running')
  const older = { ...structuredClone(original), name: 'Older name', hypothesis: 'Older hypothesis', updatedAt: '2026-10-29T15:00:00Z' }
  await expect(run(older, original, request(false, { isRestoringVersion: true }))).resolves.toBe(older)
})
test.each(['seed', 'arms'] as const)('Restore of a complete older running version rejects changed %s', async field => {
  const original = fixture('running')
  const older = { ...structuredClone(original), name: 'Older name', updatedAt: '2026-10-29T15:00:00Z', [field]: changes[field] }
  await expect(run(older, original, request(false, { isRestoringVersion: true }))).rejects.toMatchObject({ field })
})
test.each(statuses)('unchanged realistic admin post-back is accepted in %s', async status => {
  const original = fixture(status)
  const post = {
    ...original, layer: { id: 7, name: 'Layer' }, startedAt: '2026-10-30T10:00:00-04:00', stoppedAt: null, decidedAt: null, archivedAt: null,
    arms: original.arms.map(arm => ({ ...arm, id: `new-${arm.id}`, params: arm.key === 'control' ? { nested: { a: 1, b: 2 }, id: 'business-id' } : arm.params })),
    targeting: original.targeting.map(row => ({ ...row, id: 'new-rule' })),
    metrics: { primary: { id: 8, name: 'Primary' }, secondary: [{ id: 9, name: 'Secondary' }], guardrails: [{ id: 10, name: 'Guardrail' }] },
    decision: { ...original.decision, decidedBy: { id: 12, name: 'Admin' }, snapshotId: { id: 13 }, discardedAt: null },
    createdAt: new Date(original.createdAt), updatedAt: '2026-10-30T14:00:00Z',
  }
  await expect(run(post, original, request(false))).resolves.toBe(post)
})
test('JSON ids and date-like values remain meaningful', async () => {
  for (const params of [{ id: 'changed-id', nested: { a: 1, b: 2 } }, { id: 'business-id', nested: { a: 1, b: 3 } }]) {
    const original = fixture('running')
    await expect(run({ arms: [{ ...original.arms[0], params }, original.arms[1]] }, original)).rejects.toMatchObject({ field: 'arms' })
  }
})
test.each([true, false])('JSON null differs from a missing key (null in original: %s)', async nullInOriginal => {
  const original = fixture('running')
  const control = original.arms[0]!
  original.arms[0] = { ...control, params: { ...control.params, nested: nullInOriginal ? { a: 1, b: 2, nullable: null } : { a: 1, b: 2 } } } as typeof control
  const data = { arms: original.arms.map((arm, index) => index === 0 ? {
    ...arm, params: { ...arm.params, nested: nullInOriginal ? { a: 1, b: 2 } : { a: 1, b: 2, nullable: null } },
  } : arm) }
  await expect(run(data, original)).rejects.toMatchObject({ field: 'arms' })
})
test('relationship ids compare equally as strings, numbers and populated docs', async () => {
  const original = fixture('running')
  const data = {
    layer: '7', metrics: { primary: { id: '8' }, secondary: ['9'], guardrails: [{ id: '10' }] },
    decision: { decidedBy: '12', snapshotId: { id: '13' } },
  }
  await expect(run(data, original)).resolves.toBe(data)
  await expect(run({ layer: '8' }, original)).rejects.toMatchObject({ field: 'layer' })
})
test.each([undefined, null, []])('empty hasMany equals missing: %j', async empty => {
  const original = { ...fixture('running'), metrics: { primary: 8, secondary: empty, guardrails: empty } }
  const data = { metrics: { secondary: [], guardrails: [] } }
  await expect(run(data, original as ReturnType<typeof fixture>)).resolves.toBe(data)
  const populated = { ...original, metrics: { primary: 8, secondary: [], guardrails: [] } }
  await expect(run({ metrics: { secondary: empty, guardrails: empty } }, populated)).resolves.toBeDefined()
})
test.each(statuses)('content report host document ids remain locked in %s', async status => {
  const original = { ...fixture(status), decision: { ...fixture(status).decision, contentReport: { docs: [{ collection: 'pages', id: 1, ok: true }] } } }
  const data = { decision: { contentReport: { docs: [{ collection: 'pages', id: 2, ok: true }] } } }
  await expect(run(data, original)).rejects.toMatchObject({ field: 'decision.contentReport' })
  await expect(run({ decision: { contentReport: { docs: [{ ok: true, id: 1, collection: 'pages' }] } } }, original)).resolves.toBeDefined()
})
test('create forces lifecycle defaults, without mutating input', async () => {
  const data = { ...fixture('running'), decision: { note: 'Injected' } }
  const result = await run(data, fixture(), request(false), 'create')
  expect(result).toMatchObject({ status: 'draft', phase: 0 })
  for (const field of ['seed', 'layerSlices', 'startedAt', 'stoppedAt', 'decidedAt', 'archivedAt', 'decision']) expect(result[field]).toBeUndefined()
  expect(data.status).toBe('running')
})
test.each(['block', 'flag', 'page'])('missing or empty arms on %s create get the 50/50 defaults', async kind => {
  for (const arms of [undefined, []]) {
    const result = await run({ kind, arms }, fixture(), request(false), 'create')
    expect(result.arms).toEqual([
      { key: 'control', kind: 'control', label: 'Original', weight: 50, ...(kind === 'block' ? { slot: 'control' } : {}) },
      { key: 'variantA', kind: 'variant', label: 'Variant A', weight: 50, ...(kind === 'block' ? { slot: 'variantA' } : {}) },
    ])
  }
})
test.each(['create', 'update'] as const)('xpTransition bypasses %s unchanged', async operation => {
  const data = { kind: 'code', status: 'archived', seed: 'new', analysis: { method: 'bayesian' } }
  await expect(run(data, fixture('archived'), fakeReq({ context: { xpTransition: true } }), operation)).resolves.toBe(data)
})
test('truthy xpTransition is not an authorization', async () => {
  await expect(run({ status: 'running' }, fixture(), request(true, { xpTransition: 'yes' }))).rejects.toBeInstanceOf(XpLockedFieldError)
})
test.each([false, 'yes', {}])('non-true admin (%j) cannot create code or Bayesian experiments', async admin => {
  for (const data of [{ kind: 'code' }, { kind: 'flag', analysis: { method: 'bayesian' } }]) {
    await expect(run(data, fixture(), request(admin), 'create')).rejects.toBeInstanceOf(XpLockedFieldError)
  }
})
test.each([true, undefined])('admin or manage default (%s) permits privileged creation', async admin => {
  await expect(run({ kind: 'code', analysis: { method: 'bayesian' } }, fixture(), request(admin), 'create')).resolves.toMatchObject({ kind: 'code', analysis: { method: 'bayesian' } })
})
test('non-admin may create sequential and leave method unspecified', async () => {
  for (const analysis of [undefined, { method: 'sequential' }]) await expect(run({ kind: 'flag', analysis }, fixture(), request(false), 'create')).resolves.toMatchObject({ kind: 'flag' })
})
test.each(['draft', 'stopped'] as const)('changed method in %s requires admin, including resets', async status => {
  await expect(run({ analysis: { method: 'bayesian' } }, fixture(status), request(false))).rejects.toMatchObject({ field: 'analysis.method' })
  const original = fixture(status)
  original.analysis.method = 'bayesian'
  await expect(run({ analysis: { method: 'sequential' } }, original, request(false))).rejects.toMatchObject({ field: 'analysis.method' })
  await expect(run({ analysis: null }, original, request(false))).rejects.toMatchObject({ field: 'analysis.method' })
  await expect(run({ analysis: { method: 'bayesian' } }, original, request(false))).resolves.toEqual({ analysis: { method: 'bayesian' } })
})
test.each(statuses)('arm keys change only in draft: %s', async status => {
  const original = fixture(status)
  const data = { arms: original.arms.map(arm => ({ ...arm, key: arm.key === 'variantA' ? 'variantB' : arm.key })) }
  if (status === 'draft') await expect(run(data, original)).resolves.toBe(data)
  else await expect(run(data, original)).rejects.toBeInstanceOf(XpLockedFieldError)
})
test('stopped may add a holdout for the next phase', async () => {
  const original = fixture('stopped')
  const data = { arms: [
    ...original.arms.map(arm => ({ ...arm, weight: 45 })),
    { key: 'holdout', kind: 'holdout', label: 'Holdout', weight: 10 },
  ] }
  await expect(run(data, original)).resolves.toBe(data)
})
test('stopped may remove a variant, preserving surviving row identities', async () => {
  const original = fixture('stopped')
  original.arms.push({ ...original.arms[1]!, id: 'variant-b', key: 'variantB', label: 'Variant B', weight: 0 })
  const data = { arms: original.arms.filter(arm => arm.key !== 'variantA') }
  await expect(run(data, original)).resolves.toBe(data)
})
test.each([true, false])('stopped refuses in-place key swaps (row ids: %s)', async withIds => {
  const original = fixture('stopped')
  if (!withIds) original.arms = original.arms.map(({ id: _id, ...arm }) => arm) as typeof original.arms
  const data = { arms: original.arms.map(arm => arm.key === 'variantA' ? { ...arm, key: 'variantB' } : arm) }
  await expect(run(data, original)).rejects.toMatchObject({ field: 'arms.key' })
})
test('stopped matches row ids as strings when arms reorder', async () => {
  const original = fixture('stopped')
  const data = { arms: [...original.arms].reverse() }
  await expect(run(data, original)).resolves.toBe(data)
})
test('missing options produce a clear installation error', () => {
  expect(() => xpOptionsFromReq(fakeReq())).toThrow('req.payload.config.custom.xp')
})
test('options helper returns the installed options', () => {
  const req: PayloadRequest = request()
  expect(xpOptionsFromReq(req)).toBe(req.payload.config.custom?.xp)
})
