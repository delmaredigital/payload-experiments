import { commitTransaction, createLocalReq, initTransaction, killTransaction, type PayloadRequest } from 'payload'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { metricDeleteGuard } from '../src/collections/metricsGuards.js'
import { txExecutor } from '../src/db/executor.js'
import { addMetric } from '../src/transitions/addMetric.js'
import { start } from '../src/transitions/start.js'
import { sampleOptions } from '../tests/collections/fixtures.js'
import { createIntegrationHarness } from './harness.js'

// Train-only: the coordinator runs this against Postgres with serial and uuid ids.
let harness: Awaited<ReturnType<typeof createIntegrationHarness>>
let manager: NonNullable<PayloadRequest['user']>
beforeAll(async () => {
  harness = await createIntegrationHarness({ manage: ({ req }) => req.user?.email === 'goals-manager@example.test' })
  const user = await harness.payload.create({ collection: 'users', overrideAccess: true,
    data: { email: 'goals-manager@example.test', password: 'integration-only-password' } })
  manager = { ...user, collection: 'users' }
}, 60_000)
afterAll(async () => { await harness?.teardown() })

async function request() { return createLocalReq({ user: manager }, harness.payload) }
async function goal(slug: string) {
  return harness.payload.create({ collection: 'xp-metrics', req: await request(), overrideAccess: false,
    data: { name: slug, slug, source: 'binomial', direction: 'increase' } })
}
async function experiment(slug: string, metrics: Record<string, unknown>) {
  return harness.payload.create({ collection: 'xp-experiments', req: await request(), overrideAccess: false, data: {
    name: slug, slug, kind: 'code', unitType: 'user', exposurePolicy: 'manual', allocation: 100,
    metrics, analysis: { plannedDurationDays: 14, reachPerDay: 100 },
  } })
}
async function assertGuarded(metric: { id: string | number }, testName: string) {
  const { payload } = harness
  await expect(payload.delete({ collection: 'xp-metrics', id: metric.id, req: await request(), overrideAccess: false }))
    .rejects.toMatchObject({ status: 400, isPublic: true,
      message: `This goal is used by the test "${testName}". Remove it from the test first.` })
  for (const data of [{ slug: `${testName}-changed` }, { source: 'count' }]) {
    // Fresh requests: Payload rolls back the failed operation's transaction.
    await expect(payload.update({ collection: 'xp-metrics', id: metric.id, req: await request(), overrideAccess: false, data }))
      .rejects.toMatchObject({ status: 400, isPublic: true,
        message: "This goal is used by a test, so its short name and what it measures can't change. Create a new goal instead." })
  }
  await expect(payload.update({ collection: 'xp-metrics', id: metric.id, req: await request(), overrideAccess: false,
    data: { name: 'An editable name', direction: 'decrease', attributionWindowHours: 24, minSampleSize: 200, guardrailThreshold: 0.1 } }))
    .resolves.toMatchObject({ name: 'An editable name', source: 'binomial' })
}

test('a running test guards its goal through access-checked delete and update', async () => {
  const metric = await goal('running-goal')
  const draft = await experiment('running-test', { primary: metric.id })
  const started = await start(await request(), { experimentId: draft.id, options: sampleOptions() })
  expect(started.doc.status).toBe('running')
  await assertGuarded(metric, draft.name)
})

test.each(['primary', 'secondary', 'guardrails'])('a draft guards its %s goal through access-checked delete and update', async role => {
  const metric = await goal(`draft-${role}-goal`)
  const primary = role === 'primary' ? metric : await goal(`draft-${role}-primary`)
  const draft = await experiment(`draft-${role}-test`, {
    primary: primary.id, ...(role === 'primary' ? {} : { [role]: [metric.id] }),
  })
  await assertGuarded(metric, draft.name)
})

