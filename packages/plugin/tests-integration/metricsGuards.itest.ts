import { createLocalReq, type PayloadRequest } from 'payload'
import { afterAll, beforeAll, expect, test } from 'vitest'
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
