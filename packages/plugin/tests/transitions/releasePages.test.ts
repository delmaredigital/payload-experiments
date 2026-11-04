import { expect, test, vi } from 'vitest'
import { releasePages } from '../../src/transitions/releasePages.js'
import { fakePayload } from '../_fakes/payload.js'
import { createFakeExecutor } from '../_fakes/executor.js'
import { sampleOptions } from '../collections/fixtures.js'

function fixture() {
  let revision = 10
  const executor = createFakeExecutor()
  executor.query = async <R>(text: string, params: unknown[] = []) => {
    executor.calls.push({ text, params })
    return { rows: (text.includes('RETURNING "revision"') ? [{ revision: ++revision }] : []) as R[], rowCount: 1 }
  }
  const payload = fakePayload({ executor, config: { custom: { xp: sampleOptions() } },
    overrides: { findGlobal: vi.fn(async () => ({ flagDefaults: {} })) }, collections: {
      'xp-experiments': [{ id: 1, slug: 'page', kind: 'page', status: 'archived', layer: 3, phase: 1, arms: [],
        decision: { winnerArm: 'variantA', note: 'Keep this audit', decidedBy: '12', snapshotId: '7', contentReport: { docs: [] } } }],
      'xp-phases': [{ id: 2, experiment: 1, phase: 1, phaseKind: 'test', arms: [
        { key: 'control', kind: 'control', pageTarget: '/original' }, { key: 'variantA', kind: 'variant', pageTarget: '/winner' },
      ] }],
    } })
  const req = executor.withSession({ payload })
  req.user = { id: 42 } as typeof req.user
  return { req, payload, executor, doc: payload.documents['xp-experiments']![0]! }
}

test.each(['draft', 'running', 'stopped', 'decided'])('refuses %s even with a winner', async status => {
  const f = fixture()
  f.doc.status = status
  await expect(releasePages(f.req, { experimentId: 1 })).rejects.toMatchObject({ code: 'invalid-status' })
  expect(f.payload.calls.some(call => call.method === 'update')).toBe(false)
  expect(f.executor.calls.some(call => call.text.includes('RETURNING "revision"'))).toBe(false)
})
test.each(['block', 'flag', 'code'])('refuses archived %s', async kind => {
  const f = fixture()
  f.doc.kind = kind
  await expect(releasePages(f.req, { experimentId: 1 })).rejects.toMatchObject({ code: 'invalid-status' })
})
test.each([undefined, {}, { winnerArm: null }, { winnerArm: '' },
  { winnerArm: 'variantA', discardedAt: '2026-11-03T00:00:00Z' },
  { winnerArm: 'variantA', pagesReleasedAt: '2026-11-03T00:00:00Z' },
])('refuses an absent, discarded or released winner: %j', async decision => {
  const f = fixture()
  f.doc.decision = decision
  await expect(releasePages(f.req, { experimentId: 1 })).rejects.toMatchObject({ code: 'invalid-status' })
})
test.each([42, 'opaque-user', null])('records release time and user %s, preserves the decision and bumps the manifest revision', async userId => {
  const f = fixture()
  f.req.user = userId === null ? null : { id: userId } as typeof f.req.user
  const before = structuredClone(f.doc.decision)
  const update = vi.spyOn(f.payload, 'update')
  const result = await releasePages(f.req, { experimentId: 1 })
  expect(result).toMatchObject({ revision: 11, doc: { status: 'archived', decision: {
    ...before as object, pagesReleasedAt: expect.any(String), pagesReleasedBy: userId === null ? null : String(userId),
  } } })
  const at = (result.doc.decision as { pagesReleasedAt: string }).pagesReleasedAt
  expect(new Date(at).toISOString()).toBe(at)
  expect(update).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ req: f.req, overrideAccess: true,
    data: { decision: { ...before as object, pagesReleasedAt: at, pagesReleasedBy: userId === null ? null : String(userId) } } }))
  const stored = f.executor.calls.find(call => call.text.includes('"manifest" ='))!
  expect(JSON.parse(stored.params[0] as string)).toMatchObject({ revision: 11, archivedPages: {} })
  const locks = f.executor.calls.filter(call => call.text.includes('pg_advisory_xact_lock')).map(call => call.params)
  expect(locks.slice(0, 2)).toEqual([['3'], ['1']])
  expect(f.req.context.xpTransition).toBeUndefined()
  await expect(releasePages(f.req, { experimentId: 1 })).rejects.toMatchObject({ code: 'invalid-status' })
})
test('re-reads under the transition locks before accepting release', async () => {
  const f = fixture()
  const find = f.payload.find.bind(f.payload)
  vi.spyOn(f.payload, 'find').mockImplementation(async args => {
    const doc = await find(args)
    if (!f.req.context.xpTransition) f.doc.decision = { winnerArm: 'variantA', pagesReleasedAt: '2026-11-03T00:00:00Z' }
    return doc
  })
  await expect(releasePages(f.req, { experimentId: 1 })).rejects.toMatchObject({ code: 'invalid-status' })
  expect(f.payload.calls.filter(call => call.method === 'find')).toHaveLength(2)
  expect(f.payload.calls.some(call => call.method === 'update')).toBe(false)
})
