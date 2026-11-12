import type { CollectionAfterOperationHook, CollectionBeforeChangeHook, CollectionBeforeDeleteHook, CollectionBeforeOperationHook } from 'payload'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { pageGuardAfterChange, pageGuardAfterOperation, pageGuardBeforeChange, pageGuardBeforeDelete, pageGuardBeforeOperation } from '../../src/hooks/pageGuard.js'
import { blockRemovalRule } from '../../src/hooks/blockRemovalRule.js'
import * as placements from '../../src/transitions/placements.js'
import { pendingBlockRemovalCopy, pageGuardCopy } from '../../src/testSurface/copy/readiness.js'
import { fakePayload } from '../_fakes/payload.js'
import { fakeReq } from '../_fakes/req.js'
import { createFakeExecutor } from '../_fakes/executor.js'
import { sampleOptions } from './fixtures.js'

afterEach(() => vi.restoreAllMocks())

function setup(status = 'running', path = '/original', discarded = false, drafts = true) {
  const trace: unknown[] = []
  const options = sampleOptions()
  const findByPath = vi.fn()
  options.pages = { collections: [{ slug: 'pages', pathOf: doc => typeof doc.slug === 'string' ? `/${doc.slug}` : null, findByPath }] }
  const executor = createFakeExecutor()
  const payload = fakePayload({ executor, config: { custom: { xp: options } }, collections: { 'xp-experiments': [{
    id: 2, name: 'Better page', kind: 'page', status,
    arms: [{ key: 'control', kind: 'control', pageTarget: '/original' }, { key: 'variantA', kind: 'variant', pageTarget: '/winner' }, { key: 'variantB', kind: 'variant', pageTarget: '/loser' }],
    decision: status === 'archived' ? { winnerArm: 'variantA', discardedAt: discarded ? '2026-11-03' : null } : undefined,
  }], 'xp-phases': [{ id: 3, experiment: 2, phaseKind: 'test', phase: 1,
    arms: [{ key: 'control', kind: 'control', pageTarget: '/original' }, { key: 'variantA', kind: 'variant', pageTarget: '/winner' }, { key: 'variantB', kind: 'variant', pageTarget: '/loser' }],
  }] } })
  executor.query = async <R>(text: string, params: unknown[] = []) => {
    executor.calls.push({ text, params })
    trace.push({ text, params })
    const rows = text.includes('LEFT JOIN LATERAL') ? payload.documents['xp-experiments']!.map(test => {
      const phase = payload.documents['xp-phases']!.find(p => p.experiment === test.id)
      return { ...test, ...(test.decision as object ?? {}), pageCollection: null, arms: phase?.arms ?? [], phase: 1, placementDocs: null }
    }) : text.includes('ANY($1::text[])') ? payload.documents['xp-experiments']!.filter(test => test.kind === 'block' && ['draft', 'stopped', 'running'].includes(String(test.status)) && (params[0] as string[]).includes(String(test.slug))) : text.includes('current_setting') ? [{ timeout: '0' }] : []
    return { rows: rows as R[], rowCount: 1 }
  }
  const published = { id: 1, slug: path.slice(1), ...(drafts ? { _status: 'published' } : {}) }
  const read = vi.fn(async (args?: unknown) => { trace.push({ read: (args as { where: unknown }).where }); return published })
  Object.assign(payload.db, { findOne: read })
  const req = fakeReq({ payload })
  const collection = { trash: true, slug: 'pages', versions: drafts ? { drafts: {} } : false }
  const remove = () => pageGuardBeforeDelete({ req, collection, id: 1 } as Parameters<CollectionBeforeDeleteHook>[0])
  const begin = async (draft = false, operation: 'update' | 'restoreVersion' = 'update') => pageGuardBeforeOperation({ args: { req, draft, collection: { config: collection } }, operation } as Parameters<CollectionBeforeOperationHook>[0])
  const end = async (operation: 'update' | 'updateByID' | 'restoreVersion' = 'updateByID') => pageGuardAfterOperation({ req, collection, operation, result: {} } as Parameters<CollectionAfterOperationHook>[0])
  const change = (data: Record<string, unknown>, originalDoc: Record<string, unknown> = published) => pageGuardBeforeChange({ req, collection, originalDoc, operation: 'update', data } as unknown as Parameters<CollectionBeforeChangeHook>[0])
  const save = async (data: Record<string, unknown>, draft = false) => {
    await begin(draft)
    try { return await change(data) } finally { await end() }
  }
  return { trace, executor, payload, req, published, read, remove, save, findByPath, collection, begin, end, change }

}

