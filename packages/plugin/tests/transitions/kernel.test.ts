import * as payloadHelpers from 'payload'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { withTransition, type TransitionScope } from '../../src/transitions/kernel.js'
import { setPhaseEndedAt, writePhaseRecord, type PhaseRecord } from '../../src/transitions/phaseRecord.js'
import { XpNoTransactionError } from '../../src/errors.js'
import { createFakeExecutor, type FakeExecutorOptions } from '../_fakes/executor.js'
import { fakePayload, type FakeTransactionOptions } from '../_fakes/payload.js'
import { fakeReq } from '../_fakes/req.js'
import { sampleOptions } from '../collections/fixtures.js'

vi.mock('payload', async importOriginal => {
  const actual = await importOriginal<typeof import('payload')>()
  return { ...actual, initTransaction: vi.fn(actual.initTransaction), commitTransaction: vi.fn(actual.commitTransaction), killTransaction: vi.fn(actual.killTransaction) }
})
beforeEach(() => vi.clearAllMocks())

function fixture(scope: TransitionScope, options: {
  borrowed?: boolean; status?: 'committed' | 'aborted' | 'in progress' | null; transactions?: FakeTransactionOptions
  throwOn?: FakeExecutorOptions['throwOn']
} = {}) {
  const lockCount = 1 + Number(scope.layerId != null) + Number(Boolean(scope.flagPointId))
  const executor = createFakeExecutor({
    throwOn: options.throwOn,
    results: [
      ...Array.from({ length: lockCount }, () => ({ rows: [] })),
      ...(scope.bump === false ? [] : [
        { rows: [] }, { rows: [{ revision: 7 }] }, { rows: [] },
      ]),
      ...(options.borrowed ? [] : [
        { rows: [{ xid: '9007199254740993' }] },
        { rows: [{ status: options.status === undefined ? 'committed' : options.status }] },
      ]),
    ],
  })
  // The manifest compile reads plugin options from config.custom.xp (CORE-05b).
  const payload = fakePayload({ executor, transactions: options.transactions, config: { custom: { xp: sampleOptions() } }, overrides: { findGlobal: vi.fn(async () => ({ flagDefaults: {} })) } })
  const req = options.borrowed ? executor.withSession({ payload }) : fakeReq({ payload })
  return { executor, payload, req }
}

