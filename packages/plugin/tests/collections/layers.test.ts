import { expect, test } from 'vitest'
import { layersCollection } from '../../src/collections/layers.js'
import { fakePayload } from '../_fakes/payload.js'
import { fakeReq } from '../_fakes/req.js'
import { field, invoke, sampleOptions, validate } from './fixtures.js'

const config = layersCollection(sampleOptions())
test.each(['slug', 'unitType'] as const)('%s is immutable after create', name => {
  const validator = field(config.fields, name, name === 'slug' ? 'text' : 'select').validate
  const previousValue = name === 'slug' ? 'layer' : 'visitor'
  const nextValue = name === 'slug' ? 'changed' : 'user'
  expect(validate(validator, nextValue, { operation: 'update', previousValue })).toBe(name === 'slug' ? "The short name can't change after the group is created." : "Who it counts can't change after the group is created.")
  expect(validate(validator, previousValue, { operation: 'update', previousValue })).toBe(true)
  expect(validate(validator, nextValue, { operation: 'create' })).toBe(true)
  expect(validate(validator, undefined, { operation: 'update', previousValue })).toBe(true)
})
test('field validators retain required and enum checks', () => {
  const slug = field(config.fields, 'slug', 'text').validate
  const unit = field(config.fields, 'unitType', 'select').validate
  expect(validate(slug, '', { operation: 'create' })).not.toBe(true)
  expect(validate(unit, 'unknown', { operation: 'create' })).not.toBe(true)
  expect(validate(unit, null, { operation: 'update', previousValue: 'visitor' })).not.toBe(true)
  expect(config.hooks?.beforeChange).toBeUndefined()
})
test('delete refuses references and carries access posture and req', async () => {
  const payload = fakePayload({ collections: { 'xp-experiments': [{ id: 1, layer: 'layer-1', status: 'archived' }] } })
  const req = fakeReq({ payload })
  await expect(invoke(config.hooks?.beforeDelete?.[0], { id: 'layer-1', req })).rejects.toMatchObject({ code: 'invalid-status', status: 409 })
  expect(payload.calls).toEqual([{ method: 'find', args: { collection: 'xp-experiments', where: { layer: { equals: 'layer-1' } }, limit: 1, overrideAccess: true, req } }])
})
test('delete allows an unreferenced layer', async () => {
  await expect(invoke(config.hooks?.beforeDelete?.[0], { id: 2, req: fakeReq() })).resolves.toBeUndefined()
})
test.each([new Error('Database connection lost'), { name: 'Forbidden' }, { status: 403 }])('delete propagates a failed reference read: %j', async error => {
  const req = fakeReq({ payload: fakePayload({ overrides: { find: async () => { throw error } } }) })
  await expect(invoke(config.hooks?.beforeDelete?.[0], { id: 2, req })).rejects.toBe(error)
})
