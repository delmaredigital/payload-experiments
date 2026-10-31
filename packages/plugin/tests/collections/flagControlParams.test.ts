import { expect, test, vi } from 'vitest'
import type { CollectionBeforeChangeHook } from 'payload'
import { flagControlParams } from '../../src/collections/experiments/flagControlParams.js'
import { fakeReq } from '../_fakes/req.js'
import { fakePayload } from '../_fakes/payload.js'

const setup = (state: unknown = {}, failure?: unknown) => {
  const findGlobal = vi.fn(async () => { if (failure !== undefined) throw failure; return state })
  const req = fakeReq({ payload: fakePayload({ config: { custom: { xp: { flagPoints: [
    { id: 'card', defaultParams: { text: 'Default' } }, { id: 'other', defaultParams: { text: 'Other' } },
  ] } } }, overrides: { findGlobal } }) })
  return { req, findGlobal }
}
const original = (status = 'draft') => ({ kind: 'flag', status, flagPoint: 'card', arms: [
  { key: 'control', kind: 'control', weight: 50, params: { text: 'Tampered' } },
  { key: 'variantA', kind: 'variant', weight: 50, params: { text: 'Variant' } },
] })
const run = (data: Record<string, unknown>, originalDoc = original(), req = setup().req, operation: 'create' | 'update' = 'update') =>
  flagControlParams({ data, originalDoc, req, operation } as Parameters<CollectionBeforeChangeHook>[0])

test.each(['draft', 'stopped'])('effective flag defaults overwrite control on every save in %s', async status => {
  const { req, findGlobal } = setup({ flagDefaults: { card: { params: { text: 'Shipped' } } } })
  const doc = original(status)
  const result = await run({}, doc, req)
  expect(result.arms[0].params).toEqual({ text: 'Shipped' })
  expect(result.arms[1]).toBe(doc.arms[1])
  expect(doc.arms[0]!.params).toEqual({ text: 'Tampered' })
  expect(findGlobal).toHaveBeenCalledExactlyOnceWith({ slug: 'xp-state', req, overrideAccess: false })
})
test.each([{}, { flagDefaults: {} }, { flagDefaults: { card: { params: {} } } }])('point defaults unless effective params exist: %j', async state => {
  const result = await run({}, original(), setup(state).req)
  expect(result.arms[0].params).toEqual('flagDefaults' in state && state.flagDefaults && 'card' in state.flagDefaults ? {} : { text: 'Default' })
})
test.each([{ name: 'Forbidden' }, { status: 403 }])('refused read falls back to registered defaults: %j', async failure => {
  const result = await run({}, original(), setup({}, failure).req)
  expect(result.arms[0].params).toEqual({ text: 'Default' })
})
test('database errors propagate without replacing control params', async () => {
  const error = new Error('Database connection lost')
  await expect(run({}, original(), setup({}, error).req)).rejects.toBe(error)
})
test.each(['running', 'decided', 'archived'])('%s is unchanged without a state read', async status => {
  const { req, findGlobal } = setup()
  const data = { arms: original().arms }
  await expect(run(data, original(status), req)).resolves.toBe(data)
  expect(findGlobal).not.toHaveBeenCalled()
})
test.each(['block', 'page', 'code'])('%s is unchanged without options or a state read', async kind => {
  const data = { kind }
  await expect(run(data, original(), fakeReq())).resolves.toBe(data)
})
test('create and a changed draft point use submitted values', async () => {
  const { req } = setup()
  const data = { ...original(), flagPoint: 'other' }
  expect((await run(data, original(), req, 'create')).arms[0].params).toEqual({ text: 'Other' })
  expect((await run({ flagPoint: 'other' }, original(), req)).arms[0].params).toEqual({ text: 'Other' })
})
test('submitted arm params cannot override effective control', async () => {
  const data = { arms: original().arms }
  const result = await run(data)
  expect(result.arms[0].params).toEqual({ text: 'Default' })
  expect(result.arms[1].params).toEqual({ text: 'Variant' })
})
test('unknown point and absent arms pass through', async () => {
  const data = { flagPoint: 'unknown' }
  await expect(run(data)).resolves.toBe(data)
  const doc = { ...original(), arms: undefined }
  await expect(run({}, doc as unknown as ReturnType<typeof original>)).resolves.toEqual({})
})
