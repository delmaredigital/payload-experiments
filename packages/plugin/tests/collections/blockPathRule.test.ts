import { expect, test } from 'vitest'
import { experimentsCollection } from '../../src/collections/experiments/config.js'
import { lockHook } from '../../src/collections/experiments/lockHook.js'
import { fakeReq } from '../_fakes/req.js'
import { field, invoke, sampleOptions, validate } from './fixtures.js'

const options = sampleOptions()
options.attributeKeys!.path = { type: 'string' }
const config = experimentsCollection(options)
const targeting = field(config.fields, 'targeting', 'array')
const attribute = field(targeting.fields, 'attribute', 'text')
const message = 'Page block tests run on their page; remove the page-path rule.'
const storedRule = { id: 'path-row', attribute: 'path', op: 'in', value: ['/home', '/about'] }
const stored = (status = 'draft', kind = 'block') => ({ id: 1, name: 'Before', kind, status, targeting: [structuredClone(storedRule)] })

// Mirror Payload 3.90.2 beforeChange/promise.js: the array field hook receives
// originalDoc, then child validators get merged data and merged siblingData.
async function save(originalDoc: ReturnType<typeof stored> | undefined, data: Record<string, unknown>) {
  const req = fakeReq()
  invoke(targeting.hooks?.beforeChange?.[0], { originalDoc, req })
  const merged = { ...originalDoc, ...data }
  const rules = merged.targeting as Array<typeof storedRule> | undefined
  for (const row of rules ?? []) {
    const result = validate(attribute.validate, row.attribute, { data: merged, siblingData: row, req })
    if (result !== true) return result
  }
  if (originalDoc) await invoke(lockHook, { originalDoc, data, req, operation: 'update' })
  return true
}

test.each(['draft', 'stopped'])('%s block tests refuse new path rules, including unmatched or absent ids', async status => {
  for (const id of ['new-row', undefined]) {
    expect(await save(stored(status), { targeting: [{ ...storedRule, id }] })).toBe(message)
  }
  expect(await save(undefined, { kind: 'block', status, targeting: [storedRule] })).toBe(message)
})

test.each(['draft', 'stopped'])('%s block tests refuse changed path rule values and operators', async status => {
  for (const change of [{ value: ['/changed'] }, { op: 'nin' }, { attribute: 'path' }]) {
    const original = stored(status)
    if ('attribute' in change) original.targeting[0]!.attribute = 'country'
    // The field validator also handles data omitting status (stored fallback).
    expect(await save(original, { targeting: [{ ...storedRule, ...change }] })).toBe(message)
  }
})

test.each(['draft', 'stopped'])('%s block tests allow unchanged path rows on rename, reorder and removal', async status => {
  const original = stored(status)
  expect(await save(original, { name: 'After', targeting: structuredClone(original.targeting) })).toBe(true)
  const country = { id: 'country-row', attribute: 'country', op: 'eq', value: 'US' }
  expect(await save(original, { name: 'After', targeting: [country, structuredClone(storedRule)] })).toBe(true)
  expect(await save(original, { targeting: [] })).toBe(true)
})

test.each(['running', 'decided', 'archived'])('%s block tests with existing path rules allow unrelated saves', async status => {
  expect(await save(stored(status), { name: status === 'archived' ? 'Before' : 'After', targeting: [structuredClone(storedRule)] })).toBe(true)
})

test.each(['page', 'flag', 'code'])('%s tests permit a new path rule', async kind => {
  expect(await save(stored('draft', kind), { targeting: [storedRule] })).toBe(true)
})

test('block tests permit other attributes and compare array values structurally', async () => {
  expect(await save(stored(), { targeting: [{ ...storedRule, attribute: 'country' }] })).toBe(true)
  expect(await save(stored(), { targeting: [{ ...storedRule, value: [...storedRule.value] }] })).toBe(true)
})

test('validator falls back to the stored status when data omits it', () => {
  const req = fakeReq()
  invoke(targeting.hooks?.beforeChange?.[0], { originalDoc: stored('stopped'), req })
  expect(validate(attribute.validate, 'path', { data: { kind: 'block' }, siblingData: { ...storedRule, value: ['/changed'] }, req })).toBe(message)
  invoke(targeting.hooks?.beforeChange?.[0], { originalDoc: stored('running'), req })
  expect(validate(attribute.validate, 'path', { data: { kind: 'block' }, siblingData: { ...storedRule, value: ['/changed'] }, req })).toBe(true)
})
