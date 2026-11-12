import { expect, test, vi } from 'vitest'
import { guardExperimentIds, pageGuardBeforeChange, pageGuardAfterChange } from '../../src/hooks/pageGuard.js'
import { isPageBusy } from '../../src/db/pageBusy.js'
import { placementGuardCopy } from '../../src/testSurface/copy/readiness.js'
import { withTransition } from '../../src/transitions/kernel.js'
import { hostTransaction } from '../../src/transitions/makeContent.js'
import type { PlacementTest } from '../../src/db/placements.js'
import { createFakeExecutor } from '../_fakes/executor.js'
import { fakePayload } from '../_fakes/payload.js'
import { fakeReq } from '../_fakes/req.js'
import { sampleOptions } from '../collections/fixtures.js'
const tests: PlacementTest[] = [
  { id: 2, slug: 'block', name: 'Block', kind: 'block', status: 'running', pageCollection: null, phase: 1, arms: [], placementDocs: [] },
  { id: 3, slug: 'page', name: 'Page', kind: 'page', status: 'decided', pageCollection: 'pages', phase: 1, arms: [{ key: 'control', label: 'Original', kind: 'control', weight: 100, pageTarget: '/page' }], placementDocs: null },
]
function fixture(rows = tests) {
  const executor = createFakeExecutor()
  let error: unknown
  executor.query = async <R>(sql: string, params: unknown[] = []) => {
    executor.calls.push({ text: sql, params })
    if (error) throw error
    return { rows: (sql.includes('LEFT JOIN LATERAL') ? rows : sql.includes('current_setting') ? [{ timeout: '0' }] : sql.includes('txid_current') ? [{ xid: '1' }] : sql.includes('txid_status') ? [{ status: 'committed' }] : []) as R[], rowCount: 1 }
  }
  const options = sampleOptions()
  options.blocks = { collections: [{ slug: 'pages', field: 'layout' }] }
  options.pages = { collections: [{ slug: 'pages', pathOf: doc => typeof doc.path === 'string' ? doc.path : null, findByPath: async () => null }] }
  const payload = fakePayload({ executor, config: { custom: { xp: options } } })
  const original = { id: 1, path: '/page', layout: [], _status: 'published' }
  Object.assign(payload.db, { findOne: vi.fn(async () => original) })
  const req = executor.withSession({ payload })
  const collection = { slug: 'pages', versions: { drafts: true }, fields: [] }
  const content = { layout: [{ blockType: 'xpExperiment', experiment: 'block', slots: [] }] }
  const save = (data: Record<string, unknown>, create = false) => pageGuardBeforeChange({ req, collection, originalDoc: original, operation: create ? 'create' : 'update', data } as never)
  return { executor, req, payload, collection, original, content, save, fail: (e: unknown) => { error = e } }
}
test('save and create refuse interacting tests under E-before-path locks; pre-existing pair names state actions', async () => {
  const f = fixture()
  await expect(f.save({ ...f.content, _status: 'published' })).rejects.toMatchObject({ code: 'interacting-tests', message: placementGuardCopy(tests[1]!, tests[0]!, false) })
  expect(f.executor.calls.filter(c => c.text.includes('pg_advisory_xact_lock')).map(c => [c.text.includes('xp:experiment') ? 'E' : 'P', c.params[0]])).toEqual([['E', '2'], ['E', '3'], ['P', '/page']])
  f.original.layout = f.content.layout as never
  await expect(f.save({ ...f.content, _status: 'published' })).rejects.toMatchObject({ message: placementGuardCopy(tests[1]!, tests[0]!, true) })
  await expect(f.save({ ...f.content, path: '/page', _status: 'published' }, true)).rejects.toMatchObject({ code: 'interacting-tests' })
})
test('no transaction permits saves without removals; stopped blocks and ordinary pages save', async () => {
  const f = fixture([tests[0]!]); delete f.req.transactionID
  Object.assign(f.original, f.content)
  await expect(f.save({ ...f.content, _status: 'published' })).resolves.toBeDefined()
  await expect(f.save({ title: 'Plain', _status: 'published' })).resolves.toBeDefined()
  const stopped = fixture(tests.map(t => ({ ...t, status: 'stopped' }))); delete stopped.req.transactionID
  await expect(stopped.save({ ...stopped.content, _status: 'published' })).resolves.toBeDefined()
})
test.each(['40P01', '55P03'])('DrizzleQueryError cause chain maps %s in guard and transition, including cycles', async code => {
  const error = Object.assign(new Error('Failed query'), { name: 'DrizzleQueryError', cause: Object.assign(new Error('driver'), { code }) })
  expect(isPageBusy(error)).toBe(true)
  const f = fixture(); f.fail(error)
  await expect(f.save({ _status: 'published' })).rejects.toMatchObject({ code: 'page-busy', status: 409 })
  const req = fakeReq({ payload: f.payload })
  await expect(withTransition(req, { experimentId: 1 }, async () => {})).rejects.toMatchObject({ code: 'page-busy', status: 409 })
  const cycle: { cause?: unknown } = {}; cycle.cause = cycle
  expect(isPageBusy(cycle)).toBe(false)
})
test('hostTransaction drops caller-held id in the guard and restores the exact prior marker on success and failure', async () => {
  const f = fixture(), prior = ['old']
  f.req.context.xpHeldExperiments = prior
  for (const failure of [false, true]) {
    const run = hostTransaction(f.req, 2, async () => {
      expect(guardExperimentIds(tests, ['block'], 'pages', ['/page'], f.req.context.xpHeldExperiments)).toEqual(['3'])
      if (failure) throw new Error('host failed')
    })
    if (failure) await expect(run).rejects.toThrow('host failed')
    else await run
    expect(f.req.context.xpHeldExperiments).toBe(prior)
  }
})
test('afterChange appends published stored placements and propagates SQL failure', async () => {
  const f = fixture([tests[0]!]); Object.assign(f.original, f.content)
  await pageGuardAfterChange({ req: f.req, collection: f.collection, doc: f.original } as never)
  const append = f.executor.calls.find(c => c.text.startsWith('UPDATE'))
  expect(append?.params).toEqual([JSON.stringify([{ collection: 'pages', id: 1 }]), 2, 1, 'pages', '1'])
  const error = new Error('SQL failed'); f.fail(error)
  await expect(pageGuardAfterChange({ req: f.req, collection: f.collection, doc: f.original } as never)).rejects.toBe(error)
})