describe('ordered transition kernel', () => {
  const operations = [
    ['start', true, true, true], ['allocate', true, false, true],
    ['add-metric', false, false, true], ['stop', true, false, true],
    ['decide', true, true, true], ['release-holdout', true, false, true],
    ['make-content', true, true, true], ['archive', true, false, true],
    ['delete', false, false, true], ['contentChanges', false, false, false],
  ] as const
  test.each(operations)('%s takes only applicable locks with state last', async (_name, layer, point, bump) => {
    const scope = { experimentId: 12, layerId: layer ? 3 : null, flagPointId: point ? 'banner' : null, bump }
    const { executor, payload, req } = fixture(scope)
    expect(await withTransition(req, scope, async ({ exec, req: innerReq }) => {
      expect(innerReq).toBe(req)
      expect(exec).toHaveProperty('query')
      return 'done'
    })).toEqual(bump ? { result: 'done', revision: 7 } : { result: 'done' })
    const locks = executor.calls.filter(call => call.text.includes('pg_advisory_xact_lock'))
    const expected = [
      ...(layer ? [{ namespace: 'xp:layer', params: ['3'] }] : []),
      ...(point ? [{ namespace: 'xp:flagpoint', params: ['banner'] }] : []),
      { namespace: 'xp:experiment', params: ['12'] },
      ...(bump ? [{ namespace: 'xp:state', params: [] }] : []),
    ]
    expect(locks).toHaveLength(expected.length)
    expected.forEach(({ namespace, params }, i) => {
      expect(locks[i]!.text).toContain(`hashtext('${namespace}')`)
      expect(locks[i]!.params).toEqual(params)
    })
    if (!bump) {
      expect(payload.calls).toEqual([])
      expect(payload.findGlobal).not.toHaveBeenCalled()
      expect(executor.calls).toHaveLength(3) // experiment lock, xid capture, pooled status
    }
  })

  test.each([
    { experimentId: 'uuid-e' },
    { experimentId: 'uuid-e', flagPointId: 'point' },
    { experimentId: 'uuid-e', layerId: 'uuid-l' },
    { experimentId: 0, layerId: 0, flagPointId: '' },
  ])('handles optional scope and text ids (%j)', async scope => {
    const { req, executor } = fixture(scope)
    await withTransition(req, scope, async () => null)
    const locks = executor.calls.filter(call => call.text.includes('pg_advisory_xact_lock'))
    expect(locks.map(call => call.params)).toEqual([
      ...(scope.layerId != null ? [[String(scope.layerId)]] : []),
      ...(scope.flagPointId ? [[scope.flagPointId]] : []), [String(scope.experimentId)], [],
    ])
  })

  test.each([undefined, false, true, 'previous'])('restores the previous xpTransition value (%s)', async previous => {
    const scope = { experimentId: 1 }
    const { req } = fixture(scope)
    if (previous !== undefined) req.context.xpTransition = previous
    await withTransition(req, scope, async () => { expect(req.context.xpTransition).toBe(true) })
    expect(req.context.xpTransition).toBe(previous)
    expect(Object.hasOwn(req.context, 'xpTransition')).toBe(previous !== undefined)
  })

  test.each([
    { borrowed: false, bump: true }, { borrowed: false, bump: false },
    { borrowed: true, bump: true }, { borrowed: true, bump: false },
  ])('commits and verifies txid only when owner (%j)', async ({ borrowed, bump }) => {
    const scope = { experimentId: 1, bump }
    const { payload, req, executor } = fixture(scope, { borrowed })
    const session = req.transactionID
    const pooledExecute = vi.spyOn(payload.db.drizzle, 'execute')
    const originalCommit = payload.db.commitTransaction
    vi.spyOn(payload.db, 'commitTransaction').mockImplementation(async id => {
      expect(executor.calls.at(-1)?.text).toContain('txid_current()')
      expect(req.transactionID).toBeDefined()
      expect(pooledExecute).not.toHaveBeenCalled()
      await originalCommit(id)
    })
    await withTransition(req, scope, async () => 5)
    expect(payloadHelpers.commitTransaction).toHaveBeenCalledTimes(borrowed ? 0 : 1)
    const captures = executor.calls.filter(call => call.text.includes('txid_current()'))
    const checks = executor.calls.filter(call => call.text.includes('txid_status('))
    expect(captures).toHaveLength(borrowed ? 0 : 1)
    expect(checks).toHaveLength(borrowed ? 0 : 1)
    if (!borrowed) expect(checks[0]!.params).toEqual(['9007199254740993'])
    expect(pooledExecute).toHaveBeenCalledTimes(borrowed ? 0 : 1)
    expect(executor.calls.some(call => call.text.includes('LIMIT 1'))).toBe(false)
    expect(req.transactionID).toBe(borrowed ? session : undefined)
    expect(payloadHelpers.killTransaction).not.toHaveBeenCalled()
    expect(payload.dbCalls.map(call => call.method)).toEqual(borrowed ? [] : ['beginTransaction', 'commitTransaction'])
  })

  test('joins a promised existing transaction without committing', async () => {
    const scope = { experimentId: 1 }
    const { req } = fixture(scope, { borrowed: true })
    req.transactionID = Promise.resolve(req.transactionID!)
    await withTransition(req, scope, async () => null)
    expect(payloadHelpers.commitTransaction).not.toHaveBeenCalled()
  })

  test('passes exclusions to the real manifest builder', async () => {
    const scope = { experimentId: 1, excludeIds: [2] }
    const { payload, req } = fixture(scope)
    payload.documents['xp-experiments'] = [{ id: 2, status: 'running' }]
    await expect(withTransition(req, scope, async () => null)).resolves.toMatchObject({ revision: 7 })
    expect(payload.calls.map(call => call.args.collection)).toEqual(['xp-experiments'])
  })

  test.each([
    { status: 'aborted', bump: true }, { status: 'in progress', bump: true }, { status: null, bump: true },
    { status: 'aborted', bump: false }, { status: 'in progress', bump: false }, { status: null, bump: false },
  ] as const)('refuses an owned commit unless its txid is committed (%j)', async ({ status, bump }) => {
    const scope = { experimentId: 1, bump }
    const { req } = fixture(scope, { status })
    await expect(withTransition(req, scope, async () => null)).rejects.toMatchObject({ code: 'commit-unverified', status: 500 })
    expect(payloadHelpers.commitTransaction).toHaveBeenCalledOnce()
    expect(payloadHelpers.killTransaction).toHaveBeenCalledWith(req)
    expect(req.context).not.toHaveProperty('xpTransition')
  })

  test.each([false, true])('callback failure kills owned and borrowed transactions (borrowed=%s)', async borrowed => {
    const error = new Error('callback failed')
    const scope = { experimentId: 1 }
    const { req, payload } = fixture(scope, { borrowed })
    req.context.xpTransition = false
    await expect(withTransition(req, scope, async () => { throw error })).rejects.toBe(error)
    expect(payloadHelpers.killTransaction).toHaveBeenCalledWith(req)
    expect(payloadHelpers.commitTransaction).not.toHaveBeenCalled()
    expect(payload.dbCalls.at(-1)?.method).toBe('rollbackTransaction')
    expect(req.transactionID).toBeUndefined()
    expect(req.context.xpTransition).toBe(false)
  })

  test.each([1, 2, 3, 4, 5, 6])('SQL failure at query %s kills and preserves the error', async at => {
    const error = new Error(`query ${at} failed`)
    const scope = { experimentId: 1, layerId: 2 }
    const { req } = fixture(scope, { throwOn: { at, error } })
    await expect(withTransition(req, scope, async () => null)).rejects.toBe(error)
    expect(payloadHelpers.killTransaction).toHaveBeenCalledWith(req)
    expect(payloadHelpers.commitTransaction).not.toHaveBeenCalled()
  })

  test('post-commit pool failure still kills and rethrows', async () => {
    const error = new Error('pool unavailable')
    const scope = { experimentId: 1 }
    const { req } = fixture(scope, { throwOn: { match: 'txid_status(', error } })
    await expect(withTransition(req, scope, async () => null)).rejects.toBe(error)
    expect(payloadHelpers.commitTransaction).toHaveBeenCalledOnce()
    expect(payloadHelpers.killTransaction).toHaveBeenCalledWith(req)
  })

  test.each(['begin', 'commit'] as const)('%s failure kills and rethrows', async stage => {
    const error = new Error(stage)
    const scope = { experimentId: 1 }
    const { req } = fixture(scope, { transactions: { [stage]: error } })
    await expect(withTransition(req, scope, async () => null)).rejects.toBe(error)
    expect(payloadHelpers.killTransaction).toHaveBeenCalledWith(req)
  })

  test('manifest read failure rolls back its earlier revision bump', async () => {
    const error = new Error('read failed')
    const scope = { experimentId: 1 }
    const { req, payload } = fixture(scope)
    vi.spyOn(payload, 'find').mockRejectedValueOnce(error)
    await expect(withTransition(req, scope, async () => null)).rejects.toBe(error)
    expect(payloadHelpers.killTransaction).toHaveBeenCalledWith(req)
    expect(payloadHelpers.commitTransaction).not.toHaveBeenCalled()
  })

  test.each(['disabled', 'missing'] as const)('no session (%s) fails before any lock executes', async mode => {
    const scope = { experimentId: 1 }
    const { req, executor } = fixture(scope, { transactions: { begin: null } })
    if (mode === 'missing') req.transactionID = 'not-a-session'
    const fn = vi.fn()
    await expect(withTransition(req, scope, fn)).rejects.toBeInstanceOf(XpNoTransactionError)
    expect(executor.calls).toEqual([])
    expect(fn).not.toHaveBeenCalled()
    expect(payloadHelpers.killTransaction).toHaveBeenCalledWith(req)
    expect(payloadHelpers.commitTransaction).not.toHaveBeenCalled()
  })
})

