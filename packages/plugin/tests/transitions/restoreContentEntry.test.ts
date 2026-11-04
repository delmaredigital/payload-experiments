import { afterEach, expect, test, vi } from 'vitest'
import { restoreContentEntry } from '../../src/transitions/restoreContentEntry.js'
import { fakePayload } from '../_fakes/payload.js'
import { createFakeExecutor } from '../_fakes/executor.js'

afterEach(() => vi.restoreAllMocks())
function fixture() {
  const executor = createFakeExecutor()
  executor.query = async <R>(text: string, params: unknown[] = []) => {
    executor.calls.push({ text, params })
    const rows = text.includes('txid_current') ? [{ xid: '123' }]
      : text.includes('txid_status') ? [{ status: 'committed' }] : []
    return { rows: rows as R[], rowCount: rows.length }
  }
  const payload = fakePayload({ executor, collections: {
    'xp-experiments': [{ id: 1, kind: 'flag', status: 'decided', layer: 3, flagPoint: 'setting',
      decision: { winnerArm: 'variantA', note: 'Keep audit', decidedBy: '12', snapshotId: '7', contentReport: { other: 'preserved', docs: [
        { collection: 'pages', id: 3, ok: false, detail: 'forbidden', dismissedAt: '2026-11-03T10:00:00.000Z', dismissedBy: '42' },
        { collection: 'articles', id: 3, ok: false, detail: 'validation' },
        { collection: 'pages', id: 4, ok: true },
      ] } } }],
  } })
  vi.spyOn(payload.logger, 'info')
  const req = executor.withSession({ payload })
  delete req.transactionID
  return { req, payload, executor, doc: payload.documents['xp-experiments']![0]! }
}
const target = { experimentId: 1, collection: 'pages', id: '3' }
test.each(['draft', 'running', 'stopped', 'archived'])('refuses status %s', async status => {
  const f = fixture(); f.doc.status = status
  await expect(restoreContentEntry(f.req, target)).rejects.toMatchObject({ code: 'not-decided' })
  expect(f.payload.calls.some(call => call.method === 'update')).toBe(false)
})
test.each([undefined, {}, { winnerArm: null }, { winnerArm: '' },
  { winnerArm: 'variantA', discardedAt: '2026-11-03T00:00:00Z' },
])('refuses absent/discarded winner %j', async change => {
  const f = fixture()
  f.doc.decision = change === undefined ? undefined : { ...f.doc.decision as object, winnerArm: undefined, ...change }
  await expect(restoreContentEntry(f.req, target)).rejects.toMatchObject({ code: 'not-decided' })
})
test.each([
  [undefined, 'entry-not-found'], [{}, 'entry-not-found'], [{ docs: [] }, 'entry-not-found'], [{ docs: {} }, 'entry-not-found'],
  [{ docs: [{ collection: 'articles', id: 3, ok: false }] }, 'entry-not-found'],
  [{ docs: [{ collection: 'pages', id: 9, ok: false }] }, 'entry-not-found'],
  [{ docs: [{ collection: 'pages', id: 3, ok: true }] }, 'entry-not-dismissed'],
  [{ docs: [{ collection: 'pages', id: 3 }] }, 'entry-not-dismissed'],
  [{ docs: [{ collection: 'pages', id: 3, ok: false }] }, 'entry-not-dismissed'],
] as const)('refuses a missing or undismissed entry %j with %s', async (contentReport, code) => {
  const f = fixture(); f.doc.decision = { winnerArm: 'variantA', contentReport }
  await expect(restoreContentEntry(f.req, target)).rejects.toMatchObject({ code })
  expect(f.payload.calls.some(call => call.method === 'update')).toBe(false)
  expect(f.payload.logger.info).not.toHaveBeenCalled()
})
test('restores exactly one entry, preserving its failure and decision, without a manifest bump', async () => {
  const f = fixture()
  const before = structuredClone(f.doc.decision) as any
  const result = await restoreContentEntry(f.req, target)
  const { dismissedAt: _at, dismissedBy: _by, ...restored } = before.contentReport.docs[0]
  expect(result.doc.decision).toEqual({ ...before, contentReport: { ...before.contentReport, docs: [
    restored, ...before.contentReport.docs.slice(1),
  ] } })
  expect(result).toEqual({ doc: f.doc })
  expect(f.payload.calls.filter(call => call.method === 'update')).toHaveLength(1)
  const locks = f.executor.calls.filter(call => call.text.includes('pg_advisory_xact_lock')).map(call => call.params)
  expect(locks).toEqual([['3'], ['setting'], ['1']])
  expect(f.executor.calls.some(call => call.text.includes('RETURNING "revision"') || call.text.includes('"manifest" ='))).toBe(false)
  expect(f.payload.dbCalls.some(call => call.method === 'commitTransaction')).toBe(true)
  expect(f.req.context.xpTransition).toBeUndefined()
  expect(f.payload.logger.info).toHaveBeenCalledExactlyOnceWith({ experimentId: 1, collection: 'pages', id: '3' }, 'Experiment content entry restored')
  await expect(restoreContentEntry(f.req, target)).rejects.toMatchObject({ code: 'entry-not-dismissed' })
})
test('re-reads the entry under locks before accepting restoration', async () => {
  const f = fixture()
  const find = f.payload.find.bind(f.payload)
  vi.spyOn(f.payload, 'find').mockImplementation(async args => {
    const result = await find(args)
    if (!f.req.context.xpTransition) f.doc.status = 'archived'
    return result
  })
  await expect(restoreContentEntry(f.req, target)).rejects.toMatchObject({ code: 'not-decided' })
  expect(f.payload.calls.filter(call => call.method === 'find')).toHaveLength(2)
  expect(f.payload.calls.some(call => call.method === 'update')).toBe(false)
})
