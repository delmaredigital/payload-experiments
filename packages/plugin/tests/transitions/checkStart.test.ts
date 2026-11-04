import { describe, expect, test } from 'vitest'
import { checkStart, ARM_CHECK_ORDER } from '../../src/transitions/checkStart.js'
import type { CheckStartInput } from '../../src/transitions/checkStart.js'
import type { Arm } from '../../src/types/contracts.js'
import { defaultArms } from '../../src/collections/experiments/armInvariants.js'

export function ready(): CheckStartInput {
  return { experiment: { id: 1, slug: 'hero', kind: 'block', status: 'draft', unitType: 'visitor', arms: defaultArms('block'),
    allocation: 50, exposurePolicy: 'render', metrics: { primary: 2 }, analysis: { plannedDurationDays: 14 } },
    metrics: [{ id: 2, source: 'signup' }], metricSources: [{ id: 'signup', keyedBy: 'user' }],
    placements: [{ collection: 'pages', id: 1, title: 'Home', published: true, slots: { control: 1, variantA: 1, variantB: 0, variantC: 0 } }],
  }
}
function flag(input: CheckStartInput) {
  input.experiment.kind = 'flag'; input.experiment.flagPoint = 'cta'
  input.flagPoints = [{ id: 'cta', label: 'CTA', defaultParams: {}, params: { title: { type: 'text', label: 'Title', required: true } } }]
  input.experiment.arms = defaultArms('flag').map(arm => ({ ...arm, params: { title: 'Hello' } }))
}
const cases: Array<[string, (input: CheckStartInput) => void]> = [
  ['invalid-status', i => { i.experiment.status = 'running' }],
  ['weights-total', i => { i.experiment.arms[0]!.weight = 12 }],
  ['control-count', i => { i.experiment.arms = [] }],
  ['control-first', i => { i.experiment.arms.reverse() }],
  ['holdout-count', i => { i.experiment.arms.push(...[0, 1].map(() => ({ key: 'holdout', kind: 'holdout', label: 'Holdout', weight: 0 } as Arm))) }],
  ['holdout-last', i => { i.experiment.arms.unshift({ key: 'holdout', kind: 'holdout', label: 'Holdout', weight: 0 }) }],
  ['variant-count', i => { i.experiment.arms.push(...Array.from({ length: 3 }, () => ({ ...i.experiment.arms[1]!, weight: 0 }))) }],
  ['invalid-key', i => { i.experiment.arms[0]!.key = 'variantA' }],
  ['duplicate-key', i => { i.experiment.arms.push({ ...i.experiment.arms[1]!, weight: 0 }) }],
  ['slot-required', i => { delete i.experiment.arms[1]!.slot }],
  ['duplicate-slot', i => { i.experiment.arms[1]!.slot = 'control' }],
  ['no-planned-duration', i => { i.experiment.analysis = {} }],
  ['no-primary-metric', i => { i.experiment.metrics = {} }],
  ['no-reach-per-day', i => { i.experiment.exposurePolicy = 'manual' }],
  ['page-no-targets', i => { i.experiment.kind = 'page' }],
  ['page-in-use', i => { i.experiment.kind = 'page'; i.experiment.arms[0]!.pageTarget = '/shared/'; i.pageTestsInUse = [{ id: 2, arms: [{ ...i.experiment.arms[0]!, pageTarget: '/shared' }] }] }],
  ['page-user-unit', i => { i.experiment.kind = 'page'; i.experiment.unitType = 'user' }],
  ['flag-no-point', i => { i.experiment.kind = 'flag' }],
  ['flag-params-invalid', i => { flag(i); i.experiment.arms[1]!.params = { title: 42 } }],
  ['flag-point-busy', i => { flag(i); i.flagPointBusy = true }],
  ['flag-placement-missing', i => { flag(i); i.flagPlacements = [{ arm: 'control', ok: true }] }],
  ['no-placements', i => { i.placements = [] }],
  ['empty-slot', i => { i.placements![0]!.slots.variantA = 0 }],
  ['layer-unit-mismatch', i => { i.experiment.layer = 3; i.layer = { unitType: 'user', usedSlices: [] } }],
  ['layer-full', i => { i.experiment.layer = 3; i.layer = { unitType: 'visitor', usedSlices: Array.from({ length: 51 }, (_, n) => n) } }],
  ['unknown-metric-source', i => { i.metricSources = [] }],
  ['unit-source-mismatch', i => { i.experiment.unitType = 'user'; i.metricSources![0]!.keyedBy = 'visitor' }],
  ['invalid-targeting-rule', i => { i.attributeKeys = { country: { type: 'string' } }; i.experiment.targeting = [{ attribute: 'country', op: 'eq', value: 42 }] }],
  ['undeclared-targeting-key', i => { i.experiment.targeting = [{ attribute: 'country', op: 'eq', value: 'US' }] }],
  ['block-path-rule', i => { i.experiment.targeting = [{ attribute: 'path', op: 'eq', value: '/home' }] }],
]
describe('checkStart', () => {
  test.each(cases)('refuses %s', (code, mutate) => {
    const input = ready(); mutate(input)
    expect(checkStart(input)).toContainEqual(expect.objectContaining({ code, ok: false }))
  })
  test('all checks pass and remain in fixed order even when many checks fail', () => {
    const input = ready()
    const order = ['invalid-status', ...ARM_CHECK_ORDER, 'no-planned-duration', 'no-primary-metric', 'no-reach-per-day', 'page-no-targets', 'page-in-use', 'page-target-unpublished', 'page-targets-unchecked', 'page-user-unit', 'flag-no-point', 'flag-params-invalid', 'flag-point-busy', 'flag-placement-missing', 'no-placements', 'empty-slot', 'make-content-unsupported', 'layer-unit-mismatch', 'layer-full', 'unknown-metric-source', 'unit-source-mismatch', 'block-path-rule', 'undeclared-targeting-key', 'invalid-targeting-rule']
    expect(checkStart(input)).toEqual(order.map(code => ({ code, ok: true })))
    for (const [, mutate] of cases) {
      const changed = ready(); mutate(changed)
      expect(checkStart(changed).map(check => check.code)).toEqual(order)
    }
  })
  test('block path rules report only offending indexes before other targeting failures', () => {
    const input = ready()
    input.experiment.targeting = [
      { attribute: 'country', op: 'eq', value: 'US' },
      { attribute: 'path', op: 'eq', value: '/private' },
      { attribute: 'path', op: 'in', value: ['/other'] },
    ]
    expect(checkStart(input).filter(check => !check.ok)[0]).toEqual({ code: 'block-path-rule', ok: false, detail: { rules: [1, 2] } })
  })
  test.each(['page', 'flag', 'code', 'block'] as const)('%s permits targeting other than block path rules', kind => {
    const input = ready()
    input.experiment.kind = kind
    input.experiment.targeting = [{ attribute: kind === 'block' ? 'country' : 'path', op: 'eq', value: '/home' }]
    expect(checkStart(input)).toContainEqual({ code: 'block-path-rule', ok: true })
  })
  test('stopped is startable; holdout needs neither page target nor content slot', () => {
    const input = ready(); input.experiment.status = 'stopped'
    input.experiment.arms.push({ key: 'holdout', label: 'Holdout', kind: 'holdout', weight: 0 })
    expect(checkStart(input).every(check => check.ok)).toBe(true)
    input.experiment.kind = 'page'
    input.experiment.arms = input.experiment.arms.map(arm => arm.kind === 'holdout' ? arm : { ...arm, pageTarget: '/hello' })
    expect(checkStart(input).every(check => check.ok)).toBe(true)
  })
  test.each(['user', 'visitor'] as const)('events sources serve %s experiments', unitType => {
    const input = ready(); input.experiment.unitType = unitType; input.metrics[0]!.source = 'events:signup'
    input.metricSources = []
    expect(checkStart(input).find(check => check.code === 'unknown-metric-source')?.ok).toBe(true)
    expect(checkStart(input).find(check => check.code === 'unit-source-mismatch')?.ok).toBe(true)
  })
  test('checks secondary and guardrail sources, allows linked user sources on visitor experiments', () => {
    const input = ready()
    expect(checkStart(input).every(check => check.ok)).toBe(true)
    input.experiment.unitType = 'user'
    input.metrics.push({ id: 9, source: 'views' }); input.metricSources!.push({ id: 'views', keyedBy: 'visitor' })
    expect(checkStart(input)).toContainEqual(expect.objectContaining({ code: 'unit-source-mismatch', ok: false }))
  })
  test('flag holdout needs no placement; a missing variant still refuses Start', () => {
    const input = ready(); flag(input)
    input.experiment.exposurePolicy = 'manual'
    input.experiment.analysis!.reachPerDay = 100
    input.experiment.arms.forEach(arm => { arm.weight = 45 })
    input.experiment.arms.push({ key: 'holdout', label: 'Holdout', kind: 'holdout', weight: 10 })
    input.flagPlacements = [{ arm: 'control', ok: true }, { arm: 'variantA', ok: true }]
    expect(checkStart(input).every(check => check.ok)).toBe(true)
    input.flagPlacements = [{ arm: 'control', ok: true }]
    expect(checkStart(input)).toContainEqual(expect.objectContaining({ code: 'flag-placement-missing', ok: false }))
  })
  test('counts distinct occupied slices and requires allocation free slices', () => {
    const input = ready(); input.experiment.layer = 1
    input.layer = { unitType: 'visitor', usedSlices: [...Array.from({ length: 50 }, (_, n) => n), 0] }
    expect(checkStart(input).every(check => check.ok)).toBe(true)
  })
  test('hook errors retain detail and failed rows cannot be masked by successful duplicates', () => {
    const input = ready(); flag(input)
    input.flagPlacementError = 'placements-failed'
    expect(checkStart(input)).toContainEqual({ code: 'flag-placement-missing', ok: false, detail: 'placements-failed' })
    delete input.flagPlacementError
    input.flagPlacements = [{ arm: 'control', ok: true }, { arm: 'variantA', ok: true }, { arm: 'variantA', ok: false, detail: 'Missing published content' }]
    expect(checkStart(input).find(check => check.code === 'flag-placement-missing')?.ok).toBe(false)
  })
  test.each([
    [{ type: 'number', min: 1, max: 5 }, 0], [{ type: 'number', min: 1, max: 5 }, 6], [{ type: 'number' }, NaN],
    [{ type: 'checkbox' }, 'true'], [{ type: 'select', options: [{ label: 'Yes', value: 'yes' }] }, 'no'],
    [{ type: 'textarea', required: true }, '   '],
  ])('validates ParamField %j', (field, value) => {
    const input = ready(); flag(input)
    input.flagPoints![0]!.params = { title: { label: 'Title', ...field } as import('../../src/types/contracts.js').ParamField }
    input.experiment.arms[1]!.params = { title: value }
    expect(checkStart(input).find(check => check.code === 'flag-params-invalid')?.ok).toBe(false)
  })
})

