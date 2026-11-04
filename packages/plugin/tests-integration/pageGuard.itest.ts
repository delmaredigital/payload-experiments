import { commitTransaction, createLocalReq, initTransaction, killTransaction, restoreVersionOperation, type PayloadRequest } from 'payload'
import { txExecutor } from '../src/db/executor.js'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { createIntegrationHarness } from './harness.js'
import { start } from '../src/transitions/start.js'
import { decide } from '../src/transitions/decide.js'
import { archive } from '../src/transitions/archive.js'
import { releasePages } from '../src/transitions/releasePages.js'
import { expectedConfirm } from '../src/transitions/confirmPhrases.js'
import { runResults } from '../src/server/runResults.js'
import type { ResolvedOptions } from '../src/types/contracts.js'
import type { Snapshot } from '../src/types/snapshot.js'

// Train only: exp-core runs this against serial and uuid Postgres adapters.
let harness: Awaited<ReturnType<typeof createIntegrationHarness>>
let sequence = 0
const checkedUsers: unknown[] = []
beforeAll(async () => {
  const access = { create: () => true, read: () => true, update: () => true, delete: () => true, readVersions: () => true, unlock: () => true }
  harness = await createIntegrationHarness({
    collections: ['pages', 'other-pages'].map(slug => ({ slug, trash: true, versions: { drafts: { autosave: true } }, access,
      fields: [{ name: 'slug', type: 'text', required: true }, { name: 'title', type: 'text' }],
      hooks: { beforeChange: [async ({ req, originalDoc, data }) => {
        if (slug === 'pages' && req.context.pageGuardNestedDraft && !req.context.pageGuardInsideNestedDraft) {
          await req.payload.update({ collection: 'pages', id: originalDoc!.id, req, overrideAccess: true,
            context: { pageGuardInsideNestedDraft: true }, draft: true, data: { title: 'Nested draft', _status: 'draft' } })
        }
        return data
      }] },
    })),
    pages: { collections: [{ slug: 'pages', pathOf: doc => typeof doc.slug === 'string' ? `/${doc.slug}` : null,
      findByPath: async (path, req) => {
        checkedUsers.push(req.user)
        const pages = await req.payload.find({ collection: 'pages', req, overrideAccess: false, draft: false,
          where: { and: [{ slug: { equals: path.slice(1) } }, { _status: { equals: 'published' } }] } })
        return pages.docs[0] ? { id: pages.docs[0].id, published: true } : null
      },
    }] },
  })
}, 60_000)
afterAll(async () => { await harness?.teardown() })

