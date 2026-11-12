import { describe, expect, test } from 'vitest'
import { changedPatch, editablePatch, payloadFieldErrors } from '../../../src/testSurface/surface/testDocument.model.js'
import type { TestDocument, TestDocumentPatch } from '../../../src/testSurface/surface/testDocument.model.js'
import type { Status } from '../../../src/types/contracts.js'
import { EDITABLE_BY_STATUS } from '../../../src/collections/experiments/editability.js'
import { lockedReason } from '../../../src/testSurface/lockedNotice.model.js'
import { XpLockedFieldError } from '../../../src/errors.js'

const doc: TestDocument = {
  id: 1, name: 'Test', slug: 'test', status: 'draft', kind: 'flag', unitType: 'visitor', allocation: 100,
  exposurePolicy: 'manual', flagPoint: 'signup', hypothesis: 'Original hypothesis',
  arms: [{ key: 'control', label: 'Original', weight: 100, kind: 'control' }],
  targeting: [{ attribute: 'staff', op: 'eq', value: false }],
  analysis: { method: 'sequential', plannedDurationDays: 28 },
  metrics: { primary: 7, secondary: [8], guardrails: [] },
}

test('diff ignores unchanged values and object key order, preserving complete arrays and groups', () => {
  expect(changedPatch(doc, JSON.parse(JSON.stringify(doc)) as TestDocumentPatch)).toEqual({})
  expect(changedPatch(doc, { analysis: { plannedDurationDays: 28, method: 'sequential' } })).toEqual({})
  const patch: TestDocumentPatch = {
    name: doc.name,
    arms: [...doc.arms, { key: 'variantA', label: 'New', weight: 0, kind: 'variant' }],
    targeting: [{ attribute: 'staff', op: 'eq', value: true }],
    analysis: { ...doc.analysis, plannedDurationDays: 35 },
    metrics: { ...doc.metrics, secondary: [8, 9] },
  }
  const { name: _name, ...expected } = patch
  expect(changedPatch(doc, patch)).toEqual(expected)
  expect(changedPatch(doc, { targeting: [], metrics: null })).toEqual({ targeting: [], metrics: null })
})

describe('status allow-list', () => {
  const partial = {
    name: 'New name', hypothesis: 'New hypothesis', arms: [], targeting: [], allocation: 50,
    flagPoint: 'other', metrics: null, analysis: null, exposurePolicy: 'render',
    status: 'running', seed: 'unsafe', phase: 20, slug: 'unsafe', kind: 'code', unitType: 'user',
    layer: 4, decision: {}, updatedAt: 'unsafe', 'analysis.reachPerDay': 100,
  } as TestDocumentPatch
  test.each<[Status, string[]]>([
    ['draft', ['name', 'hypothesis', 'arms', 'targeting', 'allocation', 'flagPoint', 'metrics', 'analysis', 'exposurePolicy']],
    ['stopped', ['name', 'hypothesis', 'arms', 'targeting', 'allocation', 'metrics', 'analysis', 'exposurePolicy']],
    ['running', ['name', 'hypothesis']], ['decided', ['name', 'hypothesis']], ['archived', []],
  ])('%s stages only allowed fields', (status, keys) => {
    expect(Object.keys(editablePatch(status, partial))).toEqual(keys)
    expect(Object.keys(changedPatch({ ...doc, status }, partial))).toEqual(keys)
  })
  test('undefined and inherited properties never produce a patch', () => {
    expect(editablePatch('draft', Object.assign(Object.create({ name: 'inherited' }), { analysis: undefined }))).toEqual({})
  })
})

test('maps Payload nested validation details to paths', () => {
  expect(payloadFieldErrors({ errors: [{ message: 'Invalid fields', data: { errors: [
    { path: 'analysis.plannedDurationDays', message: 'Enter a positive number.' },
    { path: 'arms.1.weight', message: 'Enter a whole percentage.' },
  ] } }] })).toEqual({
    'analysis.plannedDurationDays': 'Enter a positive number.',
    'arms.1.weight': 'Enter a whole percentage.',
  })
  expect(payloadFieldErrors({ data: { errors: [{ path: 'metrics.primary', message: 'Choose a goal.' }] } })).toEqual({ 'metrics.primary': 'Choose a goal.' })
})

test('keeps section messages and handles missing or malformed envelopes', () => {
  expect(payloadFieldErrors({ errors: [{ message: 'Save refused' }] })).toEqual({ _section: 'Save refused' })
  expect(payloadFieldErrors({ errors: [{ data: { errors: [{ message: 'Fix the versions.' }] } }] }, 'arms')).toEqual({ arms: 'Fix the versions.' })
  for (const envelope of [undefined, null, 'not JSON', { errors: [null] }, { errors: [{ data: { errors: [null, 3] } }] }]) {
    expect(payloadFieldErrors(envelope, 'analysis', 'Try again.')).toEqual({ analysis: 'Try again.' })
  }
})

test.each<[Status, string]>([
  ['running', 'analysis.method'], ['running', 'allocation'], ['running', 'metrics'],
  ['stopped', 'arms.key'], ['decided', 'arms'], ['archived', 'name'], ['draft', 'slug'],
])('maps lock-hook refusal for %s %s to inline user copy', (status, field) => {
  const error = new XpLockedFieldError(field, status)
  expect(payloadFieldErrors({ errors: [{ message: error.message }] })).toEqual({
    [field]: lockedReason(status, field, EDITABLE_BY_STATUS),
  })
})

test('does not reinterpret other refusal messages or unknown statuses', () => {
  for (const message of ['analysis is locked in unknown', 'Other refusal: analysis is locked in running']) {
    expect(payloadFieldErrors({ errors: [{ message }] })).toEqual({ _section: message })
  }
})