for (const status of ['running', 'decided', 'archived']) {
  for (const path of ['/original', '/winner']) {
    describe(`${status} ${path}`, () => {
      test('refuses delete of the published main row', async () => {
        const f = setup(status, path)
        await expect(f.remove()).rejects.toMatchObject({ status: 409, isPublic: true, message: pageGuardCopy('Better page', status as 'running' | 'decided' | 'archived', status === 'archived' && path === '/original' ? 'original' : 'winner') })
        expect(f.read).toHaveBeenCalledWith(expect.objectContaining({ collection: 'pages', req: f.req, where: { id: { equals: 1 } } }))
        expect(f.payload.calls).toEqual([]) // guard uses raw reads, no Local API in hooks
        expect(f.findByPath).not.toHaveBeenCalled()
      })
      test('refuses rename on publish', async () => {
        await expect(setup(status, path).save({ slug: 'renamed', _status: 'published' })).rejects.toMatchObject({ status: 409 })
      })
      test('refuses unpublish', async () => {
        await expect(setup(status, path).save({ _status: 'draft' })).rejects.toMatchObject({ status: 409 })
      })
      test('allows draft-only rename and edits keeping the live path', async () => {
        const f = setup(status, path)
        await expect(f.save({ slug: 'renamed', _status: 'draft' }, true)).resolves.toBeDefined()
        expect(f.read).not.toHaveBeenCalled()
        await expect(f.save({ title: 'New title', _status: 'published' })).resolves.toBeDefined()
      })
    })
  }
}
test.each(['draft', 'stopped', 'archived'])('allows %s tests without a standing result', async status => {
  const f = setup(status, '/winner', true)
  await expect(f.remove()).resolves.toBeUndefined()
  await expect(f.save({ slug: 'renamed', _status: 'published' })).resolves.toBeDefined()
  await expect(f.save({ _status: 'draft' })).resolves.toBeDefined()
})
test('unrelated pages and archived losing versions are allowed', async () => {
  await expect(setup('running', '/unrelated').remove()).resolves.toBeUndefined()
  await expect(setup('archived', '/loser').remove()).resolves.toBeUndefined()
  await expect(setup('running', '/loser').remove()).rejects.toMatchObject({ status: 409 })
})
test.each(['/original', '/winner'])('released archived tests allow deleting, renaming and unpublishing %s', async path => {
  const f = setup('archived', path)
  f.payload.documents['xp-experiments']![0]!.decision = { winnerArm: 'variantA', pagesReleasedAt: '2026-11-03T00:00:00Z', pagesReleasedBy: '42' }
  await expect(f.remove()).resolves.toBeUndefined()
  await expect(f.save({ slug: 'renamed', _status: 'published' })).resolves.toBeDefined()
  await expect(f.save({ _status: 'draft' })).resolves.toBeDefined()
  expect(f.payload.calls.some(call => call.args.collection === 'xp-phases')).toBe(false)
})
test('collections without drafts protect path changes', async () => {
  await expect(setup('running', '/original', false, false).save({ slug: 'renamed' })).rejects.toMatchObject({ status: 409 })
})
test('a draft=true publish still changes the main row and is refused', async () => {
  await expect(setup().save({ slug: 'renamed', _status: 'published' }, true)).rejects.toMatchObject({ status: 409 })
})
test('SQL discovery errors propagate without swallowing them', async () => {
  const f = setup()
  f.req.transactionID = f.executor.withSession({ payload: f.payload }).transactionID
  const error = new Error('nested read failed')
  f.executor.query = async () => { delete f.req.transactionID; throw error }
  await expect(f.save({ _status: 'draft' })).rejects.toBe(error)
  expect(f.req.transactionID).toBeUndefined()
})
test('adapter errors propagate', async () => {
  const f = setup(), error = new Error('adapter read failed')
  f.read.mockRejectedValue(error)
  await expect(f.remove()).rejects.toBe(error)
})

test.each(['decided', 'archived'])('protects frozen paths after stopped edits then %s', async status => {
  const f = setup(status, '/winner')
  f.payload.documents['xp-experiments']![0]!.arms = [{ key: 'control', kind: 'control', pageTarget: '/edited-original' }, { key: 'variantA', pageTarget: '/edited-winner' }]
  await expect(f.remove()).rejects.toMatchObject({ status: 409 })
})

