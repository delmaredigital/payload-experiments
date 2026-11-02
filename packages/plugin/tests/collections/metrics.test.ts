import { expect, test } from 'vitest'
import { metricsCollection } from '../../src/collections/metrics.js'
import { serializeMetricSources } from '../../src/collections/serialize.js'
import { resolveOptions } from '../../src/options.js'
import { field, invoke, sampleOptions, validate } from './fixtures.js'

const config = metricsCollection(sampleOptions())
const cap = config.hooks?.beforeValidate?.[0]
const capType = field(field(config.fields, 'capping', 'group').fields, 'type', 'select').validate
test.each(['binomial', 'count', 'events:signup'])('capping is refused for %s', source => {
  expect(validate(capType, 'absolute', { data: { source }, siblingData: { value: 10 } })).toBe('Count and yes-or-no goals cannot use a limit.')
  expect(validate(capType, null, { data: { source }, siblingData: { value: 10 } })).toBe('Count and yes-or-no goals cannot use a limit.')
  expect(validate(capType, null, { data: { source }, siblingData: { value: null } })).toBe(true)
  expect(invoke(cap, { data: { source, capping: { type: 'absolute', value: 10 } } })).toEqual({ source, capping: { type: 'absolute', value: 10 } })
  expect(invoke(cap, { data: { source } })).toEqual({ source })
  expect(invoke(cap, { data: { source, capping: { type: null, value: null } } })).toMatchObject({ source })
})
test('revenue defaults and explicit capping', () => {
  expect(invoke(cap, { data: { source: 'revenue' } })).toEqual({ source: 'revenue', capping: { type: 'percentile', value: 0.99 } })
  expect(invoke(cap, { data: { source: 'revenue', capping: null } })).toMatchObject({ capping: { type: 'percentile', value: 0.99 } })
  expect(invoke(cap, { data: { source: 'revenue', capping: { type: 'absolute', value: 20 } } })).toMatchObject({ capping: { type: 'absolute', value: 20 } })
  expect(validate(capType, 'absolute', { data: { source: 'revenue' }, siblingData: { value: 20 } })).toBe(true)
  expect(validate(capType, 'unknown', { data: { source: 'revenue' }, siblingData: { value: 20 } })).not.toBe(true)
})
test('partial updates validate capping against merged source and cap', () => {
  expect(validate(capType, 'absolute', { data: { source: 'count' }, siblingData: { value: 10 } })).toBe('Count and yes-or-no goals cannot use a limit.')
  expect(validate(capType, 'percentile', { data: { source: 'count' }, siblingData: { value: 0.99 } })).toBe('Count and yes-or-no goals cannot use a limit.')
  expect(invoke(cap, { data: { name: 'Renamed' }, originalDoc: { source: 'revenue', capping: { type: 'absolute', value: 20 } } })).toEqual({ name: 'Renamed' })
  expect(invoke(cap, { data: { name: 'Renamed' }, originalDoc: { source: 'revenue' } })).toMatchObject({ capping: { type: 'percentile', value: 0.99 } })
})
test.each(['binomial', 'count', 'revenue', 'events:signup'])('source accepts registered %s', source => expect(validate(field(config.fields, 'source', 'text').validate, source)).toBe(true))
test.each(['unknown', 'events:unknown', 'signup', 'toString', undefined])('source rejects unregistered %s', source => expect(validate(field(config.fields, 'source', 'text').validate, source)).not.toBe(true))

test('both event source forms validate and serialize their write permissions', () => {
  const options = resolveOptions({ ...sampleOptions(), eventSources: ['signup',
    { name: 'donation_completed', clientWritable: false }, { name: 'checkout_2', clientWritable: true }] })
  const config = metricsCollection(options)
  const sources = serializeMetricSources(options).filter(source => source.id.startsWith('events:'))
  expect(sources).toEqual([
    { id: 'events:signup', label: 'signup', kind: 'binomial', keyedBy: 'visitor', clientWritable: true },
    { id: 'events:donation_completed', label: 'donation_completed', kind: 'binomial', keyedBy: 'visitor', clientWritable: false },
    { id: 'events:checkout_2', label: 'checkout_2', kind: 'binomial', keyedBy: 'visitor', clientWritable: true },
  ])
  for (const source of sources) expect(validate(field(config.fields, 'source', 'text').validate, source.id)).toBe(true)
})

test('attribution windows must be at least one hour (a zero window makes every results run throw)', async () => {
  const { buildCollections } = await import('../../src/collections/index.js')
  const { sampleOptions } = await import('./fixtures.js')
  const { collections } = buildCollections(sampleOptions())
  const fieldMin = (fields: unknown[], name: string): unknown => {
    for (const field of fields as Array<Record<string, unknown>>) {
      if (field.name === name) return field.min
      for (const key of ['fields', 'tabs']) if (Array.isArray(field[key])) { const found = fieldMin(field[key] as unknown[], name); if (found !== undefined) return found }
    }
    return undefined
  }
  expect(fieldMin(collections.find(c => c.slug === 'xp-metrics')!.fields, 'attributionWindowHours')).toBe(1)
  expect(fieldMin(collections.find(c => c.slug === 'xp-experiments')!.fields, 'attributionWindowHours')).toBe(1)
})
