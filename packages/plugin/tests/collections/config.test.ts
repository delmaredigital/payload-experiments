import { describe, expect, test, vi } from 'vitest'
import { buildCollections } from '../../src/collections/index.js'
import { createDefaults } from '../../src/collections/experiments/createDefaults.js'
import { lockHook } from '../../src/collections/experiments/lockHook.js'
import { flagControlParams } from '../../src/collections/experiments/flagControlParams.js'
import { deleteGuard, deleteGuardAfter } from '../../src/collections/experiments/deleteGuard.js'
import { checkArms } from '../../src/collections/experiments/armInvariants.js'
import { XpNotImplemented } from '../../src/errors.js'
import * as paths from '../../src/admin/paths.js'
import { TAB_DESCRIPTIONS } from '../../src/admin/copy/tabs.js'
import { serializeAttributeKeys, serializeFlagPoints, serializeMetricSources } from '../../src/collections/serialize.js'
import { fakeReq } from '../_fakes/req.js'
import { field, flatten, invoke, sampleOptions, validate } from './fixtures.js'

vi.mock('../../src/collections/experiments/armInvariants.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/collections/experiments/armInvariants.js')>(), checkArms: vi.fn(),
}))

const options = sampleOptions()
const { collections, globals } = buildCollections(options)
const experiments = collections[0]!
const bySlug = (slug: string) => collections.find(collection => collection.slug === slug)!
const flagPoints = [{ id: 'cta', label: 'CTA', params: { title: { type: 'text', label: 'Title' } }, defaultParams: { title: 'Join' }, effectiveDefaults: { title: 'Join' } }]
const attributeKeys = { country: { type: 'string', values: ['US', 'CA'] }, age: { type: 'number' } }

test('all collection identities, storage flags and version settings', () => {
  expect(collections.map(c => c.slug)).toEqual(['xp-experiments', 'xp-phases', 'xp-layers', 'xp-metrics', 'xp-events', 'xp-identities', 'xp-results-snapshots'])
  for (const collection of collections) {
    expect(collection.graphQL).toBe(false)
    expect(collection.disableDuplicate).toBe(true)
    expect(collection.versions).toEqual(collection === experiments ? { drafts: false } : undefined)
    expect(collection.admin?.hidden).toBe(['xp-phases', 'xp-events', 'xp-identities', 'xp-results-snapshots'].includes(collection.slug) ? true : undefined)
  }
  expect(globals[0]).toMatchObject({ slug: 'xp-state', dbName: 'xp_state', graphQL: false, admin: { hidden: true } })
  expect(field(globals[0]!.fields, 'revision', 'number').defaultValue).toBe(0)
})

test('frozen JSON fields, uniques and compound indexes', () => {
  for (const name of ['arms', 'allocation', 'allocationChanges', 'targeting', 'metricDefinitions', 'analysis', 'contentChanges']) expect(field(bySlug('xp-phases').fields, name, 'json')).toBeDefined()
  for (const [slug, name] of [['xp-events', 'dedupeKey'], ['xp-identities', 'anonymousId'], ['xp-layers', 'slug']] as const) expect(field(bySlug(slug).fields, name, 'text').unique).toBe(true)
  expect(field(bySlug('xp-events').fields, 'dedupeKey', 'text').index).toBe(true)
  expect(bySlug('xp-events').indexes).toEqual([{ fields: ['experiment', 'phase', 'type', 'ts'] }, { fields: ['unitId', 'experiment'] }, { fields: ['type', 'eventName', 'ts'] }])
  expect(bySlug('xp-events').hooks).toBeUndefined()
  expect(bySlug('xp-results-snapshots').indexes).toEqual([{ fields: ['experiment', 'computedAt'] }])
  expect(field(bySlug('xp-events').fields, 'userId', 'text').required).not.toBe(true)
})

