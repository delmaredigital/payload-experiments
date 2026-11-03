import { createLocalReq, type PayloadRequest } from 'payload'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { XP_IF_UPDATED_AT_HEADER } from '../src/constants.js'
import { txExecutor } from '../src/db/executor.js'
import { createIntegrationHarness } from './harness.js'

// Train-only: real request transactions and row-lock contention, serial + uuid.
let harness: Awaited<ReturnType<typeof createIntegrationHarness>>
let manager: NonNullable<PayloadRequest['user']>
beforeAll(async () => {
  harness = await createIntegrationHarness({ manage: ({ req }) => req.user?.email === 'stale-edit-manager@example.test' })
  const user = await harness.payload.create({ collection: 'users', overrideAccess: true,
    data: { email: 'stale-edit-manager@example.test', password: 'integration-only-password' } })
  manager = { ...user, collection: 'users' }
}, 60_000)
afterAll(async () => { await harness?.teardown() })

function barrier<T = void>() {
  let release!: (value: T) => void
  const promise = new Promise<T>(resolve => { release = resolve })
  return { promise, release }
}
async function request(baseline?: string, editor?: string) {
  return createLocalReq({ user: manager, context: { staleEditEditor: editor }, req: {
    method: 'PATCH', headers: new Headers(baseline === undefined ? {} : { [XP_IF_UPDATED_AT_HEADER]: baseline }),
  } }, harness.payload)
}
async function fixture(slug: string) {
  const doc = await harness.payload.create({ collection: 'xp-experiments', req: await request(), overrideAccess: false, data: {
    name: slug, slug, kind: 'block', unitType: 'visitor', exposurePolicy: 'render', allocation: 100,
    arms: [
      { key: 'control', kind: 'control', label: 'Original', slot: 'control', weight: 50 },
      { key: 'variantA', kind: 'variant', label: 'Variant A', slot: 'variantA', weight: 50 },
    ],
  } })
  // Payload timestamps have millisecond precision; ensure the next save advances.
  while (Date.now() <= new Date(doc.updatedAt).getTime()) await new Promise(resolve => setTimeout(resolve, 1))
  return doc
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
    if (finished) throw new Error('Second PATCH finished without an observed row-lock wait')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('Second PATCH did not wait on the row lock')
}

test('concurrent access-checked PATCHes with one baseline keep only the winning arm label', async () => {
  const doc = await fixture('stale-edit-concurrent')
  const config = harness.payload.collections['xp-experiments']!.config
  const original = config.hooks.beforeChange
  const locked = barrier(), release = barrier(), secondPid = barrier<number>()
  const firstReq = await request(doc.updatedAt, 'first')
  const secondReq = await request(doc.updatedAt, 'second')
  let first: Promise<unknown> | undefined, second: Promise<unknown> | undefined
  config.hooks.beforeChange = [async args => {
    if (args.req.context.staleEditEditor === 'second') {
      secondPid.release((await txExecutor(args.req).query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid)
    }
    return args.data
  }, ...original, async args => {
    if (args.req.context.staleEditEditor === 'first') {
      locked.release()
      await release.promise
    }
    return args.data
  }]
  const update = (req: PayloadRequest, label: string) => harness.payload.update({
    collection: 'xp-experiments', id: doc.id, req, overrideAccess: false,
    data: { arms: doc.arms.map((arm: Record<string, unknown>) => arm.key === 'variantA' ? { ...arm, label } : arm) },
  })
  try {
    first = update(firstReq, 'Winning label')
    await Promise.race([locked.promise, first.then(() => { throw new Error('First PATCH missed barrier') })])
    second = update(secondReq, 'Losing label')
    const results = Promise.allSettled([first, second])
    const pid = await Promise.race([secondPid.promise, second.then(() => { throw new Error('Second PATCH missed barrier') })])
    await observeRowWait(pid, second)
    release.release()
    const outcomes = await results
    expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes[0]!.status).toBe('fulfilled')
    expect(outcomes[1]).toMatchObject({ status: 'rejected', reason: { code: 'stale-edit', status: 409,
      message: 'Someone else changed this test. Reload to see their changes.' } })
    const stored = await harness.payload.findByID({ collection: 'xp-experiments', id: doc.id, req: await request(), overrideAccess: false })
    expect(stored.arms.find((arm: Record<string, unknown>) => arm.key === 'variantA')?.label).toBe('Winning label')
    expect(stored.arms.some((arm: Record<string, unknown>) => arm.label === 'Losing label')).toBe(false)
  } finally {
    release.release()
    await Promise.allSettled([first, second])
    config.hooks.beforeChange = original
  }
})

test('a sequential PATCH using the old baseline is refused and preserves the first edit', async () => {
  const doc = await fixture('stale-edit-sequential')
  await harness.payload.update({ collection: 'xp-experiments', id: doc.id, req: await request(doc.updatedAt), overrideAccess: false,
    data: { arms: doc.arms.map((arm: Record<string, unknown>) => arm.key === 'variantA' ? { ...arm, label: 'First edit' } : arm) } })
  await expect(harness.payload.update({ collection: 'xp-experiments', id: doc.id, req: await request(doc.updatedAt), overrideAccess: false,
    data: { arms: doc.arms.map((arm: Record<string, unknown>) => arm.key === 'variantA' ? { ...arm, label: 'Stale edit' } : arm) } }))
    .rejects.toMatchObject({ code: 'stale-edit', status: 409 })
  const stored = await harness.payload.findByID({ collection: 'xp-experiments', id: doc.id, req: await request(), overrideAccess: false })
  expect(stored.arms.find((arm: Record<string, unknown>) => arm.key === 'variantA')?.label).toBe('First edit')
})
