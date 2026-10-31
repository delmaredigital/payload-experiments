import { expect, test, vi } from 'vitest'
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

test.each(['23505', '40P01', '57014'])('executor preserves injected pg error %s', async code => {
  const error = Object.assign(new Error('pg failure'), { code })
  const executor = createFakeExecutor({ throwOn: { at: 2, match: /fail/g, error } })
  await executor.query('ok')
  await expect(executor.query('fail')).rejects.toBe(error)
  expect(executor.calls.map(call => call.text)).toEqual(['ok', 'fail'])
  const matching = createFakeExecutor({ throwOn: { match: 'fail', error } })
  await expect(matching.query('fail')).rejects.toMatchObject({ code })
  const functional = createFakeExecutor({ throwOn: (_call, n) => n === 2 ? error : undefined })
  await functional.query('first')
  await expect(functional.query('second')).rejects.toBe(error)
})

test('Payload fake routes pool and transaction SQL through the supplied executor', async () => {
  const executor = createFakeExecutor({ results: [{ rows: [{ value: 1 }] }, { rows: [{ value: 2 }] }] })
  const payload = fakePayload({ executor })
  const statement = sql`select ${sql.param('opaque')} as value`
  expect(await payload.db.drizzle.execute(statement)).toMatchObject({ rows: [{ value: 1 }] })
  const id = await payload.db.beginTransaction()
  expect(payload.db.sessions[id!]?.db).toBe(executor)
  expect(await executor.execute(statement)).toMatchObject({ rows: [{ value: 2 }] })
  await payload.db.commitTransaction(Promise.resolve(id!))
  expect(payload.db.sessions[id!]).toBeUndefined()
  const second = await payload.db.beginTransaction({ isolationLevel: 'serializable' })
  expect(second).not.toBe(id)
  await payload.db.rollbackTransaction(second!)
  expect(payload.db.sessions).toEqual({})
  expect(payload.dbCalls).toEqual([
    { method: 'beginTransaction', args: [] }, { method: 'commitTransaction', args: [id] },
    { method: 'beginTransaction', args: [{ isolationLevel: 'serializable' }] }, { method: 'rollbackTransaction', args: [second] },
  ])
  expect(executor.calls).toEqual([
    { text: 'select $1 as value', params: ['opaque'] }, { text: 'select $1 as value', params: ['opaque'] },
  ])
})

test('Payload fake configures transaction ids, disabled transactions, and transaction failures', async () => {
  const explicit = fakePayload({ transactions: { begin: 42 } })
  expect(await explicit.db.beginTransaction()).toBe(42)
  expect(explicit.db.sessions[42]).toBeDefined()
  await explicit.db.sessions[42]!.reject()
  expect(explicit.db.sessions).toEqual({})
  const disabled = fakePayload({ transactions: { begin: null } })
  expect(await disabled.db.beginTransaction()).toBeNull()
  expect(disabled.db.sessions).toEqual({})
  const error = new Error('transaction failure')
  const begin = fakePayload({ transactions: { begin: error } })
  await expect(begin.db.beginTransaction()).rejects.toBe(error)
  expect(begin.dbCalls).toEqual([{ method: 'beginTransaction', args: [] }])
  for (const operation of ['commit', 'rollback'] as const) {
    const payload = fakePayload({ transactions: { [operation]: error } })
    const id = await payload.db.beginTransaction()
    const method = operation === 'commit' ? 'commitTransaction' : 'rollbackTransaction'
    await expect(payload.db[method](id!)).rejects.toBe(error)
    expect(payload.dbCalls.at(-1)).toEqual({ method, args: [id] })
    expect(payload.db.sessions[id!]).toBeDefined()
  }
  const commit = vi.fn(), rollback = vi.fn()
  const callbacks = fakePayload({ transactions: { begin: async () => 'custom', commit, rollback } })
  await callbacks.db.beginTransaction()
  await callbacks.db.commitTransaction('custom')
  await callbacks.db.beginTransaction()
  await callbacks.db.rollbackTransaction('custom')
  expect(commit).toHaveBeenCalledWith('custom')
  expect(rollback).toHaveBeenCalledWith('custom')
})

