import { pickExperimentSlug } from '../../src/collections/experiments/pickSlug.js'
import { describe, expect, test, vi } from 'vitest'
import { buildCollections } from '../../src/collections/index.js'
import { createDefaults } from '../../src/collections/experiments/createDefaults.js'
import { lockHook } from '../../src/collections/experiments/lockHook.js'
import { flagControlParams } from '../../src/collections/experiments/flagControlParams.js'
import { deleteGuard, deleteGuardAfter, deleteGuardBeforeOperation } from '../../src/collections/experiments/deleteGuard.js'
import { checkArms } from '../../src/collections/experiments/armInvariants.js'
import { XpNotImplemented } from '../../src/errors.js'
import * as paths from '../../src/admin/paths.js'
import { METRICS_COPY, METRIC_KIND_LABELS } from '../../src/admin/copy/metrics.js'
import { HISTORY_COPY, layerRow, layerSummary } from '../../src/admin/copy/history.js'
import { serializeAttributeKeys, serializeFlagPoints, serializeMetricSources } from '../../src/collections/serialize.js'
import { fakeReq } from '../_fakes/req.js'
import { field, flatten, invoke, sampleOptions, validate } from './fixtures.js'

vi.mock('../../src/collections/experiments/armInvariants.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/collections/experiments/armInvariants.js')>(), checkArms: vi.fn(),
}))

const options = sampleOptions()
const { collections, globals } = buildCollections(options)
const experiments = collections.find(collection => collection.slug === 'xp-experiments')!
const bySlug = (slug: string) => collections.find(collection => collection.slug === slug)!
const flagPoints = [{ id: 'cta', label: 'CTA', params: { title: { type: 'text', label: 'Title' } }, defaultParams: { title: 'Join' }, effectiveDefaults: { title: 'Join' } }]
const attributeKeys = { country: { type: 'string', values: ['US', 'CA'] }, age: { type: 'number' } }

test('all collection identities, storage flags and version settings', () => {
  expect(collections.map(c => c.slug)).toEqual(['xp-experiments', 'xp-phases', 'xp-layers', 'xp-metrics', 'xp-events', 'xp-identities', 'xp-results-snapshots'])
  for (const collection of collections) {
    expect(collection.graphQL).toBe(false)
    expect(collection.disableDuplicate).toBe(true)
    expect(collection.versions).toEqual(collection === experiments ? { drafts: false, maxPerDoc: 50 } : false)
    expect(collection.admin?.hidden).toBe(['xp-phases', 'xp-events', 'xp-identities', 'xp-results-snapshots'].includes(collection.slug) ? true : undefined)
  }
  expect(globals[0]).toMatchObject({ slug: 'xp-state', dbName: 'xp_state', graphQL: false, admin: { hidden: true } })
  expect(field(globals[0]!.fields, 'revision', 'number').defaultValue).toBe(0)
})

test('frozen JSON fields, uniques and compound indexes', () => {
  for (const name of ['arms', 'allocation', 'allocationChanges', 'targeting', 'metricDefinitions', 'analysis', 'contentChanges']) expect(field(bySlug('xp-phases').fields, name, 'json')).toBeDefined()
  for (const [slug, name] of [['xp-events', 'dedupeKey'], ['xp-identities', 'anonymousId'], ['xp-layers', 'slug']] as const) expect(field(bySlug(slug).fields, name, 'text').unique).toBe(true)
  expect(field(bySlug('xp-events').fields, 'dedupeKey', 'text').index).toBe(true)
  expect(bySlug('xp-events').indexes).toEqual([{ fields: ['experiment', 'phase', 'type', 'ts'] }, { fields: ['unitId', 'experiment'] }, { fields: ['type', 'eventName', 'ts'] }, { fields: ['experiment', 'type', 'ts'] }])
  expect(field(bySlug('xp-events').fields, 'dimensions', 'json')).toMatchObject({ admin: { hidden: true, readOnly: true } })
  expect(field(bySlug('xp-events').fields, 'dimensions', 'json').required).not.toBe(true)
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
  expect(tabs[0]!.tabs.map(tab => ({ label: tab.label, description: tab.description }))).toEqual(['What', 'Who', 'Groups', 'Metrics'].map(label => ({ label, description: undefined })))
  for (const tab of tabs[0]!.tabs) expect(tab).not.toHaveProperty('name')
  expect(experiments.hooks).toEqual({ beforeOperation: [deleteGuardBeforeOperation], beforeValidate: [createDefaults], beforeChange: [flagControlParams, lockHook, pickExperimentSlug], beforeDelete: [deleteGuard], afterDelete: [deleteGuardAfter], afterError: [expect.any(Function)] })
})