test('single parent relationships allow SET NULL on deletion', () => {
  for (const slug of ['xp-phases', 'xp-results-snapshots', 'xp-events']) {
    expect(field(bySlug(slug).fields, 'experiment', 'relationship').required).toBeFalsy()
  }
  for (const collection of collections) for (const f of flatten(collection.fields)) {
    if (f.type === 'relationship' && !f.hasMany) expect(f.required, `${collection.slug}.${f.name}`).toBeFalsy()
  }
})

test('unnamed editor tabs preserve document paths and hook ordering', () => {
  const tabs = experiments.fields.filter(f => f.type === 'tabs')
  expect(tabs).toHaveLength(1)
  expect(tabs[0]).not.toHaveProperty('name')
  expect(tabs[0]!.tabs.map(tab => ({ label: tab.label, description: tab.description }))).toEqual(Object.entries(TAB_DESCRIPTIONS).map(([label, description]) => ({ label, description })))
  for (const tab of tabs[0]!.tabs) expect(tab).not.toHaveProperty('name')
  expect(experiments.hooks).toEqual({ beforeValidate: [createDefaults], beforeChange: [flagControlParams, lockHook], beforeDelete: [deleteGuard], afterDelete: [deleteGuardAfter] })
})

test.each([undefined, []])('create defaults populate missing/empty arms (%j)', arms => {
  expect(invoke(experiments.hooks?.beforeValidate?.[0], { data: { kind: 'block', arms }, operation: 'create' })).toEqual({ kind: 'block', arms: [
    { key: 'control', label: 'Original', kind: 'control', slot: 'control', weight: 50 },
    { key: 'variantA', label: 'Variant A', kind: 'variant', slot: 'variantA', weight: 50 },
  ] })
})
test.each(['page', 'flag', 'code', undefined])('create defaults omit slots for %s', kind => {
  const result = invoke(createDefaults, { data: { kind, arms: [] }, operation: 'create' })
  expect(result.arms).toEqual([
    { key: 'control', label: 'Original', weight: 50, kind: 'control' },
    { key: 'variantA', label: 'Variant A', weight: 50, kind: 'variant' },
  ])
})
test('create defaults preserve explicit arms and updates', () => {
  const data = { kind: 'block', arms: [{ key: 'control', weight: 90 }, { key: 'holdout', weight: 10 }] }
  expect(invoke(createDefaults, { data, operation: 'create' })).toBe(data)
  expect(invoke(createDefaults, { data: { arms: [] }, operation: 'update' })).toEqual({ arms: [] })
})

describe('admin mounts (one case per mount)', () => {
  test('status cell', () => expect(field(experiments.fields, 'status', 'select').admin?.components?.Cell).toBe(paths.XP_STATUS_CELL))
  test('summary is list only', () => {
    const summary = field(experiments.fields, 'listSummary', 'ui')
    expect(summary.admin.components?.Cell).toBe(paths.XP_SUMMARY_CELL)
    expect(invoke(summary.admin.condition, {})).toBe(false)
  })
  test('actions is first in sidebar', () => expect(experiments.fields[0]).toMatchObject({ type: 'ui', admin: { position: 'sidebar', components: { Field: paths.XP_ACTIONS } } }))
  test.each(['name', 'hypothesis', 'arms', 'targeting', 'allocation', 'flagPoint', 'metrics', 'analysis', 'exposurePolicy'])('locked description: %s', name => {
    const f = flatten(experiments.fields).find(f => 'name' in f && f.name === name)!
    expect(f.admin?.components?.Description).toBe(paths.XP_LOCKED_NOTICE)
    expect(f.admin?.custom?.field).toBe(name)
  })
  test('flag point select', () => expect(field(experiments.fields, 'flagPoint', 'text').admin).toMatchObject({ components: { Field: paths.XP_FLAG_POINT_SELECT }, custom: { flagPoints } }))
  test('arms editor', () => expect(field(experiments.fields, 'arms', 'array').admin).toMatchObject({ components: { Field: paths.XP_ARMS_FIELD }, custom: { flagPoints } }))
  test('allocation editor', () => expect(field(experiments.fields, 'allocation', 'number').admin?.components?.Field).toBe(paths.XP_ALLOCATION_FIELD))
  test.each([['attribute', 'text', paths.XP_TARGETING_ATTRIBUTE], ['op', 'select', paths.XP_TARGETING_OP], ['value', 'json', paths.XP_TARGETING_VALUE]] as const)('targeting %s', (name, type, path) => expect(field(field(experiments.fields, 'targeting', 'array').fields, name, type).admin).toMatchObject({ components: { Field: path }, custom: { attributeKeys } }))
  test('review panel', () => expect(field(experiments.fields, 'review', 'ui').admin.components?.Field).toBe(paths.XP_REVIEW_PANEL))
  test('phase history sidebar', () => expect(field(experiments.fields, 'phaseHistory', 'ui').admin).toMatchObject({ position: 'sidebar', components: { Field: paths.XP_PHASE_HISTORY } }))
  test('results view', () => expect(experiments.admin?.components?.views?.edit).toEqual({ results: { Component: paths.XP_RESULTS_VIEW, path: '/results', tab: { label: 'Results', href: '/results' } } }))
  test('metric source select', () => expect(field(bySlug('xp-metrics').fields, 'source', 'text').admin).toMatchObject({ components: { Field: paths.XP_METRIC_SOURCE_SELECT }, custom: { sources: serializeMetricSources(options) } }))
  test('layer usage', () => expect(field(bySlug('xp-layers').fields, 'usage', 'ui').admin.components?.Field).toBe(paths.XP_LAYER_USAGE))
})

