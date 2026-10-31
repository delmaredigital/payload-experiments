import type { CollectionAfterChangeHook } from 'payload'
import { afterEach, expect, test, vi } from 'vitest'
import { contentChangesHook } from '../../src/hooks/contentChanges.js'
import { recordContentChange } from '../../src/server/recordContentChange.js'
import { createFakeExecutor } from '../_fakes/executor.js'
import { fakePayload } from '../_fakes/payload.js'
import { sampleOptions } from '../collections/fixtures.js'

afterEach(() => vi.restoreAllMocks())
const slot = (text = 'Old', experiment: unknown = { id: 'exp', slug: 'hero' }) => ({ type: 'ExperimentSlot', props: { id: 'slot', experiment, control: [{ type: 'Text', props: { text } }], variantA: [] } })
function setup({ status = 'running', field = 'puckData', bound = true } = {}) {
  const executor = createFakeExecutor()
  const state = { status, phase: 3 }
  const query = executor.query.bind(executor)
  vi.spyOn(executor, 'query').mockImplementation(async <R>(text: string, params?: unknown[]) => {
    const result = await query<R>(text, params)
    if (text.includes("current_setting('lock_timeout')")) return { rows: [{ timeout: '5s' }] as R[], rowCount: 1 }
    if (text.startsWith('SELECT') && text.includes('FROM')) {
      const rows = state.status === 'running' ? [{ id: 'exp', phase: state.phase }] : []
      return { rows: rows as R[], rowCount: rows.length }
    }
    return text.startsWith('UPDATE') ? { ...result, rowCount: 1 } : result
  })
  const options = sampleOptions()
  options.puck = { enabled: true, collections: [{ slug: 'pages', field }] }
  const payload = fakePayload({ executor, config: { custom: { xp: options } }, collections: {
    'xp-experiments': [{ id: 'exp', slug: 'hero', status, phase: 3 }],
  } })
  const req = executor.withSession({ payload })
  req.user = { id: 5 } as typeof req.user
  const previousDoc = { id: 1, [field]: { content: [slot('Old', bound ? 'hero' : null)] } }
  const doc = { id: 1, [field]: { content: [slot('New', bound ? 'hero' : null)] } }
  const args = { req, doc, previousDoc, collection: { slug: 'pages' } } as Parameters<CollectionAfterChangeHook>[0]
  return { executor, payload, args, state }
}
test.each(['puckData', 'content'])('changed running slot in %s appends once under lock E on the host transaction without a bump', async field => {
  const { args, executor, payload } = setup({ field })
  const transaction = args.req.transactionID
  expect(await contentChangesHook(args)).toBe(args.doc)
  const locks = executor.calls.filter(call => call.text.includes('pg_advisory_xact_lock'))
  expect(locks).toHaveLength(1)
  expect(locks[0]!.text).toContain("hashtext('xp:experiment')")
  expect(locks[0]!.params).toEqual(['exp'])
  const appends = executor.calls.filter(call => call.text.startsWith('UPDATE'))
  expect(appends).toHaveLength(1)
  const [entry] = JSON.parse(appends[0]!.params[0] as string)
  expect(entry).toEqual({ at: expect.any(String), doc: { collection: 'pages', id: 1 }, by: 5 })
  expect(Number.isFinite(Date.parse(entry.at))).toBe(true)
  expect(appends[0]!.params.slice(1)).toEqual(['exp', 3])
  expect(args.req.transactionID).toBe(transaction)
  expect(payload.dbCalls).toEqual([])
  expect(payload.calls).toEqual([])
})
test.each(['draft', 'stopped', 'decided', 'archived'])('%s experiments get no marker', async status => {
  const { args, executor } = setup({ status })
  await recordContentChange(args)
  expect(executor.calls.some(call => call.text.startsWith('UPDATE'))).toBe(false)
})
test('unchanged content, property reordering, and edits outside slots do nothing', async () => {
  const { args, executor, payload } = setup()
  args.doc = { ...structuredClone(args.previousDoc), title: 'New title', updatedAt: 'now' }
  args.doc.puckData.content[0].props = { variantA: [], control: [{ props: { text: 'Old' }, type: 'Text' }], experiment: 'hero', id: 'slot' }
  await recordContentChange(args)
  expect(executor.calls).toEqual([])
  expect(payload.calls).toEqual([])
})
test('unbound slots produce no lookups or appends', async () => {
  const { args, executor, payload } = setup({ bound: false })
  await recordContentChange(args)
  expect(executor.calls).toEqual([])
  expect(payload.calls).toEqual([])
})
test.each(['draft', 'autosave'])('host %s saves produce no audit reads or markers', async status => {
  const { args, executor } = setup()
  args.collection.versions = { drafts: {} } as typeof args.collection.versions
  args.doc._status = 'draft'
  if (status === 'autosave') args.req.context.autosave = true
  await recordContentChange(args)
  expect(executor.calls).toEqual([])
})
function publishedVersions(args: Parameters<CollectionAfterChangeHook>[0], published: unknown) {
  const read = vi.fn(async () => ({ docs: [{ id: 3, version: args.doc }, ...(published ? [{ id: 1, version: published }] : [])] }))
  Object.assign(args.req.payload.db, { findVersions: read })
  args.collection.versions = { drafts: {} } as typeof args.collection.versions
  return read
}
test.each(['puckData', 'content'])('autosave then publish without further edits appends once using the previous published %s', async field => {
  const { args, executor } = setup({ field })
  const published = structuredClone(args.previousDoc)
  const read = publishedVersions(args, published)
  args.doc._status = 'draft'
  args.req.context.autosave = true
  await contentChangesHook(args)
  expect(executor.calls).toEqual([])
  expect(read).not.toHaveBeenCalled()
  args.previousDoc = structuredClone(args.doc) // Payload's latest version is the autosaved draft.
  args.doc._status = 'published'
  delete args.req.context.autosave
  await contentChangesHook(args)
  expect(executor.calls.filter(call => call.text.startsWith('UPDATE'))).toHaveLength(1)
  expect(read).toHaveBeenCalledWith(expect.objectContaining({ collection: 'pages', req: args.req, limit: 2, sort: ['-updatedAt', '-id'], where: { and: [{ parent: { equals: 1 } }, { 'version._status': { equals: 'published' } }] } }))
})
test('publish of unchanged content ignores the latest draft previousDoc', async () => {
  const { args, executor } = setup()
  publishedVersions(args, structuredClone(args.doc))
  args.previousDoc = { id: 1, puckData: { content: [slot('Different draft')] } }
  args.doc._status = 'published'
  await recordContentChange(args)
  expect(executor.calls.some(call => call.text.startsWith('UPDATE'))).toBe(false)
})
test('multiple changed slots bound to one experiment append one marker', async () => {
  const { args, executor } = setup()
  args.doc.puckData.content.push({ ...slot('Another'), props: { ...slot('Another').props, id: 'slot-2' } })
  await recordContentChange(args)
  expect(executor.calls.filter(call => call.text.startsWith('UPDATE'))).toHaveLength(1)
})
test('slot removal counts as a change to its previous binding', async () => {
  const { args, executor } = setup()
  args.doc.puckData.content = []
  await recordContentChange(args)
  expect(executor.calls.filter(call => call.text.startsWith('UPDATE'))).toHaveLength(1)
})
test('a stop that wins the experiment lock prevents the append', async () => {
  const { args, executor, state } = setup()
  const query = vi.mocked(executor.query).getMockImplementation()! as typeof executor.query
  vi.spyOn(executor, 'query').mockImplementation(async <R>(text: string, params?: unknown[]) => {
    if (text.includes('pg_advisory_xact_lock')) state.status = 'stopped'
    return query<R>(text, params)
  })
  await recordContentChange(args)
  expect(executor.calls.some(call => call.text.startsWith('UPDATE'))).toBe(false)
})
test('the non-Puck helper compares content in rows carrying arm-select tags', async () => {
  const { args, executor } = setup()
  args.collection.slug = 'asks'
  const tag = { experiment: 'exp', arm: 'variantA' }
  args.previousDoc = { id: 1, vars: [{ experimentArm: tag, blocks: [{ text: 'Old' }] }] }
  args.doc = { id: 1, vars: [{ experimentArm: tag, blocks: [{ text: 'New' }] }] }
  await recordContentChange(args)
  expect(executor.calls.filter(call => call.text.startsWith('UPDATE'))).toHaveLength(1)
  expect(JSON.parse(executor.calls.find(call => call.text.startsWith('UPDATE'))!.params[0] as string)[0].doc).toEqual({ collection: 'asks', id: 1 })
  executor.calls.length = 0
  args.previousDoc = structuredClone(args.doc)
  args.doc.title = 'Unrelated'
  await recordContentChange(args)
  expect(executor.calls).toEqual([])
})
test('explicit calls propagate discovery errors; installed hook returns the saved doc', async () => {
  const { args, executor } = setup()
  const error = new Error('lookup unavailable')
  const query = vi.mocked(executor.query).getMockImplementation()! as typeof executor.query
  vi.spyOn(executor, 'query').mockImplementation(async <R>(text: string, params?: unknown[]) => {
    if (text.startsWith('SELECT')) throw error
    return query<R>(text, params)
  })
  const report = vi.spyOn(console, 'error').mockImplementation(() => {})
  await expect(recordContentChange(args)).rejects.toBe(error)
  expect(await contentChangesHook(args)).toBe(args.doc)
  expect(report).toHaveBeenCalledWith('[payload-experiments] contentChanges failed; the document was saved without it', error)
})
test.each(['lock', 'append', 'under-lock read'])('%s failure is recovered before the hook reports a lost marker', async stage => {
  const { args, executor, payload } = setup()
  const error = new Error('audit unavailable')
  const query = vi.mocked(executor.query).getMockImplementation()! as typeof executor.query
  let reads = 0
  vi.spyOn(executor, 'query').mockImplementation(async <R>(text: string, params?: unknown[]) => {
    if (text.startsWith('SELECT') && text.includes('FROM')) reads++
    if (stage === 'lock' && text.includes('pg_advisory_xact_lock') || stage === 'append' && text.startsWith('UPDATE') || stage === 'under-lock read' && reads === 2 && text.includes('FROM')) throw error
    return query<R>(text, params)
  })
  const report = vi.spyOn(console, 'error').mockImplementation(() => {})
  const transaction = args.req.transactionID
  expect(await contentChangesHook(args)).toBe(args.doc)
  expect(args.req.transactionID).toBe(transaction)
  expect(payload.dbCalls).toEqual([])
  expect(executor.calls.filter(call => call.text === 'ROLLBACK TO SAVEPOINT xp_content_change')).toHaveLength(2)
  expect(report).toHaveBeenCalledWith('[payload-experiments] contentChanges failed; the document was saved without it', error)
})

