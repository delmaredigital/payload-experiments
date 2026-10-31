import { expect, test } from 'vitest'
import { createOnInit } from '../src/onInit.js'
import { resolveOptions } from '../src/options.js'
import { fakePayload } from './_fakes/payload.js'
import { sampleOptions } from './collections/fixtures.js'

test('rejects non-Postgres before opening a transaction', async () => {
  const payload = fakePayload()
  Object.assign(payload.db, { packageName: '@payloadcms/db-sqlite' })
  await expect(createOnInit(resolveOptions(sampleOptions()))(payload)).rejects.toThrow('@payloadcms/db-postgres')
  expect(payload.dbCalls).toEqual([])
})

test('rejects disabled transactions', async () => {
  const payload = fakePayload({ transactions: { begin: null } })
  Object.assign(payload.db, { packageName: '@payloadcms/db-postgres' })
  await expect(createOnInit(resolveOptions(sampleOptions()))(payload)).rejects.toThrow('transactions are disabled')
  expect(payload.dbCalls).toEqual([{ method: 'beginTransaction', args: [] }])
})

test.each(['probe-id', 42])('immediately rolls back transaction %j', async id => {
  const payload = fakePayload({ transactions: { begin: id } })
  Object.assign(payload.db, { packageName: '@payloadcms/db-postgres' })
  await createOnInit(resolveOptions(sampleOptions()))(payload)
  expect(payload.dbCalls).toEqual([{ method: 'beginTransaction', args: [] }, { method: 'rollbackTransaction', args: [id] }])
  expect(payload.db.sessions).toEqual({})
})

test('staff requires attributesOf and does not leak the probe transaction', async () => {
  const options = resolveOptions(sampleOptions())
  options.attributeKeys = { staff: { type: 'boolean' } }
  // Model a JavaScript host bypassing the resolved runtime's TypeScript contract.
  Reflect.deleteProperty(options.runtime, 'attributesOf')
  const payload = fakePayload()
  Object.assign(payload.db, { packageName: '@payloadcms/db-postgres' })
  await expect(createOnInit(options)(payload)).rejects.toThrow('staff attribute requires runtime.attributesOf')
  expect(payload.db.sessions).toEqual({})
  options.runtime.attributesOf = () => ({ staff: false })
  await expect(createOnInit(options)(payload)).resolves.toBeUndefined()
})

test('attributesOf may be absent when staff is not declared', async () => {
  const options = resolveOptions(sampleOptions())
  Reflect.deleteProperty(options.runtime, 'attributesOf')
  const payload = fakePayload()
  Object.assign(payload.db, { packageName: '@payloadcms/db-postgres' })
  await expect(createOnInit(options)(payload)).resolves.toBeUndefined()
})
