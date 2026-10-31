import { expect, test } from 'vitest'
import { assertPostgresAdapter, probeTransactions } from '../../src/db/adapter.js'
import { fakePayload } from '../_fakes/payload.js'

test('requires the Postgres package marker, rather than the adapter name', () => {
  const payload = fakePayload()
  Object.assign(payload.db, { name: 'postgres', packageName: '@payloadcms/db-sqlite' })
  expect(() => assertPostgresAdapter(payload)).toThrow('requires @payloadcms/db-postgres')
  Object.assign(payload.db, { packageName: '@payloadcms/db-postgres' })
  expect(() => assertPostgresAdapter(payload)).not.toThrow()
  expect(payload.dbCalls).toEqual([])
})

test.each([null, undefined])('rejects a nullish transaction id (%j)', async id => {
  const payload = fakePayload()
  // Exercise adapters returning undefined despite Payload's declared contract.
  Object.assign(payload.db, { beginTransaction: async () => id })
  await expect(probeTransactions(payload)).rejects.toThrow('transactions are disabled')
  expect(payload.dbCalls).toEqual([])
})

test.each(['transaction-probe', 42])('rolls back transaction %j immediately', async id => {
  const payload = fakePayload({ transactions: { begin: id } })
  await probeTransactions(payload)
  expect(payload.dbCalls).toEqual([{ method: 'beginTransaction', args: [] }, { method: 'rollbackTransaction', args: [id] }])
  expect(payload.db.sessions).toEqual({})
})