async function fixture({ oldVersion = false } = {}) {
  const { payload } = harness
  const req = await createLocalReq({}, payload)
  const suffix = ++sequence
  const originalSlug = `original-${suffix}`, winnerSlug = `winner-${suffix}`, loserSlug = `loser-${suffix}`
  const original = await payload.create({ collection: 'pages', req, overrideAccess: false, data: { slug: oldVersion ? `old-${suffix}` : originalSlug, _status: 'published' } })
  const old = oldVersion ? (await payload.findVersions({ collection: 'pages', req, overrideAccess: false, where: { parent: { equals: original.id } }, sort: '-createdAt', limit: 1 })).docs[0] : undefined
  if (oldVersion) await payload.update({ collection: 'pages', id: original.id, req, overrideAccess: false, data: { slug: originalSlug, _status: 'published' } })
  const winner = await payload.create({ collection: 'pages', req, overrideAccess: false, data: { slug: winnerSlug, _status: 'published' } })
  const loser = await payload.create({ collection: 'pages', req, overrideAccess: false, data: { slug: loserSlug, _status: 'published' } })
  const metric = await payload.create({ collection: 'xp-metrics', req, overrideAccess: true, data: { name: 'Goal', slug: `goal-${suffix}`, source: 'binomial', direction: 'increase' } })
  const testDoc = await payload.create({ collection: 'xp-experiments', req, overrideAccess: true, data: {
    name: `Better page ${suffix}`, slug: `better-page-${suffix}`, kind: 'page', unitType: 'visitor', allocation: 100, exposurePolicy: 'pageview',
    arms: [{ key: 'control', label: 'Original', kind: 'control', weight: 40, pageTarget: `/${originalSlug}` },
      { key: 'variantA', label: 'Variant A', kind: 'variant', weight: 40, pageTarget: `/${winnerSlug}` },
      { key: 'variantB', label: 'Variant B', kind: 'variant', weight: 20, pageTarget: `/${loserSlug}` }],
    metrics: { primary: metric.id }, analysis: { plannedDurationDays: 14, reachPerDay: 100 },
  } })
  await start(req, { experimentId: testDoc.id, options: payload.config.custom!.xp as ResolvedOptions })
  const update = (id: string | number, data: Record<string, unknown>, draft?: boolean) => payload.update({ collection: 'pages', id, req, overrideAccess: false, ...(draft === undefined ? {} : { draft }), data })
  const remove = (id: string | number) => payload.delete({ collection: 'pages', id, req, overrideAccess: false })
  const choose = () => decide(req, { experimentId: testDoc.id, winnerArm: 'variantA', note: 'Owner choice', confirmation: expectedConfirm('decide', 'Variant A') })
  return { payload, req, original, winner, loser, testDoc, originalSlug, update, remove, choose, old }
}
const refusal = { status: 409, isPublic: true }

test('updates without draft or status refuse a rename on a drafts collection', async () => {
  const f = await fixture()
  await expect(f.update(f.original.id, { slug: 'renamed' })).rejects.toMatchObject(refusal)
})

test('a nested draft by-id update in a host hook cannot bypass the outer unpublish', async () => {
  const f = await fixture()
  f.req.context.pageGuardNestedDraft = true
  await expect(f.update(f.original.id, { _status: 'draft' }, false)).rejects.toMatchObject(refusal)
  const live = await f.payload.findByID({ collection: 'pages', id: f.original.id, req: f.req, overrideAccess: false, draft: false })
  expect(live).toMatchObject({ slug: f.originalSlug, _status: 'published' })
})

test('updates without draft or status also refuse the pending draft implicit unpublish', async () => {
  const f = await fixture()
  await f.update(f.original.id, { title: 'Pending', _status: 'draft' }, true)
  await expect(f.update(f.original.id, { title: 'Title only' })).rejects.toMatchObject(refusal)
})

test('partial-body publish after a draft rename is refused', async () => {
  const f = await fixture()
  await f.update(f.original.id, { slug: 'draft-rename', _status: 'draft' }, true)
  await expect(f.update(f.original.id, { _status: 'published' }, false)).rejects.toMatchObject(refusal)
})

test('trash through update and delete is refused; restoring trash remains allowed', async () => {
  const f = await fixture()
  await expect(f.update(f.original.id, { deletedAt: new Date().toISOString() })).rejects.toMatchObject(refusal)
  await expect(f.remove(f.original.id)).rejects.toMatchObject(refusal)
  const free = await f.payload.create({ collection: 'pages', req: f.req, overrideAccess: false, data: { slug: `free-${sequence}`, _status: 'published' } })
  await f.update(free.id, { deletedAt: new Date().toISOString() })
  await expect(f.payload.update({ collection: 'pages', req: f.req, overrideAccess: false, id: free.id, trash: true, data: { deletedAt: null } })).resolves.toMatchObject({ deletedAt: null })
})

test('draft rename then unpublish then republish cannot change the live path', async () => {
  const f = await fixture()
  await f.update(f.original.id, { slug: 'draft-rename', _status: 'draft' }, true)
  await expect(f.update(f.original.id, { _status: 'draft' }, false)).rejects.toMatchObject(refusal)
  await expect(f.update(f.original.id, { _status: 'published' }, false)).rejects.toMatchObject(refusal)
  const live = await f.payload.findByID({ collection: 'pages', id: f.original.id, req: f.req, overrideAccess: false, draft: false })
  expect(live).toMatchObject({ slug: f.originalSlug, _status: 'published' })
})

