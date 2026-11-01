import type { Field } from 'payload'
import type { ResolvedOptions } from '../../src/types/contracts.js'
import { fakePayload } from '../_fakes/payload.js'

export function sampleOptions(): ResolvedOptions {
  return {
    runtime: { proxyRuntime: { secrets: ['test-only'], apiRoute: '/api', cookie: { name: 'xp', maxAgeDays: 180 } }, getPayload: async () => fakePayload(), userIdOf: user => String(user.id), attributesOf: () => ({}) },
    access: { manage: () => true },
    flagPoints: [{ id: 'cta', label: 'CTA', params: { title: { type: 'text', label: 'Title' } }, defaultParams: { title: 'Join' }, placements: async () => [], makeContent: async () => {} }],
    metricSources: ['binomial', 'count', 'revenue'].map(kind => ({ id: kind, label: kind, kind: kind as 'binomial' | 'count' | 'revenue', keyedBy: 'user', query: async () => [], covariate: async () => [] })),
    eventSources: [{ name: 'signup', clientWritable: true }], attributeKeys: { country: { type: 'string', values: ['US', 'CA'] }, age: { type: 'number' } },
  }
}

export function flatten(fields: Field[]): Field[] {
  return fields.flatMap(field => [field, ...('fields' in field ? flatten(field.fields) : []), ...('tabs' in field ? field.tabs.flatMap(tab => flatten(tab.fields)) : [])])
}
export function field<T extends Field['type']>(fields: Field[], name: string, type: T): Extract<Field, { type: T }> {
  const found = flatten(fields).find(field => 'name' in field && field.name === name && field.type === type)
  if (!found) throw new Error(`Missing ${type} field ${name}`)
  return found as Extract<Field, { type: T }>
}
export function invoke(fn: Function | undefined, args: unknown) {
  if (!fn) throw new Error('Missing callback')
  return Reflect.apply(fn, undefined, [args])
}
export function validate(fn: unknown, value: unknown, args: unknown = {}) {
  if (typeof fn !== 'function') throw new Error('Missing validator')
  return Reflect.apply(fn, undefined, [value, args])
}
