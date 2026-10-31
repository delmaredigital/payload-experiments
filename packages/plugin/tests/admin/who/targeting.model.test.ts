import { expect, test } from 'vitest'
import { TARGETING_OPS, isOpValid } from '../../../src/targeting/ops.js'
import { coerceValue, emptyListHint, humaniseAttribute, opLabel, opsFor, rowPath, valueInput } from '../../../src/admin/targeting/targeting.model.js'
import { experimentsCollection } from '../../../src/collections/experiments/config.js'
import { field, sampleOptions, validate } from '../../collections/fixtures.js'

test('operator lists come directly from the shared table and use user labels', () => {
  for (const type of ['string', 'number', 'boolean'] as const) {
    expect(opsFor(type)).toBe(TARGETING_OPS[type])
    for (const op of opsFor(type)) expect(isOpValid(type, op)).toBe(true)
  }
  expect(opsFor('string').map(op => opLabel('string', op))).toEqual(['is', 'is not', 'is one of', 'is not one of', 'contains'])
  expect(opsFor('number').map(op => opLabel('number', op))).toEqual(['=', '≠', '>', '≥', '<', '≤'])
  expect(opLabel('boolean', 'eq')).toBe('is')
  expect(opsFor()).toEqual([])
})
test('input kinds follow the attribute type, value list and operator', () => {
  expect(valueInput({ type: 'string' })).toEqual({ kind: 'text' })
  expect(valueInput({ type: 'string' }, 'in')).toEqual({ kind: 'text' })
  expect(valueInput({ type: 'string' }, 'nin')).toEqual({ kind: 'text' })
  expect(valueInput({ type: 'number' })).toEqual({ kind: 'number' })
  expect(valueInput({ type: 'boolean' })).toEqual({ kind: 'boolean' })
  for (const op of ['in', 'nin', 'eq'] as const) expect(valueInput({ type: 'string', values: ['Mobile', 'Desktop'] }, op))
    .toEqual({ kind: op === 'eq' ? 'select' : 'multiselect', options: [{ label: 'Mobile', value: 'Mobile' }, { label: 'Desktop', value: 'Desktop' }] })
  expect(valueInput({ type: 'number', values: ['1'] }).kind).toBe('select')
  expect(valueInput({ type: 'string', values: [] }).kind).toBe('select')
})
test('coercion produces the exact JSON types accepted by server validation for every operator', () => {
  const options = sampleOptions()
  options.attributeKeys = { string: { type: 'string' }, number: { type: 'number' }, boolean: { type: 'boolean' } }
  const config = experimentsCollection(options)
  const validator = field(field(config.fields, 'targeting', 'array').fields, 'value', 'json').validate
  for (const type of ['string', 'number', 'boolean'] as const) for (const op of opsFor(type)) {
    expect(isOpValid(type, op)).toBe(true)
    const raw = type === 'string' ? 'Alpha, Beta' : type === 'number' ? '12.5' : 'false'
    const value = coerceValue(type, op, raw)
    if (op === 'in' || op === 'nin') expect(value).toEqual(['Alpha', 'Beta'])
    else expect(typeof value).toBe(type)
    expect(JSON.parse(JSON.stringify(value))).toEqual(value)
    expect(validate(validator, value, { siblingData: { attribute: type, op } })).toBe(true)
    const additionalRaw = type === 'string' ? ['', [], [' A ', 'B']] : type === 'number' ? ['0', -2] : [true, false, 'true']
    for (const raw of additionalRaw) expect(validate(validator, coerceValue(type, op, raw), { siblingData: { attribute: type, op } })).toBe(true)
  }
  expect(coerceValue('string', 'nin', [' A ', 'B'])).toEqual(['A', 'B'])
  expect(coerceValue('number', 'gt', '0')).toBe(0)
  expect(coerceValue('boolean', 'eq', false)).toBe(false)
  expect(coerceValue('boolean', 'eq', 'true')).toBe(true)
  for (const raw of ['', ' ', 'NaN', 'Infinity', null]) expect(coerceValue('number', 'eq', raw)).toBeNull()
  expect(coerceValue('boolean', 'eq', '')).toBeNull()
})
test.each(['in', 'nin'] as const)('%s warns about empty lists while preserving their JSON', op => {
  for (const raw of ['', ' , ', [], undefined]) {
    expect(coerceValue('string', op, raw)).toEqual([])
    expect(emptyListHint(op, raw)).toBe('Add at least one value — an empty list matches nobody.')
  }
  expect(emptyListHint(op, ['Email'])).toBeUndefined()
  expect(emptyListHint(op, 'Email')).toBeUndefined()
  expect(emptyListHint('eq', '')).toBeUndefined()
})
test('row paths and human labels preserve stored attribute keys', () => {
  expect(rowPath('targeting.12.value')).toBe('targeting.12')
  expect(humaniseAttribute('utmSource')).toBe('Utm Source')
  expect(humaniseAttribute('signed_in')).toBe('Signed in')
})