test('trash updates are deletes; restoring an already trashed page is allowed', async () => {
  const f = setup()
  await expect(f.save({ deletedAt: '2026-11-03', _status: 'published' })).rejects.toMatchObject({ status: 409 })
  await expect(f.save({ deletedAt: null, _status: 'published' })).resolves.toBeDefined()
  await expect(f.change({ deletedAt: '2026-11-04', _status: 'published' }, { ...f.published, deletedAt: '2026-11-03' })).resolves.toBeDefined()
  f.collection.trash = false
  await expect(f.save({ deletedAt: '2026-11-03', _status: 'published' })).resolves.toBeDefined()
})
test('partial publish compares the latest version merged with data', async () => {
  const f = setup()
  await expect(f.change({ _status: 'published' }, { ...f.published, slug: 'pending-rename' })).rejects.toMatchObject({ status: 409 })
})
test('nested same-collection operations restore the outer draft flag', async () => {
  const f = setup()
  await f.begin(true)
  f.req.context = { ...f.req.context } // createLocalReq's nested-operation copy
  await f.begin(false)
  await expect(f.change({ slug: 'renamed', _status: 'published' })).rejects.toMatchObject({ status: 409 })
  await f.end()
  await expect(f.change({ slug: 'outer-draft', _status: 'draft' })).resolves.toBeDefined()
  await f.end()
})
test('a nested draft by-id update pops its frame before the outer unpublish', async () => {
  const f = setup()
  await f.begin(false, 'update')
  f.req.context = { ...f.req.context }
  await f.begin(true, 'update')
  await expect(f.change({ title: 'Nested draft', _status: 'draft' })).resolves.toBeDefined()
  await f.end('updateByID')
  await expect(f.change({ _status: 'draft' })).rejects.toMatchObject({ status: 409 })
  await f.end('updateByID')
  const stacks = f.req.context.xpPageGuardOperations as Map<string, unknown[]>
  expect(stacks.get('pages') ?? []).toEqual([])
  expect(stacks.has('pages')).toBe(false)
})
test('an earlier draft op and legacy context cannot bypass a publishing restore', async () => {
  const f = setup()
  await f.save({ slug: 'renamed', _status: 'draft' }, true)
  f.req.context.xpPageGuardDrafts = { pages: true }
  await f.begin(false, 'restoreVersion')
  await expect(f.change({ slug: 'renamed', _status: 'draft' })).rejects.toMatchObject({ status: 409 })
  await f.end('restoreVersion')
  await f.begin(true, 'restoreVersion')
  await expect(f.change({ slug: 'renamed', _status: 'published' })).resolves.toBeDefined()
  await f.end('restoreVersion')
  await expect(f.change({ slug: 'renamed', _status: 'draft' })).rejects.toMatchObject({ status: 409 })
})
test('a missing test round is a public typed refusal', async () => {
  const f = setup()
  f.payload.documents['xp-phases'] = []
  await expect(f.save({ _status: 'draft' })).rejects.toMatchObject({ name: 'XpRefusal', code: 'invalid-phase', status: 409, isPublic: true })
})

test('with a transaction the guard takes E then page-path locks and rereads tests (CORE-54, KI-6)', async () => {
  const f = setup('running', '/original')
  const executor = f.executor
  const req = executor.withSession({ payload: f.payload })
  await expect(pageGuardBeforeDelete({ req, collection: f.collection, id: 1 } as Parameters<CollectionBeforeDeleteHook>[0])).rejects.toMatchObject({ status: 409 })
  const lock = executor.calls.find(call => call.text.includes("hashtext('xp:pagepath')"))
  expect(lock?.params).toEqual(['/original'])
})

test('an arm stored with a trailing slash protects the page the runtime routes to it', async () => {
  const f = setup('running', '/original')
  const test = f.payload.documents['xp-experiments']![0]! as unknown as { arms: Array<{ pageTarget?: string }> }
  const phase = f.payload.documents['xp-phases']![0]! as unknown as { arms: Array<{ pageTarget?: string }> }
  for (const arms of [test.arms, phase.arms]) for (const arm of arms) if (arm.pageTarget === '/original') arm.pageTarget = '/original/'
  await expect(f.remove()).rejects.toMatchObject({ status: 409 })
})


function blockSetup(status = 'running', drafts = true, editor: 'puck' | 'blocks' = 'puck') {
  const f = setup(status, '/unrelated', false, drafts)
  const options = f.payload.config.custom.xp as ReturnType<typeof sampleOptions>
  options.puck = { enabled: true, collections: ['pages'] }
  options.blocks = { collections: editor === 'blocks' ? [{ slug: 'pages', field: 'layout' }] : [] }
  const block = editor === 'puck' ? { type: 'ExperimentSlot', props: { experiment: { id: 2, slug: 'hero' }, control: [{}], variantA: [{}] } }
    : { blockType: 'xpExperiment', experiment: 'hero', slots: [] }
  const field = editor === 'puck' ? 'puckData' : 'layout'
  const content = (blocks: unknown[]) => editor === 'puck' ? { content: blocks } : blocks
  Object.assign(f.published, { [field]: content([block]) })
  f.payload.documents.pages = [f.published]
  Object.assign(f.payload.documents['xp-experiments']![0]!, { kind: 'block', slug: 'hero', name: 'Better hero' })
  f.payload.config.collections = [f.collection as unknown as import('payload').SanitizedCollectionConfig]
  f.req.transactionID = f.executor.withSession({ payload: f.payload }).transactionID
  const empty = { [field]: content([]) }
  return { ...f, empty, field, content, block, options }
}
const lastPlacementMessage = '“Better hero” is running and this is the only published place it appears. Stop the test, or keep its block on this page.'
const removePageMessage = '“Better hero” is running and this page is the only published place it appears. Stop the test first.'
const discoveries = (f: ReturnType<typeof blockSetup>) => f.executor.calls.filter(c => c.text.includes('ANY($1::text[])'))
const experimentLocks = (f: ReturnType<typeof blockSetup>) => f.executor.calls.filter(c => c.text.includes("hashtext('xp:experiment')"))