test.each([undefined, []])('create defaults populate missing/empty arms (%j)', arms => {
  expect(invoke(experiments.hooks?.beforeValidate?.[0], { data: { kind: 'block', arms }, operation: 'create' })).toEqual({ kind: 'block', analysis: { plannedDurationDays: 28 }, arms: [
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
  test('list summary column is removed', () => {
    expect(flatten(experiments.fields).some(f => 'name' in f && f.name === 'listSummary')).toBe(false)
    expect(experiments.admin?.defaultColumns).not.toContain('listSummary')
  })
  test('results view', () => expect(experiments.admin?.components?.views?.edit).toEqual({ default: { Component: paths.XP_TEST_EDIT_REDIRECT }, results: { Component: paths.XP_TEST_EDIT_REDIRECT, path: '/results', tab: { label: 'Results', href: '/results' } } }))
  test('metric source select', () => expect(field(bySlug('xp-metrics').fields, 'source', 'text').admin).toMatchObject({ components: { Field: paths.XP_METRIC_SOURCE_SELECT }, custom: { sources: serializeMetricSources(options) } }))
  test('layer usage', () => expect(field(bySlug('xp-layers').fields, 'usage', 'ui').admin.components?.Field).toBe(paths.XP_LAYER_USAGE))
})

test('experiments field tree has no components or ui fields', () => {
  for (const f of flatten(experiments.fields)) {
    expect(f.admin ?? {}, 'name' in f ? f.name : f.type).not.toHaveProperty('components')
    expect(f.type).not.toBe('ui')
    for (const key of ['flagPoints', 'attributeKeys', 'field']) expect(f.admin?.custom ?? {}).not.toHaveProperty(key)
  }
})

const forbiddenWords = /\b(?:slug|source id|unit ?types?|unitType|arm|phase|flag point|exposure|metric source|CUPED|percentile|layer|slice)s?\b/i
const plainWords = (value: unknown) => {
  expect(typeof value).toBe('string')
  expect((value as string).trim()).not.toBe('')
  expect(value).not.toMatch(forbiddenWords)
}

test.each(['xp-metrics', 'xp-layers'])('%s field labels, descriptions and options use plain words', slug => {
  for (const f of flatten(bySlug(slug).fields)) {
    plainWords('label' in f ? f.label : undefined)
    plainWords(f.admin && 'description' in f.admin ? f.admin.description : undefined)
    if (f.type === 'select') for (const option of f.options) {
      expect(typeof option).toBe('object')
      plainWords(typeof option === 'string' ? option : option.label)
    }
  }
})

test('retained Goals and Test groups components use plain words', () => {
  for (const copy of [
    ...Object.values(METRICS_COPY), ...Object.values(METRIC_KIND_LABELS),
    layerSummary(40, 60), layerRow('A', 'Running', 5), HISTORY_COPY.layers,
  ]) plainWords(copy)
})

test('the minimum before deciding describes completing the goal', () => {
  const minimum = field(bySlug('xp-metrics').fields, 'minSampleSize', 'number')
  expect(minimum.label).toBe('Minimum completions before deciding')
  expect(minimum.admin?.description).toContain('completed the goal')
  expect(minimum.admin?.description).not.toMatch(/seen/i)
})

test('amount limits explain past amounts and keeping all but the largest 1%', () => {
  const capping = field(bySlug('xp-metrics').fields, 'capping', 'group').fields
  expect(field(capping, 'type', 'select').options).toContainEqual({ label: 'Based on past amounts', value: 'percentile' })
  expect(field(capping, 'value', 'number').admin?.description).toBe('For past amounts, enter how much of the usual range to keep, such as 0.99 to limit only the largest 1%; or enter a fixed amount.')
})

test('Goals and Test groups validation messages use plain words', () => {
  const goals = bySlug('xp-metrics').fields
  const groups = bySlug('xp-layers').fields
  const capping = field(goals, 'capping', 'group').fields
  const cases = [
    [field(goals, 'slug', 'text'), 'BAD', { data: { source: 'click:bad' } }],
    [field(goals, 'source', 'text'), 'missing', {}],
    [field(capping, 'type', 'select'), 'absolute', { data: { source: 'count' }, siblingData: { value: 10 } }],
    [field(capping, 'type', 'select'), 'missing', { data: { source: 'revenue' }, siblingData: { value: 10 } }],
    [field(capping, 'value', 'number'), -1, { siblingData: { type: 'absolute' } }],
    [field(groups, 'slug', 'text'), '', { operation: 'create' }],
    [field(groups, 'slug', 'text'), 'changed', { operation: 'update', previousValue: 'group' }],
    [field(groups, 'unitType', 'select'), 'missing', { operation: 'create' }],
    [field(groups, 'unitType', 'select'), 'user', { operation: 'update', previousValue: 'visitor' }],
  ] as const
  // Keep this exhaustive if another custom validator is added to either collection.
  const validators = [...flatten(goals), ...flatten(groups)].filter(f => 'validate' in f && typeof f.validate === 'function')
  expect(new Set(cases.map(([f]) => f))).toEqual(new Set(validators))
  for (const [f, value, args] of cases) plainWords(validate(f.validate, value, args))
})

test('serialized options omit host functions and include event sources', () => {
  expect(serializeFlagPoints(options)).toEqual(flagPoints)
  expect(serializeAttributeKeys(options)).toEqual(attributeKeys)
  expect(serializeMetricSources(options)).toEqual([
    { id: 'click:', label: 'A click on the page', kind: 'binomial', keyedBy: 'visitor', clientWritable: true },
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
  const config = buildCollections({ ...options, access: { manage: () => true, admin: () => false } }).collections.find(collection => collection.slug === 'xp-experiments')!
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
  const config = buildCollections(options).collections.find(collection => collection.slug === 'xp-experiments')!
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


test('Tests collections form a regular group and render their surface in place', () => {
  for (const slug of ['xp-experiments', 'xp-metrics']) {
    expect(bySlug(slug).admin?.group).toBe('Tests')
    expect(bySlug(slug).admin).not.toHaveProperty('hidden')
  }
  expect(bySlug('xp-layers').admin?.group).toBe(false)
  for (const slug of ['xp-phases', 'xp-events', 'xp-identities', 'xp-results-snapshots']) {
    expect(bySlug(slug).admin?.hidden).toBe(true)
  }
  expect(experiments.labels).toEqual({ singular: 'Test', plural: 'All tests' })
  expect(experiments.admin?.components?.views?.list).toEqual({ Component: paths.XP_TESTS_COLLECTION_LIST })
  expect(bySlug('xp-metrics').admin?.components?.views).toEqual({ list: { Component: paths.XP_GOALS_COLLECTION_LIST }, edit: { default: { Component: paths.XP_GOAL_EDIT_REDIRECT } } })
  expect(bySlug('xp-metrics').labels).toEqual({ singular: 'Goal', plural: 'Goals' })
  expect(bySlug('xp-layers').labels).toEqual({ singular: 'Test group', plural: 'Test groups (advanced)' })
})

test.each([undefined, null])('create defaults add 28 days when duration is %j while preserving analysis', duration => {
  const data = { analysis: { plannedDurationDays: duration, reachPerDay: 123, method: 'bayesian' } }
  expect(invoke(createDefaults, { data, operation: 'create' }).analysis).toEqual({ plannedDurationDays: 28, reachPerDay: 123, method: 'bayesian' })
  expect(invoke(createDefaults, { data: {}, operation: 'create' }).analysis).toEqual({ plannedDurationDays: 28 })
  expect(invoke(createDefaults, { data: { analysis: { reachPerDay: 123 } }, operation: 'update' })).toEqual({ analysis: { reachPerDay: 123 } })
  expect(invoke(createDefaults, { data: {}, operation: 'update' })).toEqual({})
})

test.each([14, 0])('create defaults preserve a given duration (%s)', plannedDurationDays => {
  expect(invoke(createDefaults, { data: { analysis: { plannedDurationDays } }, operation: 'create' }).analysis).toEqual({ plannedDurationDays })
})

test('flag descriptions serialize only when defined', () => {
  const options = sampleOptions()
  expect(serializeFlagPoints(options)[0]).not.toHaveProperty('description')
  options.flagPoints![0]!.description = 'Changes the signup prompt.'
  expect(serializeFlagPoints(options)[0]).toHaveProperty('description', 'Changes the signup prompt.')
})