test('localized placements warn without refusing Start', () => {
  const input = ready()
  input.placements![0]!.localized = true
  expect(checkStart(input)).toContainEqual({ code: 'make-content-unsupported', ok: true, warning: true, detail: 'Home' })
  expect(checkStart(input).every(check => check.ok)).toBe(true)
})

test('page conflicts contain only distinct normalised shared paths, excluding self and own holdout', () => {
  const input = ready()
  input.experiment.kind = 'page'
  input.experiment.arms = [
    { ...input.experiment.arms[0]!, pageTarget: '/Original/' },
    { ...input.experiment.arms[1]!, pageTarget: '/variant///' },
    { key: 'holdout', kind: 'holdout', label: 'Holdout', weight: 0, pageTarget: '/holdout' },
  ]
  input.pageTestsInUse = [
    { id: '1', arms: [{ ...input.experiment.arms[0]!, pageTarget: '/self' }] },
    { id: 2, arms: ['/Original', '/variant/', '/variant', '/unshared', '/holdout'].map(pageTarget => ({ ...input.experiment.arms[0]!, pageTarget })) },
  ]
  expect(checkStart(input)).toContainEqual({ code: 'page-in-use', ok: false, detail: { paths: ['/Original', '/variant'] } })
  input.pageTestsInUse = [{ id: '1', arms: input.experiment.arms }]
  expect(checkStart(input)).toContainEqual({ code: 'page-in-use', ok: true })
  input.pageTestsInUse = [{ id: 2, arms: [{ ...input.experiment.arms[0]!, pageTarget: '/original' }] }]
  expect(checkStart(input)).toContainEqual({ code: 'page-in-use', ok: true }) // Runtime paths are case-sensitive.
})