test.each(['puck', 'blocks'] as const)('%s publish refuses removing the only running published placement', async editor => {
  const f = blockSetup('running', true, editor)
  await expect(f.save({ ...f.empty, _status: 'published' })).rejects.toMatchObject({
    code: 'locked-placement', status: 409, isPublic: true, message: lastPlacementMessage,
  })
  expect(discoveries(f)).toHaveLength(0)
  expect(f.payload.calls).toHaveLength(1) // published only, collection registered under both editors once
  expect(f.payload.calls[0]!.args).toMatchObject({ overrideAccess: true, req: f.req, draft: false })
  expect(experimentLocks(f).map(c => c.params)).toEqual([['2']])
})
test.each(['draft', 'stopped', 'decided', 'archived'])('removing a %s block preserves baseline locks and never scans placements', async status => {
  const f = blockSetup(status)
  await expect(f.save({ ...f.empty, _status: 'published' })).resolves.toBeDefined()
  expect(discoveries(f)).toHaveLength(0)
  expect(experimentLocks(f).map(c => c.params)).toEqual([['2']]) // existing audit lock at 890e25a
  expect(f.executor.calls.filter(c => c.text.includes('LEFT JOIN LATERAL'))).toHaveLength(2)
  expect(f.payload.calls).toEqual([])
})
test.each(['empty page', 'keeps block', 'keeps another occurrence'])('%s publish adds zero discovery queries or find calls', async operation => {
  const f = blockSetup()
  if (operation === 'empty page') Object.assign(f.published, f.empty)
  if (operation === 'keeps another occurrence') Object.assign(f.published, { [f.field]: f.content([f.block, f.block]) })
  await expect(f.save({ ...(operation === 'keeps another occurrence' ? { [f.field]: f.content([f.block]) } : {}), _status: 'published' })).resolves.toBeDefined()
  expect(discoveries(f)).toEqual([])
  expect(f.payload.calls).toEqual([])
})
test.each(['published', 'draft'])('another %s placement counts only if published', async _status => {
  const f = blockSetup()
  f.payload.documents.pages!.push({ ...f.published, id: 9, _status })
  const save = f.save({ ...f.empty, _status: 'published' })
  if (_status === 'published') await expect(save).resolves.toBeDefined()
  else await expect(save).rejects.toMatchObject({ message: lastPlacementMessage })
})
test('another registered collection counts and search stops at its first hit', async () => {
  const f = blockSetup()
  f.options.puck!.collections.push('templates', 'unused')
  f.payload.documents.templates = [{ ...f.published, id: 10 }]
  await expect(f.save({ ...f.empty, _status: 'published' })).resolves.toBeDefined()
  expect(f.payload.calls.map(c => c.args.collection)).toEqual(['pages', 'templates'])
})
test.each(['draft save', 'autosave', 'draft restore'])('%s of any page preserves the pre-existing draft-only calls', async operation => {
  const f = blockSetup()
  await f.begin(true, operation === 'draft restore' ? 'restoreVersion' : 'update')
  await expect(f.change({ ...f.empty, _status: operation === 'draft restore' ? 'published' : 'draft' })).resolves.toBeDefined()
  expect(f.trace).toEqual([])
})
test.each(['unpublish', 'trash', 'delete'])('%s refuses the last published placement and permits another published placement', async operation => {
  const f = blockSetup()
  const write = () => operation === 'delete' ? f.remove() : f.save(operation === 'trash' ? { deletedAt: '2026-11-12' } : { _status: 'draft' })
  await expect(write()).rejects.toMatchObject({ message: removePageMessage })
  f.payload.documents.pages!.push({ ...f.published, id: 9 })
  if (operation === 'delete') await expect(write()).resolves.toBeUndefined()
  else await expect(write()).resolves.toBeDefined()
})
test.each(['publish restore', 'draft=true publish', 'no drafts save'])('%s cannot drop the last published block', async operation => {
  const f = blockSetup('running', operation !== 'no drafts save')
  const result = operation === 'publish restore' ? f.begin(false, 'restoreVersion').then(() => f.change({ ...f.empty, _status: 'published' }))
    : f.save({ ...f.empty, ...(operation === 'no drafts save' ? {} : { _status: 'published' }) }, operation === 'draft=true publish')
  await expect(result).rejects.toMatchObject({ message: lastPlacementMessage })
})
test('changing the binding protects the old running test', async () => {
  const f = blockSetup()
  await expect(f.save({ puckData: f.content([{ ...f.block, props: { experiment: { id: 8, slug: 'other' } } }]), _status: 'published' })).rejects.toMatchObject({ message: lastPlacementMessage })
})
test('delete of an unpublished document is allowed, even without a page registration', async () => {
  const f = blockSetup()
  f.options.pages = undefined
  f.read.mockResolvedValue({ ...f.published, _status: 'draft' } as typeof f.published)
  Object.assign(f.payload.db, { findVersions: vi.fn(async () => ({ docs: [] })) })
  await expect(f.remove()).resolves.toBeUndefined()
  expect(discoveries(f)).toEqual([])
  expect(f.payload.calls).toEqual([])
})
test('without a transaction the earlier live publish guard and the new last-removal guard both fail closed', async () => {
  const f = blockSetup()
  delete f.req.transactionID
  await expect(f.save({ _status: 'published' })).rejects.toMatchObject({ name: 'XpNoTransactionError' })
  expect(discoveries(f)).toEqual([])
  expect(f.payload.calls).toEqual([])
  await expect(f.save({ ...f.empty, _status: 'published' })).rejects.toMatchObject({ name: 'XpNoTransactionError' })
  await expect(f.remove()).rejects.toMatchObject({ name: 'XpNoTransactionError' })
})
test.each(['create', 'duplicate'])('%s is never refused by the removal rule', async () => {
  const f = blockSetup()
  await expect(pageGuardBeforeChange({ req: f.req, context: f.req.context, collection: f.collection, operation: 'create', data: f.published } as unknown as Parameters<CollectionBeforeChangeHook>[0])).resolves.toBeDefined()
  expect(discoveries(f)).toEqual([])
  expect(f.payload.calls).toEqual([])
})
test('search finds a published placement past the first hundred rows', async () => {
  const f = blockSetup()
  f.payload.documents.pages = [...Array.from({ length: 101 }, (_, i) => ({ id: i + 10, _status: 'published', ...f.empty })), { ...f.published, id: 999 }]
  await expect(f.save({ ...f.empty, _status: 'published' })).resolves.toBeDefined()
  expect(f.payload.calls.map(c => c.args.page)).toEqual([1, 2])
})
test.each(['delete', 'update'])('bulk %s of both last placements refuses both in one transaction; one removal is allowed', async operation => {
  const f = blockSetup()
  const other = { ...f.published, id: 9 }
  f.payload.documents.pages!.push(other)
  f.read.mockImplementation(async args => ((args as unknown as { where: { id: { equals: number } } }).where.id.equals === 9 ? other : f.published))
  await f.begin()
  const secondReq = { ...f.req, context: { ...f.req.context } }
  const remove = (req: typeof f.req, originalDoc: typeof other) => operation === 'delete'
    ? pageGuardBeforeDelete({ req, collection: f.collection, id: originalDoc.id } as Parameters<CollectionBeforeDeleteHook>[0])
    : pageGuardBeforeChange({ req, context: req.context, collection: f.collection, originalDoc, operation: 'update', data: { ...f.empty, _status: 'published' } } as unknown as Parameters<CollectionBeforeChangeHook>[0])
  const results = await Promise.allSettled([remove(f.req, f.published), remove(secondReq, other)])
  expect(results.map(r => r.status)).toEqual(['rejected', 'rejected'])
  for (const result of results) if (result.status === 'rejected') expect(result.reason).toMatchObject({ code: 'locked-placement' })
  for (const result of results) if (result.status === 'rejected') expect(result.reason.message).toBe(pendingBlockRemovalCopy('Better hero'))
  f.req.transactionID = f.executor.withSession({ payload: f.payload, transactionID: 'next-transaction' }).transactionID
  if (operation === 'delete') await expect(remove(f.req, f.published)).resolves.toBeUndefined()
  else await expect(remove(f.req, f.published)).resolves.toBeDefined()
})
test('placement read errors propagate without continuing after a nested transaction failure', async () => {
  const f = blockSetup(), cause = new Error('placement read failed')
  f.payload.find = vi.fn(async () => { delete f.req.transactionID; throw cause })
  await expect(f.save({ ...f.empty, _status: 'published' })).rejects.toBe(cause)
})