test('Payload fake records logger calls, config custom, and merges overrides last', () => {
  const custom = { experiments: { enabled: true } }
  const payload = fakePayload({ config: { custom, routes: { api: '/custom-api' } } })
  const error = new Error('failed')
  payload.logger.info('ready')
  payload.logger.warn({ experiment: 1 }, 'warning')
  payload.logger.error(error, 'failed')
  payload.logger.debug('details')
  expect(payload.logs).toEqual([
    { level: 'info', args: ['ready'] }, { level: 'warn', args: [{ experiment: 1 }, 'warning'] },
    { level: 'error', args: [error, 'failed'] }, { level: 'debug', args: ['details'] },
  ])
  expect(payload.config.custom).toBe(custom)
  expect(payload.config.routes).toEqual({ api: '/custom-api' })
  expect(fakePayload().config.custom).toEqual({})
  const find = vi.fn(), logger = { error: vi.fn() }
  const overridden = fakePayload({ overrides: { find, logger, config: { custom: { overridden: true } } } })
  expect(overridden.find).toBe(find)
  expect(overridden.logger).toBe(logger)
  expect(overridden.config.custom).toEqual({ overridden: true })
})

test('session variants accept a seeded Payload fake', async () => {
  const payload = fakePayload({ collections: { examples: [{ id: 1, name: 'seeded' }] } })
  const { executor, req } = withSession({ payload, transactionID: 'seeded-tx' })
  expect(req.payload).toBe(payload)
  expect(payload.db.sessions['seeded-tx']?.db).toBe(executor)
  expect(await req.payload.findByID({ collection: 'examples', id: 1 })).toMatchObject({ name: 'seeded' })
  const other = createFakeExecutor()
  expect(other.withSession({ payload, transactionID: 2 }).payload).toBe(payload)
  expect(payload.db.sessions[2]?.db).toBe(other)
})

test('fake request supports endpoint headers, params, method, URL and JSON body consumption', async () => {
  const transactionID = Promise.resolve('promised-tx')
  const req = fakeReq({
    headers: { cookie: 'xp_id=signed', 'content-type': 'text/plain' }, routeParams: { id: 'experiment-1' },
    searchParams: '?phase=2&series=1', method: 'POST', url: 'https://example.test/api/xp/events',
    body: '{"events":[]}', transactionID,
  })
  expect(req.headers).toBeInstanceOf(Headers)
  expect(req.headers.get('cookie')).toBe('xp_id=signed')
  expect(req.routeParams).toEqual({ id: 'experiment-1' })
  expect(req.searchParams?.get('phase')).toBe('2')
  expect(req).toMatchObject({ method: 'POST', url: 'https://example.test/api/xp/events' })
  expect(req.transactionID).toBe(transactionID)
  expect(req.body).toBeInstanceOf(ReadableStream)
  expect(req.bodyUsed).toBe(false)
  expect(await req.json()).toEqual({ events: [] })
  expect(req.bodyUsed).toBe(true)
  await expect(req.text()).rejects.toThrow()
})

test('fake request supports text and byte-stream bodies plus supplied Headers and searchParams', async () => {
  const headers = new Headers({ 'x-xp-manifest-key': 'key' }), searchParams = new URLSearchParams({ arm: 'variantA' })
  const req = fakeReq({ headers, searchParams, body: 'plain text' })
  expect(req.headers.get('x-xp-manifest-key')).toBe('key')
  expect(req.searchParams?.get('arm')).toBe('variantA')
  expect(await req.text()).toBe('plain text')
  const bytes = new TextEncoder().encode('{"events":[]}')
  const streamed = fakeReq({ body: bytes, url: 'https://example.test/api?arm=control' })
  bytes.fill(0)
  expect(streamed.searchParams?.get('arm')).toBe('control')
  const reader = streamed.body!.getReader()
  expect(new TextDecoder().decode((await reader.read()).value)).toBe('{"events":[]}')
  expect((await reader.read()).done).toBe(true)
  expect(fakeReq().body).toBeNull()
})
