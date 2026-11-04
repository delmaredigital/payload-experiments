import { commitTransaction, createLocalReq, initTransaction, killTransaction, type PayloadRequest } from 'payload'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { txExecutor } from '../src/db/executor.js'
import { defaultArms } from '../src/collections/experiments/armInvariants.js'
import { stop } from '../src/transitions/stop.js'
import { decide } from '../src/transitions/decide.js'
import { start } from '../src/transitions/start.js'
import { sampleOptions } from '../tests/collections/fixtures.js'
import { createIntegrationHarness } from './harness.js'

// Train only: serial + uuid Postgres adapters. Never run in the feature lane.
let harness: Awaited<ReturnType<typeof createIntegrationHarness>>
beforeAll(async () => { harness = await createIntegrationHarness() }, 60_000)
afterAll(async () => { await harness?.teardown() })
const options = sampleOptions()
let serial = 0
async function pageTest(path: string, reverse = false) {
  const slug = `page-in-use-${++serial}`
  const metric = await harness.payload.create({ collection: 'xp-metrics', overrideAccess: true,
    data: { name: slug, slug, source: 'binomial', direction: 'increase', attributionWindowHours: 168 } })
  return harness.payload.create({ collection: 'xp-experiments', overrideAccess: true,
    data: { name: slug, slug, kind: 'page', unitType: 'visitor', exposurePolicy: 'pageview', allocation: 100,
      arms: defaultArms('page').map((arm, index) => ({ ...arm, pageTarget: (reverse ? !index : index) ? `${path}/variant/` : `${path}/` })),
      metrics: { primary: metric.id }, analysis: { plannedDurationDays: 14 } } })
}
async function request() { return createLocalReq({}, harness.payload) }
async function begin() {
  const req = await request()
  await initTransaction(req)
  const pid = (await txExecutor(req).query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid
  return { req, pid }
}
async function waitForPathLock(pid: number, pending: Promise<unknown>) {
  let finished = false
  void pending.then(() => { finished = true }, () => { finished = true })
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    const { rows } = await harness.pool.query<{ waiting: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM pg_locks WHERE pid = $1 AND locktype = 'advisory' AND NOT granted
        AND classid::bigint = (hashtext('xp:pagepath')::bigint & 4294967295)) AS waiting`, [pid])
    if (rows[0]!.waiting) return
    if (finished) throw new Error('Start completed without waiting on the shared page path')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('Start did not wait on a page path lock')
}
async function startAndCommit(req: PayloadRequest, experimentId: string | number) {
  try {
    const result = await start(req, { experimentId, options })
    await commitTransaction(req)
    return result
  } catch (error) {
    await killTransaction(req)
    throw error
  }
}

test('a second whole-page test cannot start on an occupied page', async () => {
  const a = await pageTest('/sequential'), b = await pageTest('/sequential', true)
  await start(await request(), { experimentId: a.id, options })
  await expect(start(await request(), { experimentId: b.id, options })).rejects.toMatchObject({
    code: 'page-in-use', detail: { paths: ['/sequential', '/sequential/variant'] },
  })
  expect((await harness.payload.findByID({ collection: 'xp-experiments', id: b.id, overrideAccess: true })).status).toBe('draft')
})

test('concurrent starts on the same normalized paths wait and exactly one succeeds', async () => {
  const a = await pageTest('/concurrent'), b = await pageTest('/concurrent', true)
  const first = await begin(), second = await begin()
  let pending: Promise<Awaited<ReturnType<typeof start>>> | undefined
  try {
    // A has finished its transition but has not committed: B's preflight cannot
    // see it. B must wait on a path lock and re-read after A commits.
    const one = await start(first.req, { experimentId: a.id, options })
    pending = startAndCommit(second.req, b.id)
    // Attach the rejection observer before releasing A's locks.
    const outcomes = Promise.allSettled([Promise.resolve(one), pending])
    await waitForPathLock(second.pid, pending)
    await commitTransaction(first.req)
    const results = await outcomes
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.find(result => result.status === 'rejected')).toMatchObject({
      reason: { code: 'page-in-use', detail: { paths: ['/concurrent', '/concurrent/variant'] } },
    })
    const docs = await harness.payload.find({ collection: 'xp-experiments', overrideAccess: true, depth: 0,
      where: { id: { in: [a.id, b.id] } } })
    expect(docs.docs.filter(doc => doc.status === 'running')).toHaveLength(1)
    expect(docs.docs.filter(doc => doc.status === 'draft')).toHaveLength(1)
  } finally {
    await killTransaction(first.req)
    await Promise.allSettled([pending])
    await killTransaction(second.req)
  }
})


test('deciding after a stopped document edit occupies the frozen pages and leaves edited pages free', async () => {
  const a = await pageTest('/stopped-edit-x')
  await start(await request(), { experimentId: a.id, options })
  await stop(await request(), { experimentId: a.id })
  await harness.payload.update({ collection: 'xp-experiments', id: a.id, overrideAccess: true,
    data: { arms: defaultArms('page').map((arm, index) => ({ ...arm, pageTarget: index ? '/stopped-edit-y/variant/' : '/stopped-edit-y/' })) } })
  await decide(await request(), { experimentId: a.id, winnerArm: 'control', confirmation: 'Original', note: 'Keep the tested Original' })
  const b = await pageTest('/stopped-edit-x'), c = await pageTest('/stopped-edit-y')
  await expect(start(await request(), { experimentId: b.id, options })).rejects.toMatchObject({
    code: 'page-in-use', detail: { paths: ['/stopped-edit-x', '/stopped-edit-x/variant'] },
  })
  expect((await harness.payload.findByID({ collection: 'xp-experiments', id: b.id, overrideAccess: true })).status).toBe('draft')
  await expect(start(await request(), { experimentId: c.id, options })).resolves.toMatchObject({ doc: { status: 'running' } })
})