test.each(['delete', 'trash', 'publish'])('an already trashed row is not a published placement during %s', async operation => {
  const f = blockSetup()
  Object.assign(f.published, { deletedAt: '2026-11-10' })
  const write = operation === 'delete' ? f.remove() : f.save(operation === 'trash' ? { deletedAt: '2026-11-12' } : { ...f.empty, _status: 'published' })
  if (operation === 'delete') await expect(write).resolves.toBeUndefined()
  else await expect(write).resolves.toBeDefined()
  expect(discoveries(f)).toEqual([])
  expect(f.payload.calls).toEqual([])
})
test('trashing a never-published draft adds no removal lookup, lock or scan', async () => {
  const f = blockSetup()
  Object.assign(f.published, { _status: 'draft' })
  Object.assign(f.payload.db, { findVersions: vi.fn(async () => ({ docs: [] })) })
  await expect(f.save({ deletedAt: '2026-11-12' })).resolves.toBeDefined()
  expect(discoveries(f)).toEqual([])
  expect(experimentLocks(f).map(c => c.params)).toEqual([['2']]) // baseline audit superset includes incoming tags
  expect(f.payload.calls).toEqual([])
})
test.each(['no block', 'archived', 'decided'])('delete outside page registration stops after discovery for %s', async state => {
  const f = blockSetup(state === 'no block' ? 'running' : state)
  f.options.pages = undefined
  if (state === 'no block') Object.assign(f.published, f.empty)
  await expect(f.remove()).resolves.toBeUndefined()
  expect(f.read).toHaveBeenCalledTimes(1)
  expect(discoveries(f)).toHaveLength(state === 'no block' ? 0 : 1)
  expect(f.executor.calls.filter(c => !c.text.includes('ANY($1::text[])'))).toEqual([])
  expect(f.payload.calls).toEqual([])
})
test.each(['draft', 'stopped'])('removal rechecks a %s test after waiting for Start on E', async status => {
  const f = blockSetup(status)
  f.options.pages = undefined // no pre-existing page locks: serialization is still required
  const query = f.executor.query.bind(f.executor)
  f.executor.query = async <R>(text: string, params: unknown[] = []) => {
    if (text.includes("hashtext('xp:experiment')")) {
      // Mock Start owning E when removal arrives, then committing running before
      // the waiting removal gets E. The discovery result must not decide refusal.
      f.payload.documents['xp-experiments']![0]!.status = 'running'
    }
    return query<R>(text, params)
  }
  await expect(f.save({ ...f.empty, _status: 'published' })).rejects.toMatchObject({ message: lastPlacementMessage })
  expect(experimentLocks(f).map(c => c.params)).toEqual([['2']])
  expect(f.executor.calls.filter(c => c.text.includes('LEFT JOIN LATERAL'))).toHaveLength(2)
  expect(f.payload.calls).toHaveLength(1)
})


