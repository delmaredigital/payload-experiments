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


test.each([
  null, 'country', {}, [1], [''], ['1name'], ['has-dash'], ['has space'], ['a.b'], ['__proto__'],
  ['a'.repeat(41)], Array.from({ length: 9 }, (_, i) => `dim${i}`), ['country', 'country'],
  ...['userId', 'email', 'id', 'unitId', 'visitorId', 'EMAIL', 'UserId'].map(name => [name]),
].map(dimensions => ({ dimensions })))('onInit rejects invalid events.dimensions %j', async ({ dimensions }) => {
  const options = resolveOptions({ ...sampleOptions(), events: { dimensions: dimensions as string[] } })
  const payload = fakePayload()
  Object.assign(payload.db, { packageName: '@payloadcms/db-postgres' })
  await expect(createOnInit(options)(payload)).rejects.toThrow('events.dimensions')
  expect(payload.dbCalls).toEqual([])
})

test.each([undefined, [], ['a'.repeat(40)], ['registrationSource', 'loggedIn', 'staff', 'path', 'device', 'utmSource', 'n2', 'A_']].map(dimensions => ({ dimensions })))('onInit accepts valid dimensions %j', async ({ dimensions }) => {
  const options = resolveOptions({ ...sampleOptions(), events: { dimensions } })
  const payload = fakePayload()
  Object.assign(payload.db, { packageName: '@payloadcms/db-postgres' })
  await expect(createOnInit(options)(payload)).resolves.toBeUndefined()
  expect(payload.db.sessions).toEqual({})
})
