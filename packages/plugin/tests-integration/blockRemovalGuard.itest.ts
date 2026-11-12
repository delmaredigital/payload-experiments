import { REST_DELETE, REST_PATCH } from '@payloadcms/next/routes'
import { commitTransaction, createLocalReq, getPayload, initTransaction, killTransaction, type PayloadRequest } from 'payload'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { createIntegrationHarness } from './harness.js'
import { start } from '../src/transitions/start.js'
import { txExecutor } from '../src/db/executor.js'
import { removableBlockTests } from '../src/db/placements.js'
import type { DocId, ResolvedOptions } from '../src/types/contracts.js'

// Postgres serial + uuid: ~6.4 s including the intentional 5 s timeout,
// plus harness bootstrap per mode.
let harness: Awaited<ReturnType<typeof createIntegrationHarness>>
let restoreCache: (() => void) | undefined
let sequence = 0
let manager: NonNullable<PayloadRequest['user']>
beforeAll(async () => {
  harness = await createIntegrationHarness({
    puckCollections: ['removal-pages'],
    collections: [{ slug: 'removal-pages', versions: { drafts: { autosave: true } },
      access: { create: () => true, read: () => true, update: () => true, delete: () => true, readVersions: () => true, unlock: () => true },
      fields: [{ name: 'title', type: 'text' }, { name: 'puckData', type: 'json' }],
    }],
  })
  const user = await harness.payload.create({ collection: 'users', overrideAccess: true,
    data: { email: 'placement-manager@example.test', password: 'integration-only-password' } })
  manager = { ...user, collection: 'users' }
  const cache = (globalThis as typeof globalThis & {
    _payload: Map<string, { payload: typeof harness.payload; initializedCrons: boolean; promise: null; reload: boolean; ws: null }>
  })._payload
  const previous = cache.get('default')
  cache.set('default', { payload: harness.payload, initializedCrons: true, promise: null, reload: false, ws: null })
  restoreCache = () => { if (previous) cache.set('default', previous); else cache.delete('default') }
  expect(await getPayload({ config: harness.payload.config })).toBe(harness.payload)
}, 60_000)
afterAll(async () => { restoreCache?.(); await harness?.teardown() }, 60_000)
const request = () => createLocalReq({ user: manager }, harness.payload)
const options = () => harness.payload.config.custom!.xp as ResolvedOptions
const empty = { content: [] }
async function fixture(count = 1) {
  const suffix = ++sequence, { payload } = harness
  const metric = await payload.create({ collection: 'xp-metrics', req: await request(), overrideAccess: true,
    data: { name: 'Goal', slug: `removal-goal-${suffix}`, source: 'binomial', direction: 'increase' } })
  const experiment = await payload.create({ collection: 'xp-experiments', req: await request(), overrideAccess: true, data: {
    name: 'Placement race', slug: `removal-race-${suffix}`, kind: 'block', unitType: 'visitor', allocation: 100, exposurePolicy: 'render',
    arms: [{ key: 'control', label: 'Original', kind: 'control', weight: 50, slot: 'control' },
      { key: 'variantA', label: 'Variant A', kind: 'variant', weight: 50, slot: 'variantA' }],
    metrics: { primary: metric.id }, analysis: { plannedDurationDays: 14, reachPerDay: 100 },
  } })
  const content = { content: [{ type: 'ExperimentSlot', props: { id: `slot-${suffix}`, experiment: { id: experiment.id, slug: experiment.slug },
    control: [{ type: 'Text', props: { text: 'Original' } }], variantA: [{ type: 'Text', props: { text: 'Variant' } }] } }] }
  const pages = []
  for (let index = 0; index < count; index++) pages.push(await payload.create({ collection: 'removal-pages', req: await request(), overrideAccess: false,
    data: { title: `Race ${suffix}-${index}`, puckData: content, _status: 'published' } }))
  return { experiment, pages }
}
async function begin() {
  const req = await request()
  await initTransaction(req)
  const pid = (await txExecutor(req).query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid
  return { req, pid }
}
async function expectExperimentLock(req: PayloadRequest, pid: number, experimentId: DocId, transaction: unknown) {
  // Anonymous includeLockStatus reads can roll back the caller's transaction in
  // Payload 3.90.2. Prove Start borrowed it and still holds E before racing.
  expect(await req.transactionID).toBe(transaction)
  const { rows } = await harness.pool.query<{ held: boolean }>(`SELECT EXISTS (SELECT 1 FROM pg_locks
    WHERE pid = $1 AND locktype = 'advisory' AND granted
    AND classid::bigint = (hashtext('xp:experiment')::bigint & 4294967295)
    AND objid::bigint = (hashtext($2)::bigint & 4294967295) AND objsubid = 2) AS held`, [pid, String(experimentId)])
  expect(rows[0]!.held).toBe(true)
}
async function settle<T>(req: PayloadRequest, work: () => Promise<T>) {
  try { const result = await work(); await commitTransaction(req); return result }
  catch (error) { await killTransaction(req); throw error }
}
async function waitForExperimentLock(pid: number, experimentId: DocId, pending: Promise<unknown>) {
  let finished = false
  void pending.then(() => { finished = true }, () => { finished = true })
  const deadline = Date.now() + 4_000
  while (Date.now() < deadline) {
    const { rows } = await harness.pool.query<{ waiting: boolean }>(`SELECT EXISTS (SELECT 1 FROM pg_locks
      WHERE pid = $1 AND locktype = 'advisory' AND NOT granted
      AND classid::bigint = (hashtext('xp:experiment')::bigint & 4294967295)
      AND objid::bigint = (hashtext($2)::bigint & 4294967295) AND objsubid = 2) AS waiting`, [pid, String(experimentId)])
    if (rows[0]!.waiting) return
    if (finished) throw new Error('Operation finished without waiting on E')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('Did not observe experiment lock wait')
}
const remove = (req: PayloadRequest, id: DocId) => harness.payload.update({ collection: 'removal-pages', id, req, overrideAccess: false,
  data: { puckData: empty, _status: 'published' } })

test.each(['start', 'remove'])('%s first: Start and removal serialize in both orders without losing a running placement', async firstOperation => {
  const f = await fixture(), first = await begin(), second = await begin()
  let pending: Promise<unknown> | undefined
  try {
    const transaction = await first.req.transactionID
    if (firstOperation === 'start') await start(first.req, { experimentId: f.experiment.id, options: options() })
    else await remove(first.req, f.pages[0]!.id)
    await expectExperimentLock(first.req, first.pid, f.experiment.id, transaction)
    pending = settle<unknown>(second.req, () => firstOperation === 'start' ? remove(second.req, f.pages[0]!.id)
      : start(second.req, { experimentId: f.experiment.id, options: options() }))
    const outcome = Promise.allSettled([pending])
    await waitForExperimentLock(second.pid, f.experiment.id, pending)
    await commitTransaction(first.req)
    expect((await outcome)[0]).toMatchObject({ status: 'rejected', reason: {
      code: firstOperation === 'start' ? 'locked-placement' : 'no-placements',
    } })
    const experiment = await harness.payload.findByID({ collection: 'xp-experiments', id: f.experiment.id, overrideAccess: true })
    const page = await harness.payload.findByID({ collection: 'removal-pages', id: f.pages[0]!.id, overrideAccess: true, draft: false })
    expect(experiment.status).toBe(firstOperation === 'start' ? 'running' : 'draft')
    expect(page.puckData.content).toHaveLength(firstOperation === 'start' ? 1 : 0)
  } finally {
    await killTransaction(first.req)
    await Promise.allSettled([pending])
    await killTransaction(second.req)
  }
}, 30_000) // Estimates <2 s each, cap includes CI margin.

async function rest(method: 'PATCH' | 'DELETE', path: string, query = '', data?: unknown) {
  return (method === 'PATCH' ? REST_PATCH : REST_DELETE)(harness.payload.config)(new Request(`http://localhost/api/${path}${query}`, {
    method, headers: { 'Content-Type': 'application/json' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  }), { params: Promise.resolve({ slug: path.split('/') }) })
}
test.each(['PATCH', 'DELETE'] as const)('bulk REST %s of the last two placements commits at most one sibling, refuses the rest, and leaves a published placement', async method => {
  const f = await fixture(2)
  await start(await request(), { experimentId: f.experiment.id, options: options() })
  const query = new URLSearchParams()
  f.pages.forEach((page, index) => query.set(`where[id][in][${index}]`, String(page.id)))
  const response = await rest(method, 'removal-pages', `?${query}`, method === 'PATCH' ? { puckData: empty, _status: 'published' } : undefined)
  const body = await response.json() as { docs: Array<{ id: DocId }>; errors: Array<{ id: DocId; message: string }> }
  expect(body.errors.length).toBeGreaterThanOrEqual(1)
  expect(body.docs.length + body.errors.length).toBe(2)
  expect(body.docs.length).toBeLessThanOrEqual(1)
  // Concurrent claims may conservatively refuse both; returned ids identify
  // exactly which sibling committed, without relying on scheduling order.
  expect([...body.docs, ...body.errors].map(row => String(row.id)).sort()).toEqual(f.pages.map(page => String(page.id)).sort())
  expect(body.errors.every(error => /running/.test(error.message))).toBe(true) // no page-busy/deadlock
  const remaining = await harness.payload.find({ collection: 'removal-pages', overrideAccess: true, draft: false,
    where: { id: { in: f.pages.map(page => page.id) } } })
  expect(remaining.docs.filter(doc => doc._status === 'published' && doc.puckData.content.length > 0).map(doc => String(doc.id)).sort())
    .toEqual(body.errors.map(row => String(row.id)).sort())
}, 30_000) // Estimate <2 s; finite cap also catches a deadlock.

test('the 5 s experiment lock timeout maps to page-busy while Start holds E', async () => {
  const f = await fixture(), holder = await begin()
  try {
    const transaction = await holder.req.transactionID
    await start(holder.req, { experimentId: f.experiment.id, options: options() })
    await expectExperimentLock(holder.req, holder.pid, f.experiment.id, transaction)
    const before = Date.now()
    await expect(remove(await request(), f.pages[0]!.id)).rejects.toMatchObject({ code: 'page-busy', status: 409 })
    expect(Date.now() - before).toBeGreaterThanOrEqual(4_500)
  } finally { await killTransaction(holder.req) }
}, 30_000) // Intentional 5 s wait; cap >3× local estimate.

test('admin UnpublishButton PATCH shape refuses the last placement and allows it when another remains', async () => {
  const f = await fixture()
  await start(await request(), { experimentId: f.experiment.id, options: options() })
  // @payloadcms/ui/dist/elements/UnpublishButton/index.js:74-105:
  // PATCH /collection/id?depth=0&fallback-locale=null&unpublishAllLocales=true, {_status:'draft'}; no draft=true.
  const path = `removal-pages/${f.pages[0]!.id}`
  const query = '?depth=0&fallback-locale=null&unpublishAllLocales=true'
  const refused = await rest('PATCH', path, query, { _status: 'draft' })
  expect(refused.status).toBe(409)
  expect(await refused.json()).toMatchObject({ errors: [expect.objectContaining({ message: expect.stringContaining('only published place') })] })
  await harness.payload.create({ collection: 'removal-pages', req: await request(), overrideAccess: false,
    data: { title: 'Another placement', puckData: f.pages[0]!.puckData, _status: 'published' } })
  const allowed = await rest('PATCH', path, query, { _status: 'draft' })
  expect(allowed.status).toBe(200)
  expect(await allowed.json()).toMatchObject({ doc: { _status: 'draft' } })
}, 30_000) // Estimate <2 s.

test('EXPLAIN of the remaining production slug query uses its unique index', async () => {
  const f = await fixture(), { req } = await begin()
  const exec = txExecutor(req), table = `"${harness.schemaName}".xp_experiments`
  try {
    // Give the planner realistic selectivity; do not force enable_seqscan off.
    const ids = typeof f.experiment.id === 'number' ? '(SELECT max(id) FROM ' + table + ') + g' : 'gen_random_uuid()'
    await exec.query(`INSERT INTO ${table} (id, slug, name, status, kind, unit_type, allocation, exposure_policy, created_at, updated_at)
      SELECT ${ids}, 'explain-' || g, 'Explain', 'draft', 'block', 'visitor', 100, 'render', now(), now() FROM generate_series(1, 10000) g`)
    await exec.query(`ANALYZE ${table}`)
    const indexes = await exec.query<{ indexname: string }>(`SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND tablename = 'xp_experiments'
      AND indexdef LIKE 'CREATE UNIQUE INDEX%(%slug%)'`, [harness.schemaName])
    expect(indexes.rows.length).toBeGreaterThan(0)
    let plan = ''
    await removableBlockTests(Object.assign({ async query<R>(sql: string, params?: unknown[]) {
      plan = JSON.stringify((await exec.query(`EXPLAIN (FORMAT JSON) ${sql}`, params)).rows)
      return exec.query<R>(sql, params)
    } }, { schemaName: harness.schemaName }), [String(f.experiment.slug)])
    expect(plan).toMatch(/Index (?:Only )?Scan|Bitmap Index Scan/)
    expect(indexes.rows.some(index => plan.includes(index.indexname))).toBe(true)
  } finally { await killTransaction(req) }
}, 30_000) // Estimate <2 s; inserted planner rows are rolled back.