test('a held experiment lock times out at 2s, skips the marker, logs and preserves the host transaction', async () => {
  const { args, executor, payload } = setup()
  const query = vi.mocked(executor.query).getMockImplementation()! as typeof executor.query
  let timeout = '5s'
  const heldLocks = new Set(['exp'])
  const error = Object.assign(new Error('canceling statement due to lock timeout'), { code: '55P03' })
  vi.spyOn(executor, 'query').mockImplementation(async <R>(text: string, params?: unknown[]) => {
    if (text.includes("set_config('lock_timeout', '2s'")) timeout = '2s'
    if (text.includes('pg_advisory_xact_lock') && heldLocks.has(String(params?.[0]))) {
      expect(timeout).toBe('2s')
      throw error
    }
    return query<R>(text, params)
  })
  const report = vi.spyOn(console, 'error').mockImplementation(() => {})
  const transaction = args.req.transactionID
  expect(await contentChangesHook(args)).toBe(args.doc)
  expect(executor.calls.some(call => call.text.startsWith('UPDATE'))).toBe(false)
  expect(args.req.transactionID).toBe(transaction)
  expect(payload.dbCalls).toEqual([])
  expect(report).toHaveBeenCalledExactlyOnceWith('[payload-experiments] contentChanges failed; the document was saved without it', error)
})