test('republishing a removed binding clears its claim before another placement is removed in the same transaction', async () => {
  const f = blockSetup()
  const other = { ...f.published, id: 9 }
  f.payload.documents.pages!.push(other)
  await f.save({ ...f.empty, _status: 'published' })
  Object.assign(f.published, f.empty) // first host write
  await pageGuardAfterChange({ req: f.req, collection: f.collection, doc: f.published } as never)
  await f.save({ [f.field]: f.content([f.block]), _status: 'published' })
  Object.assign(f.published, { [f.field]: f.content([f.block]) }) // re-publish host write
  await pageGuardAfterChange({ req: f.req, collection: f.collection, doc: f.published } as never)
  f.read.mockResolvedValue(other)
  await expect(f.change({ ...f.empty, _status: 'published' }, other)).resolves.toBeDefined()
})


test('delete outside page registration locks only removal candidates and never performs broad discovery', async () => {
  const f = blockSetup()
  f.options.pages = undefined
  f.payload.documents['xp-experiments']!.push({ id: 99, slug: 'irrelevant', kind: 'block', status: 'decided' })
  Object.assign(f.published, { unrelatedTag: { experiment: '99', arm: 'control' } })
  f.payload.documents.pages!.push({ ...f.published, id: 9 })
  await expect(f.remove()).resolves.toBeUndefined()
  expect(f.read).toHaveBeenCalledTimes(1)
  expect(discoveries(f)).toHaveLength(2) // discovery and authoritative under-E status recheck
  expect(f.executor.calls.some(c => c.text.includes('LEFT JOIN LATERAL'))).toBe(false)
  expect(experimentLocks(f).map(c => c.params)).toEqual([['2']])
  expect(f.payload.calls).toHaveLength(1)
})


test.each(['draft save', 'autosave', 'create', 'duplicate', 'publish keeping block'])('%s has exactly the same DB/lock sequence with the removal entry point disabled', async operation => {
  const discover = vi.spyOn(blockRemovalRule, 'discover')
  const check = vi.spyOn(blockRemovalRule, 'check')
  const claim = vi.spyOn(blockRemovalRule, 'claim')
  const search = vi.spyOn(placements, 'hasOtherPublishedBlockPlacement')
  const run = async () => {
    const f = blockSetup()
    if (operation === 'create' || operation === 'duplicate') {
      await pageGuardBeforeChange({ req: f.req, collection: f.collection, operation: 'create', data: f.published } as never)
    } else await f.save({ _status: operation === 'publish keeping block' ? 'published' : 'draft' }, operation !== 'publish keeping block')
    return { trace: f.trace, localAPI: f.payload.calls }
  }
  const enabled = await run()
  expect(discover).not.toHaveBeenCalled()
  expect(check).not.toHaveBeenCalled()
  expect(claim).not.toHaveBeenCalled()
  expect(search).not.toHaveBeenCalled()
  discover.mockResolvedValue([]) // rule entry point off; all earlier guards still run
  const disabled = await run()
  expect(enabled).toEqual(disabled)
})

test.each(['draft', 'stopped', 'running'])('without transactions %s removal preserves its earlier refusals only', async status => {
  for (const registered of [true, false]) for (const operation of ['publish', 'unpublish', 'trash', 'delete']) {
    const f = blockSetup(status)
    if (!registered) f.options.pages = undefined
    delete f.req.transactionID
    const work = operation === 'delete' ? f.remove() : f.save(operation === 'publish' ? { ...f.empty, _status: 'published' }
      : operation === 'unpublish' ? { _status: 'draft' } : { ...f.empty, deletedAt: '2026-11-12' })
    if (status === 'running') await expect(work).rejects.toMatchObject({ name: 'XpNoTransactionError', message: 'Save this page with transactions on.' })
    else if (operation === 'delete') await expect(work).resolves.toBeUndefined()
    else await expect(work).resolves.toBeDefined()
  }
})

test('without transactions a running removal with another published placement is allowed', async () => {
  const f = blockSetup()
  delete f.req.transactionID
  f.payload.documents.pages!.push({ ...f.published, id: 9 })
  await expect(f.save({ ...f.empty, _status: 'published' })).resolves.toBeDefined()
  await expect(f.remove()).resolves.toBeUndefined()
})