test('phase record creation keeps the request and explicit privileged access', async () => {
  const payload = fakePayload()
  const req = fakeReq({ payload })
  const record: PhaseRecord = { experiment: 4, phase: 2, phaseKind: 'test', startedAt: '2026-10-30T00:00:00Z', seed: 'seed|', arms: [], allocation: 50, targeting: [] }
  expect(await writePhaseRecord(req, record)).toMatchObject(record)
  expect(payload.calls[0]!.args).toMatchObject({ collection: 'xp-phases', req, overrideAccess: true, data: record })
})

describe('setPhaseEndedAt', () => {
  const at = '2026-10-31T00:00:00Z'
  test('a missing phase refuses with 404', async () => {
    const payload = fakePayload({ collections: { 'xp-phases': [{ id: 1, experiment: 5, phase: 2 }, { id: 2, experiment: 4, phase: 1 }] } })
    const req = fakeReq({ payload })
    await expect(setPhaseEndedAt(req, 4, 2, at)).rejects.toMatchObject({ code: 'not-found', status: 404 })
    expect(payload.calls).toHaveLength(1)
    expect(payload.calls[0]).toEqual({ method: 'find', args: {
      collection: 'xp-phases', req, overrideAccess: true, limit: 1, depth: 0,
      where: { and: [{ experiment: { equals: 4 } }, { phase: { equals: 2 } }] },
    } })
  })

  test('an already ended phase keeps the stop time and is returned unchanged', async () => {
    const record = { id: 3, experiment: 4, phase: 2, endedAt: '2026-10-30T12:00:00Z' }
    const payload = fakePayload({ collections: { 'xp-phases': [record] } })
    const req = fakeReq({ payload })
    expect(await setPhaseEndedAt(req, 4, 2, at)).toEqual(record)
    expect(payload.calls.map(call => call.method)).toEqual(['find'])
    expect(payload.documents['xp-phases']).toEqual([record])
  })

  test.each([undefined, null])('an open phase (%s) is updated by its row id', async endedAt => {
    const record = { id: 3, experiment: 4, phase: 2, endedAt }
    const payload = fakePayload({ collections: { 'xp-phases': [record] } })
    const req = fakeReq({ payload })
    expect(await setPhaseEndedAt(req, 4, 2, at)).toEqual({ ...record, endedAt: at })
    expect(payload.calls[1]).toEqual({ method: 'update', args: {
      collection: 'xp-phases', id: 3, req, overrideAccess: true, data: { endedAt: at },
    } })
  })

  test('an updateByID failure propagates instead of being swallowed by bulk update', async () => {
    const payload = fakePayload({ collections: { 'xp-phases': [{ id: 3, experiment: 4, phase: 2 }] } })
    const error = new Error('phase validation failed')
    const update = vi.spyOn(payload, 'update').mockRejectedValueOnce(error)
    await expect(setPhaseEndedAt(fakeReq({ payload }), 4, 2, at)).rejects.toBe(error)
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ id: 3 }))
  })
})
