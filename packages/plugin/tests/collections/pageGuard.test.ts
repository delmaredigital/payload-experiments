import type { CollectionAfterOperationHook, CollectionBeforeChangeHook, CollectionBeforeDeleteHook, CollectionBeforeOperationHook } from 'payload'
import { describe, expect, test, vi } from 'vitest'
import { pageGuardAfterOperation, pageGuardBeforeChange, pageGuardBeforeDelete, pageGuardBeforeOperation } from '../../src/hooks/pageGuard.js'
import { pageGuardCopy } from '../../src/admin/copy/readiness.js'
import { fakePayload } from '../_fakes/payload.js'
import { fakeReq } from '../_fakes/req.js'
import { sampleOptions } from './fixtures.js'

function setup(status = 'running', path = '/original', discarded = false, drafts = true) {
  const options = sampleOptions()
  const findByPath = vi.fn()
  options.pages = { collections: [{ slug: 'pages', pathOf: doc => typeof doc.slug === 'string' ? `/${doc.slug}` : null, findByPath }] }
  const payload = fakePayload({ config: { custom: { xp: options } }, collections: { 'xp-experiments': [{
    id: 2, name: 'Better page', kind: 'page', status,
    arms: [{ key: 'control', kind: 'control', pageTarget: '/original' }, { key: 'variantA', kind: 'variant', pageTarget: '/winner' }, { key: 'variantB', kind: 'variant', pageTarget: '/loser' }],
    decision: status === 'archived' ? { winnerArm: 'variantA', discardedAt: discarded ? '2026-11-03' : null } : undefined,
  }], 'xp-phases': [{ id: 3, experiment: 2, phaseKind: 'test', phase: 1,
    arms: [{ key: 'control', kind: 'control', pageTarget: '/original' }, { key: 'variantA', kind: 'variant', pageTarget: '/winner' }, { key: 'variantB', kind: 'variant', pageTarget: '/loser' }],
  }] } })
  const published = { id: 1, slug: path.slice(1), ...(drafts ? { _status: 'published' } : {}) }
  const read = vi.fn(async () => published)
  Object.assign(payload.db, { findOne: read })
  const req = fakeReq({ payload })
  const collection = { trash: true, slug: 'pages', versions: drafts ? { drafts: {} } : false }
  const remove = () => pageGuardBeforeDelete({ req, collection, id: 1 } as Parameters<CollectionBeforeDeleteHook>[0])
  const begin = async (draft = false, operation: 'update' | 'restoreVersion' = 'update') => pageGuardBeforeOperation({ args: { req, draft, collection: { config: collection } }, operation } as Parameters<CollectionBeforeOperationHook>[0])
  const end = async (operation: 'update' | 'updateByID' | 'restoreVersion' = 'updateByID') => pageGuardAfterOperation({ req, collection, operation, result: {} } as Parameters<CollectionAfterOperationHook>[0])
  const change = (data: Record<string, unknown>, originalDoc: Record<string, unknown> = published) => pageGuardBeforeChange({ req, collection, originalDoc, operation: 'update', data } as Parameters<CollectionBeforeChangeHook>[0])
  const save = async (data: Record<string, unknown>, draft = false) => {
    await begin(draft)
    try { return await change(data) } finally { await end() }
  }
  return { payload, req, published, read, remove, save, findByPath, collection, begin, end, change }

}

for (const status of ['running', 'decided', 'archived']) {
  for (const path of ['/original', '/winner']) {
    describe(`${status} ${path}`, () => {
      test('refuses delete of the published main row', async () => {
        const f = setup(status, path)
        await expect(f.remove()).rejects.toMatchObject({ status: 409, isPublic: true, message: pageGuardCopy('Better page', status as 'running' | 'decided' | 'archived') })
        expect(f.read).toHaveBeenCalledWith(expect.objectContaining({ collection: 'pages', req: f.req, where: { id: { equals: 1 } } }))
        expect(f.payload.calls[0]!.args).toMatchObject({ req: f.req, overrideAccess: true })
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
test('never swallows a nested state-read error or restores its killed transaction', async () => {
  const f = setup()
  f.req.transactionID = 'host-transaction'
  const error = new Error('nested read failed')
  vi.spyOn(f.payload, 'find').mockImplementation(async () => { delete f.req.transactionID; throw error })
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
