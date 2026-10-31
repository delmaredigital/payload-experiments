import { expect, test } from 'vitest'
import { createOnInit } from '../src/onInit.js'
import { resolveOptions } from '../src/options.js'
import { defineExperimentsServerRuntime } from '../src/server/serverRuntime.js'
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

test('staff rejects default attributesOf and does not leak the probe transaction', async () => {
  const options = resolveOptions(sampleOptions())
  options.attributeKeys = { staff: { type: 'boolean' } }
  options.runtime = defineExperimentsServerRuntime(options.runtime.proxyRuntime, { getPayload: options.runtime.getPayload })
  const payload = fakePayload()
  Object.assign(payload.db, { packageName: '@payloadcms/db-postgres' })
  expect(options.runtime.attributesOf(null)).toEqual({ loggedIn: false })
  await expect(createOnInit(options)(payload)).rejects.toThrow('`staff` is declared in attributeKeys, so pass an `attributesOf` that identifies staff to defineExperimentsServerRuntime')
  expect(payload.db.sessions).toEqual({})
})

test('staff starts with host-supplied attributesOf', async () => {
  const options = resolveOptions(sampleOptions())
  options.attributeKeys = { staff: { type: 'boolean' } }
  options.runtime = defineExperimentsServerRuntime(options.runtime.proxyRuntime, { getPayload: options.runtime.getPayload, attributesOf: user => ({ staff: Boolean(user) }) })
  const payload = fakePayload()
  Object.assign(payload.db, { packageName: '@payloadcms/db-postgres' })
  await expect(createOnInit(options)(payload)).resolves.toBeUndefined()
})

test('default attributesOf starts when staff is not declared', async () => {
  const options = resolveOptions(sampleOptions())
  options.runtime = defineExperimentsServerRuntime(options.runtime.proxyRuntime, { getPayload: options.runtime.getPayload })
  const payload = fakePayload()
  Object.assign(payload.db, { packageName: '@payloadcms/db-postgres' })
  await expect(createOnInit(options)(payload)).resolves.toBeUndefined()
})

test('the host attributesOf flag survives resolveOptions, so a configured staff host starts', async () => {
  const base = sampleOptions()
  const runtime = defineExperimentsServerRuntime(base.runtime.proxyRuntime, { getPayload: base.runtime.getPayload, attributesOf: user => ({ staff: Boolean(user) }) })
  const options = resolveOptions({ ...base, runtime, attributeKeys: { ...base.attributeKeys, staff: { type: 'boolean' } } })
  const payload = fakePayload()
  Object.assign(payload.db, { packageName: '@payloadcms/db-postgres' })
  await expect(createOnInit(options)(payload)).resolves.toBeUndefined()
})
