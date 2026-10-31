import { expect, test } from 'vitest'
import { metricsCollection } from '../../src/collections/metrics.js'
import { field, invoke, sampleOptions, validate } from './fixtures.js'

const config = metricsCollection(sampleOptions())
const cap = config.hooks?.beforeValidate?.[0]
test.each(['binomial', 'count', 'events:signup'])('capping is refused for %s', source => {
  expect(() => invoke(cap, { data: { source, capping: { type: 'absolute', value: 10 } } })).toThrow('cannot be capped')
  expect(invoke(cap, { data: { source } })).toEqual({ source })
  expect(invoke(cap, { data: { source, capping: { type: null, value: null } } })).toMatchObject({ source })
})
test('revenue defaults and explicit capping', () => {
  expect(invoke(cap, { data: { source: 'revenue' } })).toEqual({ source: 'revenue', capping: { type: 'percentile', value: 0.99 } })
  expect(invoke(cap, { data: { source: 'revenue', capping: null } })).toMatchObject({ capping: { type: 'percentile', value: 0.99 } })
  expect(invoke(cap, { data: { source: 'revenue', capping: { type: 'absolute', value: 20 } } })).toMatchObject({ capping: { type: 'absolute', value: 20 } })
})
test('partial updates consult original source and cap', () => {
  expect(() => invoke(cap, { data: { capping: { type: 'absolute', value: 10 } }, originalDoc: { source: 'count' } })).toThrow('cannot be capped')
  expect(() => invoke(cap, { data: { source: 'count' }, originalDoc: { source: 'revenue', capping: { type: 'percentile', value: 0.99 } } })).toThrow('cannot be capped')
  expect(invoke(cap, { data: { name: 'Renamed' }, originalDoc: { source: 'revenue', capping: { type: 'absolute', value: 20 } } })).toEqual({ name: 'Renamed' })
})
test.each(['binomial', 'count', 'revenue', 'events:signup'])('source accepts registered %s', source => expect(validate(field(config.fields, 'source', 'text').validate, source)).toBe(true))
test.each(['unknown', 'events:unknown', 'signup', 'toString', undefined])('source rejects unregistered %s', source => expect(validate(field(config.fields, 'source', 'text').validate, source)).not.toBe(true))
