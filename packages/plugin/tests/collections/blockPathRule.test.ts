import { expect, test } from 'vitest'
import { experimentsCollection } from '../../src/collections/experiments/config.js'
import { readTargetingRules } from '../../src/testSurface/targeting/targeting.model.js'
import { fakeReq } from '../_fakes/req.js'
import { field, sampleOptions, validate } from './fixtures.js'

const options = sampleOptions()
options.attributeKeys!.path = { type: 'string' }
const targeting = field(experimentsCollection(options).fields, 'targeting', 'array')
const attribute = field(targeting.fields, 'attribute', 'text')
const message = 'Page block tests run on their page; remove the page-path rule.'
const storedRule = { id: 'path-row', attribute: 'path', op: 'in' as const, value: ['/home', '/about'] }
const country = { id: 'country-row', attribute: 'country', op: 'eq' as const, value: 'US' }

// Payload 3.90.2 beforeChange/promise.js:108-127 passes the submitted array,
// merged document data (including stored kind/status), and the stored array
// as previousValue. Invoke those real field validators without simulating hooks.
test.each(['draft', 'stopped'])('%s block tests refuse new path rules, including unmatched or absent ids', status => {
  for (const id of ['new-row', undefined]) {
    expect(validate(targeting.validate, [{ ...storedRule, id }], {
      data: { kind: 'block', status }, previousValue: [storedRule],
    })).toBe(message)
  }
  for (const previousValue of [undefined, null, []]) {
    expect(validate(targeting.validate, [storedRule], { data: { kind: 'block', status }, previousValue })).toBe(message)
  }
})

test.each(['draft', 'stopped'])('%s block tests refuse changed path rule values, operators and attributes', status => {
  for (const change of [{ value: ['/changed'] }, { op: 'nin' }, { attribute: 'country' }]) {
    expect(validate(targeting.validate, [storedRule], {
      data: { kind: 'block', status }, previousValue: [{ ...storedRule, ...change }],
    })).toBe(message)
  }
})

test.each(['draft', 'stopped'])('%s block tests allow unrelated edits, row reordering and removal', status => {
  const data = { kind: 'block', status, name: 'Renamed' }
  expect(validate(targeting.validate, structuredClone([storedRule]), { data, previousValue: [storedRule] })).toBe(true)
  expect(validate(targeting.validate, [country, storedRule], { data, previousValue: [storedRule, country] })).toBe(true)
  for (const value of [[], null, undefined, [country]]) {
    expect(validate(targeting.validate, value, { data, previousValue: [storedRule] })).toBe(true)
  }
})

test.each(['running', 'decided', 'archived'])('%s block tests are unaffected by the path validator', status => {
  expect(validate(targeting.validate, [storedRule], { data: { kind: 'block', status } })).toBe(true)
})

test.each(['page', 'flag', 'code'])('%s tests permit a new path rule', kind => {
  expect(validate(targeting.validate, [storedRule], { data: { kind, status: 'draft' } })).toBe(true)
})

test.each(['in', 'nin'] as const)('%s legacy lists compare after the same normalization as an unrelated admin edit', op => {
  for (const value of [' /home, /about, , /home ', [' /home ', '/about', '/home', ''], [' /home,/about ', '/home,/about']]) {
    const previousValue = [{ ...storedRule, op, value }, country]
    const submitted = readTargetingRules(previousValue).map(rule => rule.attribute === 'country' ? { ...rule, value: 'CA' } : rule)
    expect(validate(targeting.validate, submitted, { data: { kind: 'block', status: 'draft' }, previousValue })).toBe(true)
    const changed = submitted.map(rule => rule.attribute === 'path' ? { ...rule, value: ['/different'] } : rule)
    expect(validate(targeting.validate, changed, { data: { kind: 'block', status: 'draft' }, previousValue })).toBe(message)
  }
})

test('non-list values compare exactly, without trimming or splitting', () => {
  const previousValue = [{ ...storedRule, op: 'eq', value: ' /home ' }]
  expect(validate(targeting.validate, [{ ...previousValue[0], value: '/home' }], {
    data: { kind: 'block', status: 'draft' }, previousValue,
  })).toBe(message)
})

test('shared bulk request validators use only their own previousValue and leave context untouched', async () => {
  const req = fakeReq({ context: { hostMarker: 'kept' } })
  const data = { kind: 'block', status: 'draft' }
  const results = await Promise.all([
    validate(targeting.validate, [storedRule], { data, previousValue: [storedRule], req }),
    validate(targeting.validate, [storedRule], { data, previousValue: [], req }),
    validate(targeting.validate, [storedRule], { data, previousValue: [storedRule], req }),
  ])
  expect(results).toEqual([true, message, true])
  expect(req.context).toEqual({ hostMarker: 'kept' })
  expect(targeting.hooks?.beforeChange).toBeUndefined()
})

test('child validators still enforce registered attributes, operators and values', () => {
  expect(validate(attribute.validate, 'path')).toBe(true)
  expect(validate(attribute.validate, 'unknown')).toBe('Choose a registered attribute.')
  const operator = field(targeting.fields, 'op', 'select')
  const value = field(targeting.fields, 'value', 'json')
  expect(validate(operator.validate, 'in', { siblingData: storedRule })).toBe(true)
  expect(validate(operator.validate, 'gt', { siblingData: storedRule })).toBe('Choose an operator supported by this attribute.')
  expect(validate(value.validate, storedRule.value, { siblingData: storedRule })).toBe(true)
  expect(validate(value.validate, '/home', { siblingData: storedRule })).toBe('Enter a value of the type required by this attribute and operator.')
})
