import { createLocalReq, type PayloadRequest } from 'payload'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { readTargetingRules } from '../src/admin/targeting/targeting.model.js'
import { createIntegrationHarness } from './harness.js'

// Train only: real Local API field validation, serial + uuid Postgres adapters.
let harness: Awaited<ReturnType<typeof createIntegrationHarness>>
let manager: NonNullable<PayloadRequest['user']>
beforeAll(async () => {
  harness = await createIntegrationHarness({
    manage: ({ req }) => req.user?.email === 'block-path-manager@example.test',
    attributeKeys: { path: { type: 'string' } },
  })
  const user = await harness.payload.create({ collection: 'users', overrideAccess: true,
    data: { email: 'block-path-manager@example.test', password: 'integration-only-password' } })
  manager = { ...user, collection: 'users' }
}, 60_000)
afterAll(async () => { await harness?.teardown() })

const message = 'Page block tests run on their page; remove the page-path rule.'
const pathRule = { attribute: 'path', op: 'in', value: [' /home ', '/about', '/home', ''] }
const country = { attribute: 'country', op: 'eq', value: 'US' }
async function request(transition = false) {
  return createLocalReq({ user: manager, context: transition ? { xpTransition: true } : {} }, harness.payload)
}
async function fixture(slug: string, withPath = true) {
  // Seed legacy data through the Local API in a status outside this validator's
  // draft/stopped scope; only fixture setup bypasses the transition lock hook.
  const running = await harness.payload.create({ collection: 'xp-experiments', req: await request(true), overrideAccess: false,
    data: { name: slug, slug, kind: 'block', status: 'running', unitType: 'visitor', exposurePolicy: 'render', allocation: 100,
      targeting: withPath ? [pathRule, country] : [country] } })
  return harness.payload.update({ collection: 'xp-experiments', id: running.id, req: await request(true), overrideAccess: false,
    data: { status: 'draft' } })
}
async function update(id: string | number, data: Record<string, unknown>) {
  return harness.payload.update({ collection: 'xp-experiments', id, req: await request(), overrideAccess: false, data })
}
async function read(id: string | number) {
  return harness.payload.findByID({ collection: 'xp-experiments', id, req: await request(), overrideAccess: false })
}

test('a draft block test accepts an unrelated edit, refuses changed/new path rules, and permits removal', async () => {
  const doc = await fixture('block-path-local-api')
  const targeting = readTargetingRules(doc.targeting).map(rule => rule.attribute === 'country' ? { ...rule, value: 'CA' } : rule)
  // (a) Whole-array saves from the admin normalize the old path list while
  // editing a different rule; this and a rename must both succeed.
  const edited = await update(doc.id, { name: 'Renamed', targeting })
  expect(edited.name).toBe('Renamed')
  expect(edited.targeting).toEqual(targeting)
  const refusal = { data: { errors: [{ path: 'targeting', message }] } }
  // (b) Changing an existing path value or operator is refused at the array.
  for (const change of [{ value: ['/different'] }, { op: 'nin' }]) {
    await expect(update(doc.id, { targeting: targeting.map(rule => rule.attribute === 'path' ? { ...rule, ...change } : rule) }))
      .rejects.toMatchObject(refusal)
  }
  // (c) Adding a path row is refused even when another stored path is unchanged.
  await expect(update(doc.id, { targeting: [...targeting, { attribute: 'path', op: 'eq', value: '/new' }] }))
    .rejects.toMatchObject(refusal)
  expect((await read(doc.id)).targeting).toEqual(targeting)
  // (d) Removing the path rule succeeds.
  const removed = await update(doc.id, { targeting: targeting.filter(rule => rule.attribute !== 'path') })
  expect(removed.targeting).toHaveLength(1)
  expect(removed.targeting[0]).toMatchObject({ attribute: 'country', value: 'CA' })
})

test('a bulk where update compares each block test with its own stored targeting array', async () => {
  const stored = await fixture('block-path-bulk-stored')
  const fresh = await fixture('block-path-bulk-fresh', false)
  const targeting = readTargetingRules(stored.targeting)
  // (e) One submitted array is unchanged for stored, but introduces a path rule
  // for fresh. Payload processes both documents concurrently with one request.
  const req = await request()
  const result = await harness.payload.update({ collection: 'xp-experiments', req, overrideAccess: false,
    where: { id: { in: [stored.id, fresh.id] } }, data: { name: 'Bulk edit', targeting } })
  expect(result.docs.map(doc => doc.id)).toEqual([stored.id])
  expect(result.errors).toMatchObject([{ id: fresh.id, isPublic: true }])
  expect((await read(stored.id)).targeting).toEqual(targeting)
  expect((await read(stored.id)).name).toBe('Bulk edit')
  expect((await read(fresh.id)).targeting).toEqual(fresh.targeting)
  expect((await read(fresh.id)).name).toBe(fresh.name)
  expect(req.context).not.toHaveProperty('xpTargetingOriginalDoc')
})