test('serialized options omit host functions and include event sources', () => {
  expect(serializeFlagPoints(options)).toEqual(flagPoints)
  expect(serializeAttributeKeys(options)).toEqual(attributeKeys)
  expect(serializeMetricSources(options)).toEqual([
    ...['binomial', 'count', 'revenue'].map(kind => ({ id: kind, label: kind, kind, keyedBy: 'user', clientWritable: false })),
    { id: 'events:signup', label: 'signup', kind: 'binomial', keyedBy: 'visitor', clientWritable: true },
  ])
  expect(JSON.parse(JSON.stringify(serializeFlagPoints(options)))).toEqual(flagPoints)
})

test('registered text validators, page unit and exposure policy validation', () => {
  const point = field(experiments.fields, 'flagPoint', 'text')
  expect(validate(point.validate, 'cta', { data: { kind: 'flag' } })).toBe(true)
  expect(validate(point.validate, 'missing', { data: { kind: 'flag' } })).not.toBe(true)
  expect(validate(point.validate, undefined, { data: { kind: 'flag' } })).not.toBe(true)
  const attr = field(experiments.fields, 'attribute', 'text')
  expect(validate(attr.validate, 'country')).toBe(true)
  expect(validate(attr.validate, 'toString')).not.toBe(true)
  expect(validate(field(experiments.fields, 'unitType', 'select').validate, 'user', { data: { kind: 'page' } })).not.toBe(true)
  const policy = field(experiments.fields, 'exposurePolicy', 'select')
  for (const [kind, value] of [['block', 'render'], ['block', 'viewport'], ['page', 'pageview'], ['flag', 'manual'], ['code', 'manual']]) expect(validate(policy.validate, value, { data: { kind } })).toBe(true)
  expect(validate(policy.validate, 'render', { data: { kind: 'flag' } })).not.toBe(true)
})

test('field access hides code kind and analysis method from non-admins', async () => {
  const config = buildCollections({ ...options, access: { manage: () => true, admin: () => false } }).collections[0]!
  const req = fakeReq()
  expect(await invoke(field(config.fields, 'kind', 'select').access?.read, { req, doc: { kind: 'code' } })).toBe(false)
  expect(await invoke(field(config.fields, 'kind', 'select').access?.read, { req, doc: { kind: 'block' } })).toBe(true)
  expect(await invoke(field(config.fields, 'method', 'select').access?.read, { req })).toBe(false)
  expect(field(config.fields, 'kind', 'select').access?.update).toBeUndefined()
})