test('restoreVersion guards normal restores after an earlier draft op on the same req', async () => {
  const f = await fixture({ oldVersion: true })
  await f.update(f.original.id, { title: 'Draft', _status: 'draft' }, true)
  await expect(f.payload.restoreVersion({ collection: 'pages', id: f.old!.id, req: f.req, overrideAccess: false })).rejects.toMatchObject(refusal)
})

test('restoreVersion as draft allows restoring another path without changing the live row', async () => {
  const f = await fixture({ oldVersion: true })
  // Payload 3.90.2's Local API wrapper drops draft; use the public operation
  // invoked by its REST restore handler to exercise Restore as draft.
  await restoreVersionOperation({ collection: f.payload.collections.pages!, id: f.old!.id, req: f.req, overrideAccess: false, draft: true })
  expect(await f.payload.findByID({ collection: 'pages', id: f.original.id, req: f.req, overrideAccess: false, draft: false })).toMatchObject({ slug: f.originalSlug, _status: 'published' })
})

test('decided pages refuse delete, rename and unpublish with decided instructions', async () => {
  const f = await fixture()
  await f.choose()
  for (const page of [f.original, f.winner, f.loser]) {
    await expect(f.remove(page.id)).rejects.toMatchObject({ ...refusal, message: expect.stringContaining('Discard winner') })
    await expect(f.update(page.id, { slug: 'renamed', _status: 'published' })).rejects.toMatchObject(refusal)
    await expect(f.update(page.id, { _status: 'draft' }, false)).rejects.toMatchObject(refusal)
  }
})

test('archived winner and Original refuse rename, unpublish and delete; losing pages are free', async () => {
  const f = await fixture()
  await f.choose()
  await f.payload.update({ collection: 'xp-experiments', id: f.testDoc.id, req: f.req, overrideAccess: true,
    context: { xpTransition: true }, data: { decision: { winnerArm: 'variantA', contentReport: { docs: [{ ok: true }] } } } })
  await archive(f.req, { experimentId: f.testDoc.id, mode: 'after-content' })
  for (const page of [f.original, f.winner]) {
    await expect(f.remove(page.id)).rejects.toMatchObject({ ...refusal, message: expect.stringContaining('Release pages') })
    await expect(f.update(page.id, { slug: 'renamed', _status: 'published' })).rejects.toMatchObject(refusal)
    await expect(f.update(page.id, { _status: 'draft' }, false)).rejects.toMatchObject(refusal)
  }
  await expect(f.remove(f.loser.id)).resolves.toBeDefined()
})

