import { safeError } from '../../src/log.js'
import type { CollectionAfterChangeHook, Field } from 'payload'
import { afterEach, expect, test, vi } from 'vitest'
import { contentChangesBeforeHook, contentChangesHook } from '../../src/hooks/contentChanges.js'
import { captureContentBaseline } from '../../src/exports/rsc.js'
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
  const args = { req, doc, previousDoc, collection: { slug: 'pages', fields: [] } } as unknown as Parameters<CollectionAfterChangeHook>[0]
  Object.assign(payload.db, { findOne: vi.fn(async () => structuredClone(args.doc)) })
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
  expect(executor.calls.some(call => call.text.includes('FROM') || call.text.startsWith('UPDATE'))).toBe(false)
  expect(payload.calls).toEqual([])
})
test('unbound slots produce no lookups or appends', async () => {
  const { args, executor, payload } = setup({ bound: false })
  await recordContentChange(args)
  expect(executor.calls.some(call => call.text.includes('FROM') || call.text.startsWith('UPDATE'))).toBe(false)
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
async function publishedBaseline(args: Parameters<CollectionAfterChangeHook>[0], published: unknown) {
  const read = vi.fn(async () => structuredClone(args.doc)).mockResolvedValueOnce(published)
  Object.assign(args.req.payload.db, { findOne: read, findVersions: vi.fn(() => { throw new Error('Version history must not be read') }) })
  args.collection.versions = { drafts: {} } as typeof args.collection.versions
  await contentChangesBeforeHook({ ...args, data: args.doc, originalDoc: args.previousDoc, operation: 'update' })
  return read
}
test.each(['puckData', 'content'])('autosave then publish without further edits appends once using the previous published %s', async field => {
  const { args, executor } = setup({ field })
  const published = structuredClone(args.previousDoc)
  const read = await publishedBaseline(args, published)
  args.doc._status = 'draft'
  args.req.context.autosave = true
  await contentChangesHook(args)
  expect(executor.calls.some(call => call.text.startsWith('UPDATE'))).toBe(false)
  expect(read).toHaveBeenCalledOnce()
  args.previousDoc = structuredClone(args.doc) // Payload's latest version is the autosaved draft.
  args.doc._status = 'published'
  delete args.req.context.autosave
  await contentChangesHook(args)
  expect(executor.calls.filter(call => call.text.startsWith('UPDATE'))).toHaveLength(1)
  expect(read).toHaveBeenCalledWith(expect.objectContaining({ collection: 'pages', req: args.req, where: { id: { equals: 1 } }, overrideAccess: false }))
})
test('publish of unchanged content ignores the latest draft previousDoc', async () => {
  const { args, executor } = setup()
  await publishedBaseline(args, structuredClone(args.doc))
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
  expect(executor.calls.some(call => call.text.includes('FROM') || call.text.startsWith('UPDATE'))).toBe(false)
})
test('explicit calls and installed hooks log discovery errors without throwing into the host save', async () => {
  const { args, executor } = setup()
  const error = new Error('lookup unavailable')
  const query = vi.mocked(executor.query).getMockImplementation()! as typeof executor.query
  vi.spyOn(executor, 'query').mockImplementation(async <R>(text: string, params?: unknown[]) => {
    if (text.startsWith('SELECT')) throw error
    return query<R>(text, params)
  })
  const report = vi.spyOn(console, 'error').mockImplementation(() => {})
  await expect(recordContentChange(args)).resolves.toBeUndefined()
  expect(await contentChangesHook(args)).toBe(args.doc)
  expect(report).toHaveBeenCalledWith('[payload-experiments] contentChanges failed; the document was saved without it', safeError(error))
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
  expect(report).toHaveBeenCalledWith('[payload-experiments] contentChanges failed; the document was saved without it', safeError(error))
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
  expect(report).toHaveBeenCalledExactlyOnceWith('[payload-experiments] contentChanges failed; the document was saved without it', safeError(error))
})

test('a pruned version history and unpublish do not change the captured main-row baseline', async () => {
  const { args, executor } = setup()
  const main = { ...structuredClone(args.doc), _status: 'published' }
  await publishedBaseline(args, main)
  args.doc._status = 'published'
  args.previousDoc = { id: 1, puckData: { content: [slot('Pruned draft')] } }
  await recordContentChange(args)
  expect(executor.calls.some(call => call.text.startsWith('UPDATE'))).toBe(false)
  expect(args.req.payload.db.findVersions).not.toHaveBeenCalled()
})
test('failed beforeChange capture returns incoming data, logs, and skips the publish marker', async () => {
  const { args, executor, payload } = setup()
  args.collection.versions = { drafts: {} } as typeof args.collection.versions
  Object.assign(args.req.payload.db, { findOne: vi.fn(async () => { throw new Error('read failed') }) })
  const report = vi.spyOn(console, 'error').mockImplementation(() => {})
  expect(await contentChangesBeforeHook({ ...args, originalDoc: args.previousDoc, data: args.doc, operation: 'update' })).toBe(args.doc)
  args.doc._status = 'published'
  expect(await contentChangesHook(args)).toBe(args.doc)
  expect(report).toHaveBeenCalledTimes(1)
  expect(payload.logs).toContainEqual({ level: 'debug', args: ['[payload-experiments] contentChanges skipped without a captured published baseline'] })
  expect(executor.calls.some(call => call.text.startsWith('UPDATE'))).toBe(false)
})

test('a draft-enabled arm-select host helper opts in with the public capture hook', async () => {
  const { args, executor } = setup()
  args.collection.slug = 'asks'
  const tag = { experiment: 'exp', arm: 'variantA' }
  const published = { id: 1, vars: [{ experimentArm: tag, blocks: [{ text: 'Published' }] }] }
  args.doc = { id: 1, _status: 'published', vars: [{ experimentArm: tag, blocks: [{ text: 'New' }] }] }
  args.previousDoc = structuredClone(args.doc) // Latest autosaved draft equals publish.
  args.collection.versions = { drafts: {} } as typeof args.collection.versions
  Object.assign(args.req.payload.db, { findOne: vi.fn(async () => structuredClone(args.doc)).mockResolvedValueOnce(published) })
  await captureContentBaseline({ ...args, originalDoc: args.previousDoc, data: args.doc, operation: 'update' })
  await recordContentChange(args)
  expect(executor.calls.filter(call => call.text.startsWith('UPDATE'))).toHaveLength(1)
})

test('first publish of a document created as draft records a marker despite identical slot content', async () => {
  const { args, executor } = setup()
  args.previousDoc = { ...structuredClone(args.doc), _status: 'draft' }
  args.collection.versions = { drafts: {} } as typeof args.collection.versions
  Object.assign(args.req.payload.db, { findOne: vi.fn(async () => structuredClone(args.doc)).mockResolvedValueOnce(structuredClone(args.previousDoc)) })
  const versions = vi.fn(async () => ({ docs: [] }))
  Object.assign(args.req.payload.db, { findVersions: versions })
  // Re-capture using the real draft main-row shape and no published history.
  await contentChangesBeforeHook({ ...args, originalDoc: args.previousDoc, data: args.doc, operation: 'update' })
  args.doc._status = 'published'
  await recordContentChange(args)
  expect(versions).toHaveBeenCalledWith(expect.objectContaining({ limit: 1, where: { and: [{ parent: { equals: 1 } }, { 'version._status': { equals: 'published' } }] } }))
  expect(executor.calls.filter(call => call.text.startsWith('UPDATE'))).toHaveLength(1)
})
test('unpublished main row with a published history uses main content, not version content', async () => {
  const { args, executor } = setup()
  const main = { ...structuredClone(args.doc), _status: 'draft' }
  args.collection.versions = { drafts: {} } as typeof args.collection.versions
  Object.assign(args.req.payload.db, { findOne: vi.fn(async () => structuredClone(args.doc)).mockResolvedValueOnce(main), findVersions: vi.fn(async () => ({ docs: [{ version: args.previousDoc }] })) })
  await contentChangesBeforeHook({ ...args, originalDoc: args.previousDoc, data: args.doc, operation: 'update' })
  args.doc._status = 'published'
  await recordContentChange(args)
  expect(executor.calls.some(call => call.text.startsWith('UPDATE'))).toBe(false)
})
test('publishing an existing document preserves a pending create baseline in the same request', async () => {
  const { args, executor } = setup()
  await publishedBaseline(args, args.previousDoc)
  await contentChangesBeforeHook({ ...args, originalDoc: {}, data: args.doc, operation: 'create' })
  args.doc._status = 'published'
  await recordContentChange(args)
  expect(args.req.context.xpPublishedContent).toHaveProperty('pages:__create__')
  expect(args.req.context.xpPublishedContent).not.toHaveProperty('pages:1')
  args.doc = { ...args.doc, id: 2 }
  args.previousDoc = {}
  await recordContentChange(args)
  expect(args.req.context.xpPublishedContent).not.toHaveProperty('pages:__create__')
  expect(executor.calls.filter(call => call.text.startsWith('UPDATE'))).toHaveLength(2)
})
test.each([undefined, Promise.resolve(undefined)])('transaction-disabled hooks skip quietly (%s)', async transactionID => {
  const { args, executor, payload } = setup()
  args.collection.versions = { drafts: {} } as typeof args.collection.versions
  args.doc._status = 'published'
  args.req.transactionID = transactionID as typeof args.req.transactionID
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  expect(await contentChangesBeforeHook({ ...args, originalDoc: args.previousDoc, data: args.doc, operation: 'update' })).toBe(args.doc)
  expect(await contentChangesHook(args)).toBe(args.doc)
  expect(errors).not.toHaveBeenCalled()
  expect(executor.calls).toEqual([])
  expect(payload.logs.filter(log => log.level === 'debug')).toHaveLength(2)
})

test('non-Puck draft-enabled host without capture skips with debug and keeps publishing', async () => {
  const { args, executor, payload } = setup()
  args.collection.slug = 'asks'
  args.collection.versions = { drafts: {} } as typeof args.collection.versions
  args.doc = { id: 1, _status: 'published', vars: [{ tag: { experiment: 'exp', arm: 'variantA' }, text: 'New' }] }
  args.previousDoc = { id: 1, _status: 'draft', vars: [{ tag: { experiment: 'exp', arm: 'variantA' }, text: 'Old' }] }
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  const saved = await (async () => { await recordContentChange(args); return args.doc })()
  expect(saved).toBe(args.doc)
  expect(errors).not.toHaveBeenCalled()
  expect(executor.calls).toEqual([])
  expect(payload.logs).toContainEqual({ level: 'debug', args: ['[payload-experiments] contentChanges skipped without a captured published baseline'] })
})
test.each(['SAVEPOINT', 'ROLLBACK TO SAVEPOINT', 'RELEASE SAVEPOINT'])('explicit helper never propagates an internal %s failure', async statement => {
  const { args, executor } = setup()
  const query = vi.mocked(executor.query).getMockImplementation()! as typeof executor.query
  const error = new Error('Audit infrastructure failed')
  vi.spyOn(executor, 'query').mockImplementation(async <R>(text: string, params?: unknown[]) => {
    if (text.startsWith(statement) || statement === 'ROLLBACK TO SAVEPOINT' && text.startsWith('SELECT')) throw error
    return query<R>(text, params)
  })
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  await expect(recordContentChange(args)).resolves.toBeUndefined()
  expect(errors).toHaveBeenCalledWith('[payload-experiments] contentChanges failed; the document was saved without it', safeError(error))
})
test('KI-2: draft-born page already contains a running slot; unchanged first publish records exactly one marker', async () => {
  const { args, executor } = setup()
  args.collection.versions = { drafts: {} } as typeof args.collection.versions
  args.doc._status = 'draft'
  const main = structuredClone(args.doc)
  Object.assign(args.req.payload.db, { findOne: vi.fn(async () => structuredClone(args.doc)).mockResolvedValueOnce(main), findVersions: vi.fn(async () => {
    const queries = executor.calls.map(call => call.text)
    expect(queries.lastIndexOf('SAVEPOINT xp_content_change')).toBeGreaterThan(queries.lastIndexOf('RELEASE SAVEPOINT xp_content_change'))
    expect(args.req.transactionID).toBe('fake-transaction')
    return { docs: [] }
  }) })
  await captureContentBaseline({ ...args, originalDoc: {}, data: args.doc, operation: 'create' })
  await recordContentChange({ ...args, previousDoc: {} })
  expect(executor.calls.filter(call => call.text.startsWith('UPDATE'))).toHaveLength(0)
  args.previousDoc = structuredClone(args.doc)
  await captureContentBaseline({ ...args, originalDoc: args.previousDoc, data: { ...args.doc, _status: 'published' }, operation: 'update' })
  args.doc._status = 'published'
  await recordContentChange(args)
  const markers = executor.calls.filter(call => call.text.startsWith('UPDATE'))
  expect(markers).toHaveLength(1)
  expect(JSON.parse(markers[0]!.params[0] as string)[0]).toMatchObject({ doc: { collection: 'pages', id: 1 } })
  const savepoint = executor.calls.findIndex(call => call.text === 'SAVEPOINT xp_content_change')
  expect(savepoint).toBeGreaterThanOrEqual(0)
})

test.each(['upload', 'relationship'])('%s expansion at default depth records no marker; stored edits still record one at either depth', async field => {
  for (const depth of [0, 2]) for (const changed of [false, true]) {
    const { args, executor, payload } = setup()
    args.collection.slug = 'asks'
    args.collection.versions = { drafts: {} } as typeof args.collection.versions
    const row = (text: string) => ({ id: 1, _status: 'published', layout: [{
      id: 'block', blockType: 'linked', experimentArm: { experiment: 'exp', arm: 'variantA' },
      text, [field]: 7,
    }] })
    const before = row('Original')
    const after = row(changed ? 'Changed' : 'Original')
    args.previousDoc = structuredClone(before)
    args.doc = structuredClone(after)
    if (depth) args.doc.layout[0][field] = { id: 7, title: 'Expanded linked document' }
    const transaction = args.req.transactionID
    const read = vi.fn(async (_args: unknown) => {
      const queries = executor.calls.map(call => call.text)
      expect(queries.lastIndexOf('SAVEPOINT xp_content_change')).toBeGreaterThan(queries.lastIndexOf('RELEASE SAVEPOINT xp_content_change'))
      expect(args.req.transactionID).toBe(transaction)
      return structuredClone(after)
    }).mockResolvedValueOnce(before)
    Object.assign(payload.db, { findOne: read })
    await contentChangesBeforeHook({ ...args, originalDoc: args.previousDoc, data: args.doc, operation: 'update' })
    expect(await contentChangesHook(args)).toBe(args.doc)
    expect(executor.calls.filter(call => call.text.startsWith('UPDATE'))).toHaveLength(changed ? 1 : 0)
    expect(read).toHaveBeenCalledTimes(2)
    for (const [call] of read.mock.calls) {
      expect(call).toMatchObject({ collection: 'asks', req: args.req, where: { id: { equals: 1 } }, overrideAccess: false })
    }
    expect(payload.calls).toEqual([])
    expect(args.req.transactionID).toBe(transaction)
  }
})

test.each(['missing', 'error'])('a %s saved-row read recovers the audit savepoint without recording a removal', async failure => {
  const { args, executor } = setup()
  const read = await publishedBaseline(args, args.previousDoc)
  const error = new Error('Saved row read failed')
  if (failure === 'missing') read.mockResolvedValueOnce(undefined)
  else read.mockRejectedValueOnce(error)
  args.doc._status = 'published'
  const transaction = args.req.transactionID
  const report = vi.spyOn(console, 'error').mockImplementation(() => {})
  expect(await contentChangesHook(args)).toBe(args.doc)
  expect(executor.calls.filter(call => call.text.startsWith('UPDATE'))).toHaveLength(0)
  expect(executor.calls.some(call => call.text === 'ROLLBACK TO SAVEPOINT xp_content_change')).toBe(true)
  expect(args.req.transactionID).toBe(transaction)
  expect(report).toHaveBeenCalledOnce()
})

const linkedFields: Field[] = [{ name: 'vars', type: 'array', fields: [
  { name: 'experimentArm', type: 'group', fields: [{ name: 'experiment', type: 'text' }, { name: 'arm', type: 'text' }] },
  { name: 'blocks', type: 'blocks', blocks: [{ slug: 'linked', fields: [
    { name: 'text', type: 'text' }, { name: 'image', type: 'upload', relationTo: 'media' },
    { name: 'link', type: 'relationship', relationTo: 'pages' },
    { name: 'links', type: 'relationship', relationTo: 'pages', hasMany: true },
    { name: 'polymorphic', type: 'relationship', relationTo: ['pages', 'media'], hasMany: true },
    { name: 'body', type: 'richText' },
  ] }] },
] }]
function linkedRow(text: string, expanded = false) {
  const link = (id: number) => expanded ? { id, title: 'Expanded linked document' } : id
  return { id: 1, vars: [{ experimentArm: { experiment: 'exp', arm: 'variantA' }, blocks: [{
    blockType: 'linked', text, image: link(7), link: link(8), links: [link(8), link(9)],
    polymorphic: [{ relationTo: 'media', value: link(7) }, { relationTo: 'pages', value: link(8) }],
    body: { root: { children: [{ type: 'paragraph', children: [
      { type: 'upload', relationTo: 'media', value: link(7) },
      { type: 'relationship', relationTo: 'pages', value: link(8) },
    ] }] } },
  }] }] }
}

test.each([false, true])('collections without drafts compare captured raw rows despite default-depth expanded links (changed=%s)', async changed => {
  const { args, executor, payload } = setup()
  args.collection.slug = 'asks'
  args.collection.fields = linkedFields as typeof args.collection.fields
  const before = linkedRow('Original')
  const after = linkedRow(changed ? 'Changed' : 'Original')
  args.previousDoc = structuredClone(before)
  args.doc = linkedRow(changed ? 'Changed' : 'Original', true)
  // Raw capture also avoids false markers from hidden/afterRead-transformed fields.
  args.previousDoc.vars[0].blocks[0].text = 'afterRead display value'
  const read = vi.fn(async () => structuredClone(after)).mockResolvedValueOnce(before)
  Object.assign(payload.db, { findOne: read })
  await contentChangesBeforeHook({ ...args, originalDoc: args.previousDoc, data: args.doc, operation: 'update' })
  expect(await contentChangesHook(args)).toBe(args.doc)
  expect(executor.calls.filter(call => call.text.startsWith('UPDATE'))).toHaveLength(changed ? 1 : 0)
  expect(read).toHaveBeenCalledTimes(2)
})

test.each([false, true])('host helper without capture normalises expanded upload, hasMany, polymorphic and Lexical links (changed=%s)', async changed => {
  const { args, executor, payload } = setup()
  args.collection.slug = 'asks'
  args.collection.fields = linkedFields as typeof args.collection.fields
  // Explicit callers can supply populated previous content as well as a depth-0 previousDoc.
  for (const previousExpanded of [false, true]) {
    executor.calls.length = 0
    args.previousDoc = linkedRow('Original', previousExpanded)
    args.doc = linkedRow(changed ? 'Changed' : 'Original', true)
    const read = vi.fn(async () => linkedRow(changed ? 'Changed' : 'Original'))
    Object.assign(payload.db, { findOne: read })
    await recordContentChange(args)
    expect(executor.calls.filter(call => call.text.startsWith('UPDATE'))).toHaveLength(changed ? 1 : 0)
    // Without a captured baseline both sides are afterRead documents; the raw row is not read.
    expect(read).not.toHaveBeenCalled()
  }
})
test('host helper without capture ignores the raw row\'s locale map on an unchanged localized write', async () => {
  const { args, executor, payload } = setup()
  args.collection.slug = 'asks'
  args.collection.fields = linkedFields as typeof args.collection.fields
  args.previousDoc = linkedRow('Original', false)
  args.doc = linkedRow('Original', true)
  // The raw row would carry { en, fr }; the afterRead documents carry the selected locale only.
  const read = vi.fn(async () => ({ ...linkedRow('Original'), text: { en: 'Original', fr: 'Original FR' } }))
  Object.assign(payload.db, { findOne: read })
  await recordContentChange(args)
  expect(executor.calls.filter(call => call.text.startsWith('UPDATE'))).toHaveLength(0)
})

test.each([true, false])('Experiment-block audit compares stored slot rows, independently of afterRead projection (changed=%s)', async changed => {
  const { args, executor, payload } = setup()
  const options = payload.config.custom!.xp as ReturnType<typeof sampleOptions>
  options.puck = { enabled: false, collections: [] }
  options.blocks = { collections: [{ slug: 'pages', field: 'layout' }] }
  const make = (text: string) => ({ id: 1, _status: 'published', layout: [{ id: 'wrapper', blockType: 'xpExperiment', experiment: 'hero', slots: [
    { id: 'control', slot: 'control', blocks: [{ id: 'text', blockType: 'text', text }] },
  ] }] })
  const storedBefore = make('Old'), storedAfter = make(changed ? 'New' : 'Old')
  args.doc = make('afterRead hides what is stored')
  args.previousDoc = make('another projection')
  const read = await publishedBaseline(args, storedBefore)
  read.mockResolvedValue(storedAfter)
  await recordContentChange(args)
  expect(executor.calls.filter(call => call.text.startsWith('UPDATE'))).toHaveLength(changed ? 1 : 0)
  expect(payload.calls).toEqual([])
})