test('custom number validators retain required and range checks', () => {
  const allocation = field(experiments.fields, 'allocation', 'number').validate
  for (const value of [null, undefined, 0, 101, 1.5, Infinity]) expect(validate(allocation, value)).not.toBe(true)
  for (const value of [1, 50, 100]) expect(validate(allocation, value)).toBe(true)
  const durationField = field(experiments.fields, 'plannedDurationDays', 'number')
  expect(durationField.required).toBeFalsy()
  const duration = durationField.validate
  for (const value of [null, undefined]) expect(validate(duration, value)).toBe(true)
  for (const value of [0, -1, 1.5, Infinity]) expect(validate(duration, value)).not.toBe(true)
  expect(validate(duration, 14)).toBe(true)
  const reachField = field(experiments.fields, 'reachPerDay', 'number')
  expect(reachField.required).toBeFalsy()
  const reach = reachField.validate
  expect(validate(reach, -1, { data: { exposurePolicy: 'render' } })).not.toBe(true)
  expect(validate(reach, null, { data: { exposurePolicy: 'render' } })).toBe(true)
  for (const policy of ['manual', 'viewport', 'pageview', 'render']) for (const value of [null, undefined]) expect(validate(reach, value, { data: { exposurePolicy: policy } })).toBe(true)
  for (const value of [0, -1, 1.5, Infinity]) expect(validate(reach, value)).not.toBe(true)
  expect(validate(reach, 100, { data: { exposurePolicy: 'viewport' } })).toBe(true)
})

test('arms validation delegates kind and joins issue messages', () => {
  const validator = field(experiments.fields, 'arms', 'array').validate
  const arms = [{ key: 'control', weight: 100 }]
  const mock = vi.mocked(checkArms).mockReset().mockReturnValue([])
  expect(validate(validator, arms, { siblingData: { kind: 'block' }, data: { kind: 'flag' } })).toBe(true)
  expect(mock).toHaveBeenLastCalledWith(arms, 'block')
  mock.mockReturnValue([
    { code: 'weights-total', message: 'Weights must total 100.' },
    { code: 'control-count', message: 'Choose one Original.' },
  ])
  expect(validate(validator, arms, { siblingData: {}, data: { kind: 'page' } })).toBe('Weights must total 100.; Choose one Original.')
  expect(mock).toHaveBeenLastCalledWith(arms, 'page')
  mock.mockImplementation(() => { throw new XpNotImplemented('CORE-03') })
  expect(validate(validator, arms, { siblingData: {}, data: { kind: 'block' } })).toBe(true)
  const unexpected = new Error('unexpected failure')
  mock.mockImplementation(() => { throw unexpected })
  expect(() => validate(validator, arms, { siblingData: {}, data: { kind: 'block' } })).toThrow(unexpected)
})

test('targeting values match the attribute type and operator', () => {
  const options = sampleOptions()
  options.attributeKeys!.subscribed = { type: 'boolean' }
  const config = buildCollections(options).collections[0]!
  const validator = field(field(config.fields, 'targeting', 'array').fields, 'value', 'json').validate
  const check = (attribute: string, op: string, value: unknown) => validate(validator, value, { siblingData: { attribute, op } })
  expect(check('age', 'gt', 18)).toBe(true)
  expect(check('age', 'gt', 'older')).not.toBe(true)
  expect(check('age', 'gt', Infinity)).not.toBe(true)
  expect(check('country', 'eq', 'US')).toBe(true)
  expect(check('country', 'in', ['US', 'CA'])).toBe(true)
  expect(check('country', 'nin', ['US', 42])).not.toBe(true)
  expect(check('country', 'eq', ['US'])).not.toBe(true)
  expect(check('country', 'in', 'US')).not.toBe(true)
  expect(check('subscribed', 'eq', false)).toBe(true)
  expect(check('subscribed', 'eq', {})).not.toBe(true)
  expect(check('subscribed', 'contains', true)).not.toBe(true)
  expect(check('unknown', 'eq', 'value')).not.toBe(true)
})