test('discarded archived tests hold no manifest paths and their pages are free', async () => {
  const f = await fixture()
  await f.choose()
  await archive(f.req, { experimentId: f.testDoc.id, mode: 'discard', confirmation: expectedConfirm('discard', '') })
  const state = await f.payload.findGlobal({ slug: 'xp-state', req: f.req, overrideAccess: true })
  const manifest = state.manifest as { archivedPages?: Record<string, unknown> }
  for (const page of [f.original, f.winner, f.loser]) {
    expect(manifest.archivedPages).not.toHaveProperty(`/${page.slug}`)
    await expect(f.remove(page.id)).resolves.toBeDefined()
  }
})
test('archive then release advances the manifest and allows unpublishing the winner and Original', async () => {
  const f = await fixture()
  await f.choose()
  await f.payload.update({ collection: 'xp-experiments', id: f.testDoc.id, req: f.req, overrideAccess: true,
    context: { xpTransition: true }, data: { decision: { winnerArm: 'variantA', contentReport: { docs: [] } } } })
  const archived = await archive(f.req, { experimentId: f.testDoc.id, mode: 'after-content' })
  const before = await f.payload.findGlobal({ slug: 'xp-state', req: f.req, overrideAccess: true })
  expect((before.manifest as { archivedPages: Record<string, unknown> }).archivedPages).toHaveProperty(`/${f.original.slug}`)
  await expect(f.update(f.winner.id, { _status: 'draft' }, false)).rejects.toMatchObject(refusal)
  const released = await releasePages(f.req, { experimentId: f.testDoc.id })
  expect(released.revision).toBe(archived.revision + 1)
  expect(released.doc).toMatchObject({ status: 'archived', decision: { winnerArm: 'variantA', pagesReleasedAt: expect.any(String), pagesReleasedBy: null } })
  const after = await f.payload.findGlobal({ slug: 'xp-state', req: f.req, overrideAccess: true })
  expect(after.revision).toBe(released.revision)
  const manifest = after.manifest as { revision: number; archivedPages: Record<string, { slug: string }> }
  expect(manifest.revision).toBe(released.revision)
  expect(Object.values(manifest.archivedPages).some(entry => entry.slug === f.testDoc.slug)).toBe(false)
  await expect(f.update(f.winner.id, { _status: 'draft' }, false)).resolves.toMatchObject({ _status: 'draft' })
  await expect(f.update(f.original.id, { _status: 'draft' }, false)).resolves.toMatchObject({ _status: 'draft' })
})

test('title-only publishes are allowed', async () => {
  const f = await fixture()
  await expect(f.update(f.original.id, { title: 'Fresh title', _status: 'published' }, false)).resolves.toMatchObject({ title: 'Fresh title' })
})

test('bulk where delete and update refuse each protected document', async () => {
  const f = await fixture()
  const where = { id: { in: [f.original.id, f.winner.id] } }
  const deleted = await f.payload.delete({ collection: 'pages', where, req: f.req, overrideAccess: false })
  expect(deleted.errors).toHaveLength(2)
  const updated = await f.payload.update({ collection: 'pages', where, req: f.req, overrideAccess: false, data: { _status: 'draft' }, draft: false })
  expect(updated.errors).toHaveLength(2)
  expect(deleted.docs).toHaveLength(0)
  expect(updated.docs).toHaveLength(0)
})

test('a collection outside pages.collections is unaffected even at a protected path', async () => {
  const f = await fixture()
  const page = await f.payload.create({ collection: 'other-pages', req: f.req, overrideAccess: false, data: { slug: f.originalSlug, _status: 'published' } })
  await f.payload.update({ collection: 'other-pages', id: page.id, req: f.req, overrideAccess: false, data: { slug: 'renamed', _status: 'draft' }, draft: false })
  await expect(f.payload.delete({ collection: 'other-pages', id: page.id, req: f.req, overrideAccess: false })).resolves.toBeDefined()
})

test('runResults uses a real anonymous createLocalReq to detect an unavailable version page', async () => {
  const f = await fixture()
  // Adapter write simulates a page becoming unavailable outside normal host saves.
  const req: PayloadRequest = await createLocalReq({}, f.payload)
  await f.payload.db.updateOne({ collection: 'pages', id: f.winner.id, req, data: { _status: 'draft' } })
  checkedUsers.length = 0
  expect(await runResults(f.payload, { experimentId: f.testDoc.id, sweep: false })).toMatchObject({ ran: 1, failed: 0 })
  expect(checkedUsers.length).toBeGreaterThan(0)
  expect(checkedUsers.every(user => user === null)).toBe(true)
  const rows = await f.payload.find({ collection: 'xp-results-snapshots', req, overrideAccess: true, where: { experiment: { equals: f.testDoc.id } }, sort: '-computedAt' })
  expect((rows.docs[0]!.snapshot as Snapshot).health).toContainEqual({ code: 'version-page-unavailable', path: `/${f.winner.slug}` })
})