test.each(['number', 'string'])('a phase alone guards a goal whose JSON metricId is a %s', async type => {
  const metric = await goal(`frozen-${type}-goal`)
  const draft = await experiment(`frozen-${type}-test`, {})
  // Under serial ids cover both JSON forms; uuid ids are necessarily strings.
  const metricId = type === 'number' && typeof metric.id === 'number' ? metric.id : String(metric.id)
  await harness.payload.create({ collection: 'xp-phases', req: await request(), overrideAccess: true, data: {
    experiment: draft.id, phase: 1, phaseKind: 'test', startedAt: new Date().toISOString(), seed: 'frozen|',
    metricDefinitions: [{ metricId }],
  } })
  await assertGuarded(metric, draft.name)
})

test('a running test is named before a draft referencing the same goal', async () => {
  const metric = await goal('shared-goal')
  await experiment('aaa-shared-draft', { primary: metric.id })
  const draft = await experiment('zzz-shared-running', { primary: metric.id })
  await start(await request(), { experimentId: draft.id, options: sampleOptions() })
  await assertGuarded(metric, draft.name)
})

test('an unused goal can change its slug and source and then be deleted', async () => {
  const metric = await goal('unused-goal')
  await expect(harness.payload.update({ collection: 'xp-metrics', id: metric.id, req: await request(), overrideAccess: false,
    data: { slug: 'unused-renamed', source: 'count' } })).resolves.toMatchObject({ slug: 'unused-renamed', source: 'count' })
  await expect(harness.payload.delete({ collection: 'xp-metrics', id: metric.id, req: await request(), overrideAccess: false }))
    .resolves.toMatchObject({ id: metric.id })
})

async function session() {
  const req = await request()
  await initTransaction(req)
  const exec = txExecutor(req)
  await exec.query("SET LOCAL lock_timeout = '8s'")
  const pid = (await exec.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid
  return { req, pid }
}

async function observeRowWait(pid: number, pending: Promise<unknown>) {
  let finished = false
  void pending.then(() => { finished = true }, () => { finished = true })
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    const { rows } = await harness.pool.query<{ waiting: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM pg_locks WHERE pid = $1 AND locktype IN ('transactionid', 'tuple') AND NOT granted) AS waiting", [pid],
    )
    if (rows[0]!.waiting) return
    if (finished) throw new Error('Operation finished without an observed goal-row wait')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('Operation did not wait on the goal row')
}

test('delete guard holds the goal row until deletion commits; a concurrent draft reference is refused', async () => {
  const metric = await goal('delete-first-goal')
  const draft = await experiment('delete-first-draft', {})
  const a = await session(), b = await session()
  let pending: Promise<unknown> | undefined
  try {
    // Pause exactly between the guard's usage read and the DELETE, with its
    // row lock held. Re-running the guard in payload.delete is intentional.
    await metricDeleteGuard({ req: a.req, id: metric.id } as Parameters<typeof metricDeleteGuard>[0])
    pending = harness.payload.update({ collection: 'xp-experiments', id: draft.id, req: b.req, overrideAccess: false,
      data: { metrics: { primary: metric.id } } })
    const outcome = Promise.allSettled([pending])
    await observeRowWait(b.pid, pending)
    await harness.payload.delete({ collection: 'xp-metrics', id: metric.id, req: a.req, overrideAccess: false })
    await commitTransaction(a.req)
    expect((await outcome)[0]!.status).toBe('rejected')
    const stored = await harness.payload.findByID({ collection: 'xp-experiments', id: draft.id, req: await request(), overrideAccess: false, depth: 0 })
    expect(stored.metrics?.primary == null).toBe(true)
  } finally {
    await killTransaction(a.req)
    await Promise.allSettled([pending])
    await killTransaction(b.req)
  }
})

test.each(['primary', 'secondary', 'guardrails'])('delete waits for a draft saving a %s reference, then refuses', async role => {
  const metric = await goal(`save-first-${role}-goal`)
  const draft = await experiment(`save-first-${role}-draft`, {})
  const a = await session(), b = await session()
  let pending: Promise<unknown> | undefined
  try {
    await harness.payload.update({ collection: 'xp-experiments', id: draft.id, req: b.req, overrideAccess: false,
      data: { metrics: { [role]: role === 'primary' ? metric.id : [metric.id] } } })
    pending = harness.payload.delete({ collection: 'xp-metrics', id: metric.id, req: a.req, overrideAccess: false })
    const outcome = Promise.allSettled([pending])
    await observeRowWait(a.pid, pending)
    await commitTransaction(b.req)
    expect((await outcome)[0]).toMatchObject({ status: 'rejected', reason: { status: 400, isPublic: true,
      message: `This goal is used by the test "${draft.name}". Remove it from the test first.` } })
    const stored = await harness.payload.findByID({ collection: 'xp-experiments', id: draft.id, req: await request(), overrideAccess: false, depth: 0 })
    expect(stored.metrics?.[role]).toEqual(role === 'primary' ? metric.id : [metric.id])
  } finally {
    await killTransaction(b.req)
    await Promise.allSettled([pending])
    await killTransaction(a.req)
  }
})