test('a non-draft restore of a draft version unpublishes the main row and protects its last placement', async () => {
  const f = blockSetup()
  await f.begin(false, 'restoreVersion')
  await expect(f.change({ ...f.empty, _status: 'draft' })).rejects.toMatchObject({ message: removePageMessage })
})

test('an earlier path refusal makes no removal claim; a sibling can still use the published row', async () => {
  const f = blockSetup()
  const other = { ...f.published, id: 9, slug: 'other' }
  f.payload.documents.pages!.push(other)
  f.payload.documents['xp-experiments']!.push({ id: 8, name: 'Page test', kind: 'page', status: 'running' })
  f.payload.documents['xp-phases']!.push({ id: 99, experiment: 8, arms: [{ key: 'control', pageTarget: '/unrelated' }] })
  const claim = vi.spyOn(blockRemovalRule, 'claim')
  await expect(f.save({ ...f.empty, _status: 'draft' })).rejects.toMatchObject({ message: expect.stringContaining('Page test') })
  expect(claim).not.toHaveBeenCalled()
  f.read.mockResolvedValue(other)
  await expect(f.change({ ...f.empty, _status: 'published' }, other)).resolves.toBeDefined()
})

test('a later validation failure is conservative until bulk afterOperation clears failed claims; retry succeeds in the same transaction', async () => {
  const f = blockSetup()
  const other = { ...f.published, id: 9 }
  f.payload.documents.pages!.push(other)
  await f.begin()
  await f.change({ ...f.empty, _status: 'published' }) // beforeChange passed; later validation fails, so A stays published
  f.read.mockResolvedValue(other)
  await expect(f.change({ ...f.empty, _status: 'published' }, other)).rejects.toMatchObject({ message: pendingBlockRemovalCopy('Better hero') })
  await pageGuardAfterOperation({ req: f.req, collection: f.collection, operation: 'update', result: { docs: [], errors: [{ id: 1 }, { id: 9 }] } } as never)
  await expect(f.change({ ...f.empty, _status: 'published' }, other)).resolves.toBeDefined()
})

test('a failed placement scan releases its claim before a sibling retries', async () => {
  const f = blockSetup()
  f.payload.documents.pages!.push({ ...f.published, id: 9 })
  const find = f.payload.find.bind(f.payload)
  f.payload.find = vi.fn().mockRejectedValueOnce(new Error('scan failed')).mockImplementation(find)
  await expect(f.save({ ...f.empty, _status: 'published' })).rejects.toThrow('scan failed')
  const claims = f.req.context.xpPlacementRemovals as { tests: Map<string, Set<string>> }
  expect([...claims.tests.values()].flatMap(documents => [...documents])).toEqual([])
  await expect(f.save({ ...f.empty, _status: 'published' })).resolves.toBeDefined()
})


test.each(['puck', 'blocks'] as const)('localized %s removal discovers the same request locale as Start, including fallback', async editor => {
  for (const locale of ['en', 'fr']) for (const fallback of ['null', 'fr']) {
    const f = blockSetup('running', true, editor)
    Object.assign(f.payload.config, { localization: { defaultLocale: 'en', localeCodes: ['en', 'fr'], locales: [{ code: 'en' }, { code: 'fr' }], fallback: true } })
    f.payload.config.collections[0]!.fields = [{ name: f.field, type: 'json', localized: true }]
    f.req.locale = locale
    f.req.fallbackLocale = fallback
    Object.assign(f.published, { [f.field]: { en: null, fr: f.content([f.block]) } })
    const work = f.save({ ...f.empty, _status: 'published' })
    if (locale === 'fr') await expect(work).rejects.toMatchObject({ message: expect.stringContaining('only published place it appears in this language (') })
    else await expect(work).resolves.toBeDefined()
    expect(discoveries(f)).toEqual([])
  }
})


test.each(['delete', 'trash', 'unpublish'])('localized %s through the default language still protects the only French placement', async operation => {
  const f = blockSetup()
  Object.assign(f.payload.config, { localization: { defaultLocale: 'en', localeCodes: ['en', 'fr'], locales: [{ code: 'en' }, { code: 'fr' }], fallback: true } })
  f.payload.config.collections[0]!.fields = [{ name: f.field, type: 'json', localized: true }]
  f.req.locale = 'en'
  f.req.fallbackLocale = 'null'
  Object.assign(f.published, { [f.field]: { en: f.content([]), fr: f.content([f.block]) } })
  const work = operation === 'delete' ? f.remove() : f.save(operation === 'trash' ? { deletedAt: '2026-11-12' } : { _status: 'draft' })
  await expect(work).rejects.toMatchObject({ code: 'locked-placement', message: expect.stringContaining('in this language (fr)') })
})