// CORE-54: the guard and Start take the same page-path lock, so a concurrent Start and delete serialise.
async function draftPageTest() {
  const { payload } = harness
  const req = await createLocalReq({}, payload)
  const suffix = ++sequence
  const original = await payload.create({ collection: 'pages', req, overrideAccess: false, data: { slug: `race-original-${suffix}`, _status: 'published' } })
  const version = await payload.create({ collection: 'pages', req, overrideAccess: false, data: { slug: `race-version-${suffix}`, _status: 'published' } })
  const metric = await payload.create({ collection: 'xp-metrics', req, overrideAccess: true, data: { name: 'Goal', slug: `race-goal-${suffix}`, source: 'binomial', direction: 'increase' } })
  const testDoc = await payload.create({ collection: 'xp-experiments', req, overrideAccess: true, data: {
    name: `Race ${suffix}`, slug: `race-${suffix}`, kind: 'page', unitType: 'visitor', allocation: 100, exposurePolicy: 'pageview',
    arms: [{ key: 'control', label: 'Original', kind: 'control', weight: 50, pageTarget: `/race-original-${suffix}` },
      { key: 'variantA', label: 'Variant A', kind: 'variant', weight: 50, pageTarget: `/race-version-${suffix}` }],
    metrics: { primary: metric.id }, analysis: { plannedDurationDays: 14, reachPerDay: 100 },
  } })
  return { original, version, testDoc }
}
async function begin() {
  const req = await createLocalReq({}, harness.payload)
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
    if (finished) throw new Error('Finished without waiting on the page path lock')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('Did not wait on a page path lock')
}
const xpOptions = () => harness.payload.config.custom!.xp as ResolvedOptions
async function settle<T>(req: PayloadRequest, work: () => Promise<T>) {
  try { const result = await work(); await commitTransaction(req); return result } catch (error) { await killTransaction(req); throw error }
}

test('Start first: a concurrent delete of a version page waits, then is refused', async () => {
  const { version, testDoc } = await draftPageTest()
  const first = await begin(), second = await begin()
  let pending: Promise<unknown> | undefined
  try {
    await start(first.req, { experimentId: testDoc.id, options: xpOptions() })
    pending = settle(second.req, () => harness.payload.delete({ collection: 'pages', id: version.id, req: second.req, overrideAccess: false }))
    const outcome = Promise.allSettled([pending])
    await waitForPathLock(second.pid, pending)
    await commitTransaction(first.req)
    const [result] = await outcome
    expect(result).toMatchObject({ status: 'rejected', reason: refusal })
    expect((await harness.payload.findByID({ collection: 'pages', id: version.id, overrideAccess: true })).id).toBe(version.id)
    expect((await harness.payload.findByID({ collection: 'xp-experiments', id: testDoc.id, overrideAccess: true })).status).toBe('running')
  } finally {
    await killTransaction(first.req)
    await Promise.allSettled([pending])
    await killTransaction(second.req)
  }
})

test('delete first: a concurrent Start waits on the page path, then refuses the deleted page', async () => {
  const { version, testDoc } = await draftPageTest()
  const first = await begin(), second = await begin()
  let pending: Promise<unknown> | undefined
  try {
    await harness.payload.delete({ collection: 'pages', id: version.id, req: first.req, overrideAccess: false })
    pending = settle(second.req, () => start(second.req, { experimentId: testDoc.id, options: xpOptions() }))
    const outcome = Promise.allSettled([pending])
    await waitForPathLock(second.pid, pending)
    await commitTransaction(first.req)
    const [result] = await outcome
    expect(result).toMatchObject({ status: 'rejected', reason: { code: 'page-target-unpublished' } })
    expect((await harness.payload.findByID({ collection: 'xp-experiments', id: testDoc.id, overrideAccess: true })).status).toBe('draft')
  } finally {
    await killTransaction(first.req)
    await Promise.allSettled([pending])
    await killTransaction(second.req)
  }
})