test.each(['Start', 'addMetric'])('%s holds FOR SHARE until commit, then the frozen goal refuses a slug change', async transition => {
  const metric = await goal(`freeze-${transition.toLowerCase()}-goal`)
  const primary = transition === 'Start' ? metric : await goal('freeze-addmetric-primary')
  const draft = await experiment(`freeze-${transition.toLowerCase()}-test`, { primary: primary.id })
  if (transition === 'addMetric') await start(await request(), { experimentId: draft.id, options: sampleOptions() })
  const a = await session(), b = await session()
  let pending: Promise<unknown> | undefined
  try {
    if (transition === 'Start') await start(a.req, { experimentId: draft.id, options: sampleOptions() })
    else await addMetric(a.req, { experimentId: draft.id, metric: metric.id, role: 'secondary', options: sampleOptions() })
    pending = harness.payload.update({ collection: 'xp-metrics', id: metric.id, req: b.req, overrideAccess: false,
      data: { slug: `freeze-${transition.toLowerCase()}-renamed` } })
    const outcome = Promise.allSettled([pending])
    await observeRowWait(b.pid, pending)
    await commitTransaction(a.req)
    expect((await outcome)[0]).toMatchObject({ status: 'rejected', reason: { status: 400, isPublic: true,
      message: "This goal is used by a test, so its short name and what it measures can't change. Create a new goal instead." } })
    const stored = await harness.payload.findByID({ collection: 'xp-metrics', id: metric.id, req: await request(), overrideAccess: false })
    expect(stored.slug).toBe(metric.slug)
  } finally {
    await killTransaction(a.req)
    await Promise.allSettled([pending])
    await killTransaction(b.req)
  }
})

test.each(['slug', 'source'])('addMetric refuses the old definition when a %s change wins the row lock', async field => {
  const primary = await goal(`change-first-${field}-primary`)
  const metric = await goal(`change-first-${field}-goal`)
  const draft = await experiment(`change-first-${field}-test`, { primary: primary.id })
  await start(await request(), { experimentId: draft.id, options: sampleOptions() })
  const a = await session(), b = await session()
  let pending: Promise<unknown> | undefined
  try {
    // B's unused-goal edit is uncommitted: A reads the old identity, then
    // waits for B at FOR SHARE and must inspect the updated locked row.
    const changed = field === 'slug' ? `change-first-${field}-renamed` : 'count'
    await harness.payload.update({ collection: 'xp-metrics', id: metric.id, req: b.req, overrideAccess: false,
      data: { [field]: changed } })
    pending = addMetric(a.req, { experimentId: draft.id, metric: metric.id, role: 'secondary', options: sampleOptions() })
    const outcome = Promise.allSettled([pending])
    await observeRowWait(a.pid, pending)
    await commitTransaction(b.req)
    expect((await outcome)[0]).toMatchObject({ status: 'rejected', reason: { code: 'stale-draft', status: 409 } })
    const phases = await harness.payload.find({ collection: 'xp-phases', req: await request(), overrideAccess: true,
      where: { experiment: { equals: draft.id } }, depth: 0 })
    expect(phases.docs[0]!.metricDefinitions).toHaveLength(1)
    const stored = await harness.payload.findByID({ collection: 'xp-metrics', id: metric.id, req: await request(), overrideAccess: false })
    expect(stored[field]).toBe(changed)
  } finally {
    await killTransaction(b.req)
    await Promise.allSettled([pending])
    await killTransaction(a.req)
  }
})
