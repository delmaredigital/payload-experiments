import { expect, test } from 'vitest'
import { sql } from '@payloadcms/db-postgres/drizzle'
import { createFakeExecutor, noSession, withSession } from './_fakes/executor.js'
import { fakePayload } from './_fakes/payload.js'
import { fakeReq } from './_fakes/req.js'

test('executor records ordered statements and parameters, including failed calls', async () => {
  const executor = createFakeExecutor({ results: [{ rows: [{ id: 1 }] }, { rows: [], rowCount: 3 }], throwOn: 2 })
  const params = [42]
  expect(await executor.query<{ id: number }>('first', params)).toEqual({ rows: [{ id: 1 }], rowCount: 1 })
  params.push(99)
  await expect(executor.query('second')).rejects.toThrow('call 2')
  expect(await executor.query('third', ['x'])).toEqual({ rows: [], rowCount: 3 })
  expect(await executor.query('fourth')).toEqual({ rows: [], rowCount: 0 })
  expect(executor.calls).toEqual([
    { text: 'first', params: [42] }, { text: 'second', params: [] },
    { text: 'third', params: ['x'] }, { text: 'fourth', params: [] },
  ])
})

test.each(['fail', /fail/g])('executor can fail on a text match (%s)', async throwOn => {
  const executor = createFakeExecutor({ throwOn })
  await executor.query('ok')
  await expect(executor.query('please fail')).rejects.toThrow()
  await expect(executor.query('please fail again')).rejects.toThrow()
  expect(executor.calls).toHaveLength(3)
})

test('session variants model a present, absent, or missing session with awaited transaction ids', async () => {
  const { executor, req } = withSession()
  const id = await req.transactionID
  expect(id).toBe('fake-transaction')
  expect(req.payload.db.sessions![id!]?.db).toBe(executor)
  const promised = executor.withSession('promised')
  promised.transactionID = Promise.resolve('promised')
  expect(promised.payload.db.sessions![(await promised.transactionID)!]?.db).toBe(executor)
  expect(await noSession().req.transactionID).toBeUndefined()
  const missing = fakeReq({ transactionID: 'missing' })
  expect(missing.payload.db.sessions![(await missing.transactionID)!]).toBeUndefined()
})

test('session execute accepts the parameterised Drizzle SQL used by txExecutor', async () => {
  const { executor, req } = withSession({ results: [{ rows: [{ revision: 4 }], rowCount: 1 }], throwOn: 2 })
  const session = req.payload.db.sessions![(await req.transactionID)!]!
  expect(session.db).toBe(executor)
  const statement = sql`${sql.raw('select ')}${sql.param([1, 2])}${sql.raw(' as values, ')}${sql.param('opaque')}`
  expect(await executor.execute(statement)).toEqual({ rows: [{ revision: 4 }], rowCount: 1 })
  await expect(executor.execute(statement)).rejects.toThrow('call 2')
  expect(executor.calls).toEqual([
    { text: 'select $1 as values, $2', params: [[1, 2], 'opaque'] },
    { text: 'select $1 as values, $2', params: [[1, 2], 'opaque'] },
  ])
})

test('fake request preserves caller context, user, payload and transaction', () => {
  const payload = fakePayload(), context = { xpTransition: true }, user = { id: 1 }
  const req = fakeReq({ payload, context, user, transactionID: 'tx' })
  expect(req).toMatchObject({ payload, context, user, transactionID: 'tx' })
  expect(req.headers).toBeInstanceOf(Headers)
  expect(fakeReq().context).not.toBe(fakeReq().context)
})

test('Payload fake implements CRUD and records each access posture without inventing defaults', async () => {
  const seed = { examples: [{ id: 1, name: 'Original' }] }
  const payload = fakePayload({ collections: seed })
  const req = fakeReq({ payload })
  const findArgs = { collection: 'examples', overrideAccess: false, req } as const
  expect((await payload.find(findArgs)).docs).toEqual(seed.examples)
  expect(await payload.findByID({ ...findArgs, id: 1 })).toEqual(seed.examples[0])
  const created = await payload.create({ collection: 'examples', data: { name: 'New' }, overrideAccess: true })
  expect(created.id).toBe(2)
  await payload.update({ ...findArgs, id: 2, data: { name: 'Changed' } })
  expect(await payload.findByID({ ...findArgs, id: 2 })).toMatchObject({ name: 'Changed' })
  await payload.delete({ ...findArgs, id: 2 })
  await expect(payload.findByID({ ...findArgs, id: 2 })).rejects.toThrow('Missing fake document')
  await payload.find({ collection: 'examples' })
  expect(payload.calls.map(call => [call.method, call.args.overrideAccess])).toEqual([
    ['find', false], ['findByID', false], ['create', true], ['update', false],
    ['findByID', false], ['delete', false], ['findByID', false], ['find', undefined],
  ])
  expect(payload.calls[0]?.args.req).toBe(req)
  expect(seed.examples).toEqual([{ id: 1, name: 'Original' }])
  expect(payload.db.sessions).toEqual({})
})

test('Payload fake supports where, bulk operations, pagination and isolated read results', async () => {
  const payload = fakePayload({ collections: { examples: [{ id: 'a', kind: 'x' }, { id: 'b', kind: 'x' }, { id: 'c', kind: 'y' }] } })
  const page = await payload.find({ collection: 'examples', where: { kind: { equals: 'x' } }, limit: 1, page: 2 })
  expect(page).toMatchObject({ docs: [{ id: 'b', kind: 'x' }], totalDocs: 2, totalPages: 2, hasPrevPage: true, hasNextPage: false })
  page.docs[0]!.kind = 'mutated'
  expect(await payload.findByID({ collection: 'examples', id: 'b' })).toMatchObject({ kind: 'x' })
  const updated = await payload.update({ collection: 'examples', where: { id: { in: ['a', 'b'] } }, data: { kind: 'updated' } })
  expect(updated.docs).toHaveLength(2)
  expect(await payload.delete({ collection: 'examples', where: { kind: { equals: 'updated' } } })).toMatchObject({ docs: [{ id: 'a' }, { id: 'b' }] })
  expect((await payload.find({ collection: 'examples', limit: 0 })).docs).toEqual([{ id: 'c', kind: 'y' }])
})
