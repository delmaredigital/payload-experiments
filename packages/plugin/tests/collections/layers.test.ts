import { expect, test } from 'vitest'
import { layersCollection } from '../../src/collections/layers.js'
import { fakePayload } from '../_fakes/payload.js'
import { fakeReq } from '../_fakes/req.js'
import { invoke, sampleOptions } from './fixtures.js'

const config = layersCollection(sampleOptions())
test.each(['slug', 'unitType'])('%s is immutable after create', field => {
  expect(() => invoke(config.hooks?.beforeChange?.[0], { operation: 'update', data: { [field]: 'changed' }, originalDoc: { slug: 'layer', unitType: 'visitor' } })).toThrow('set when the layer is created')
})
test('create, unchanged posts and omitted fields are allowed', () => {
  const data = { slug: 'layer', unitType: 'visitor' }
  expect(invoke(config.hooks?.beforeChange?.[0], { operation: 'create', data })).toBe(data)
  expect(invoke(config.hooks?.beforeChange?.[0], { operation: 'update', data, originalDoc: data })).toBe(data)
  expect(invoke(config.hooks?.beforeChange?.[0], { operation: 'update', data: { name: 'New' }, originalDoc: data })).toEqual({ name: 'New' })
})
test('delete refuses references and carries access posture and req', async () => {
  const payload = fakePayload({ collections: { 'xp-experiments': [{ id: 1, layer: 'layer-1', status: 'archived' }] } })
  const req = fakeReq({ payload })
  await expect(invoke(config.hooks?.beforeDelete?.[0], { id: 'layer-1', req })).rejects.toMatchObject({ code: 'invalid-status', status: 409 })
  expect(payload.calls).toEqual([{ method: 'find', args: { collection: 'xp-experiments', where: { layer: { equals: 'layer-1' } }, limit: 1, overrideAccess: false, req } }])
})
test('delete allows an unreferenced layer', async () => {
  await expect(invoke(config.hooks?.beforeDelete?.[0], { id: 2, req: fakeReq() })).resolves.toBeUndefined()
})