test('publishing a retained English binding does not clear the French removal claim', async () => {
  const f = blockSetup()
  Object.assign(f.payload.config, { localization: { defaultLocale: 'en', localeCodes: ['en', 'fr'], locales: [{ code: 'en' }, { code: 'fr' }], fallback: true } })
  f.payload.config.collections[0]!.fields = [{ name: f.field, type: 'json', localized: true }]
  f.req.locale = 'fr'; f.req.fallbackLocale = 'null'
  Object.assign(f.published, { [f.field]: { en: f.content([f.block]), fr: f.content([f.block]) } })
  f.payload.documents.pages!.push({ ...f.published, id: 9, [f.field]: f.content([f.block]) })
  await f.save({ ...f.empty, _status: 'published' })
  Object.assign(f.published, { [f.field]: { en: f.content([f.block]), fr: f.content([]) } })
  await pageGuardAfterChange({ req: f.req, collection: f.collection, doc: f.published } as never)
  const claims = f.req.context.xpPlacementRemovals as { tests: Map<string, Set<string>> }
  expect([...claims.tests.get('2')!].map(key => JSON.parse(key)[2].locale)).toEqual(['fr'])
})


test('an edit with fallback disabled still protects another language inheriting that content by default', async () => {
  const f = blockSetup()
  Object.assign(f.payload.config, { localization: { defaultLocale: 'en', localeCodes: ['en', 'fr'], locales: [{ code: 'en' }, { code: 'fr' }], fallback: true } })
  f.payload.config.collections[0]!.fields = [{ name: f.field, type: 'json', localized: true }]
  f.req.locale = 'en'; f.req.fallbackLocale = 'null'
  Object.assign(f.published, { [f.field]: { en: f.content([f.block]), fr: null } })
  const other = { ...f.published, id: 9, [f.field]: { en: f.content([f.block]), fr: f.content([]) } }
  f.payload.find = vi.fn(async (args: Parameters<typeof f.payload.find>[0]) => ({ docs: [{ ...other, [f.field]: (args.req as { locale?: string })?.locale === 'fr' ? f.content([]) : f.content([f.block]) }], hasNextPage: false }) as never)
  await expect(f.save({ ...f.empty, _status: 'published' })).rejects.toMatchObject({ message: expect.stringContaining('in this language (fr)') })
})

test('same-transaction whole-row removals with different fallback policies see each other', async () => {
  const f = blockSetup()
  Object.assign(f.payload.config, { localization: { defaultLocale: 'en', localeCodes: ['en', 'fr'], locales: [{ code: 'en' }, { code: 'fr' }], fallback: true } })
  f.payload.config.collections[0]!.fields = [{ name: f.field, type: 'json', localized: true }]
  f.req.locale = 'en'; f.req.fallbackLocale = 'null'
  Object.assign(f.published, { [f.field]: { en: f.content([f.block]), fr: f.content([f.block]) } })
  const other = { ...f.published, id: 9 }
  await f.begin()
  f.read.mockImplementation(async args => (args as { where: { id: { equals: number } } }).where.id.equals === 9 ? other : f.published)
  f.payload.find = vi.fn(async (args: Parameters<typeof f.payload.find>[0]) => ({ docs: [f.published, other].map(doc => ({ ...doc, [f.field]: f.content([f.block]) })), hasNextPage: false }) as never)
  const req = { ...f.req, context: { ...f.req.context }, fallbackLocale: 'en' }
  const results = await Promise.allSettled([f.remove(), pageGuardBeforeDelete({ req, collection: f.collection, id: 9 } as never)])
  expect(results.every(result => result.status === 'rejected')).toBe(true)
  for (const result of results) if (result.status === 'rejected') expect(result.reason).toMatchObject({ message: pendingBlockRemovalCopy('Better hero') })
})


test('a retained language cannot clear another language removal before that write reaches afterChange', async () => {
  const f = blockSetup()
  Object.assign(f.payload.config, { localization: { defaultLocale: 'en', localeCodes: ['en', 'fr'], locales: [{ code: 'en' }, { code: 'fr' }], fallback: true } })
  f.payload.config.collections[0]!.fields = [{ name: f.field, type: 'json', localized: true }]
  Object.assign(f.published, { [f.field]: { en: f.content([f.block]), fr: f.content([f.block]) } })
  f.payload.find = vi.fn(async () => ({ docs: [{ ...f.published, id: 9, [f.field]: f.content([f.block]) }], hasNextPage: false }) as never)
  f.req.locale = 'en'
  await f.save({ ...f.empty, _status: 'published' }) // pending en removal, before its main-row write
  const frenchReq = { ...f.req, context: { ...f.req.context }, locale: 'fr' }
  await pageGuardBeforeChange({ req: frenchReq, collection: f.collection, originalDoc: f.published, operation: 'update', data: { ...f.empty, _status: 'published' } } as never)
  Object.assign(f.published, { [f.field]: { en: f.content([f.block]), fr: f.content([]) } })
  await pageGuardAfterChange({ req: frenchReq, collection: f.collection, doc: f.published } as never)
  const claims = f.req.context.xpPlacementRemovals as { tests: Map<string, Set<string>> }
  expect([...claims.tests.get('2')!].map(key => JSON.parse(key)[2].locale).sort()).toEqual(['en', 'fr'])
})
