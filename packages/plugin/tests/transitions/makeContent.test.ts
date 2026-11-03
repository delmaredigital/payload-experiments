import { Forbidden, Locked, NotFound, ValidationError, type Field } from 'payload'
import { afterEach, expect, test, vi } from 'vitest'
import { contentReportCopy } from '../../src/admin/copy/actions.js'
import { preflightData } from '../../src/transitions/preflightData.js'
import { makeContent } from '../../src/transitions/makeContent.js'
import { fakeReq } from '../_fakes/req.js'
import { fakePayload } from '../_fakes/payload.js'
import { createFakeExecutor } from '../_fakes/executor.js'
import { sampleOptions } from '../collections/fixtures.js'

afterEach(() => vi.restoreAllMocks())
const text = (value: string) => ({ type: 'Text', props: { text: value } })
const slot = (winner: unknown[] = [text('Winner')], experiment: unknown = { id: '1', slug: 'hero' }) => ({ type: 'ExperimentSlot', props: {
  id: 'slot', experiment, control: [text('Original')], variantA: winner,
} })
function fixture(kind = 'block', drafts = true, field = 'puckData') {
  const options = sampleOptions()
  options.puck = { enabled: true, collections: [{ slug: 'pages', field }] }
  const executor = createFakeExecutor()
  let revision = 0
  executor.query = async <R>(sql: string, params: unknown[] = []) => {
    executor.calls.push({ text: sql, params })
    const rows = sql.includes('RETURNING "revision"') ? [{ revision: ++revision }]
      : sql.includes('txid_current') ? [{ xid: '123' }] : sql.includes('txid_status') ? [{ status: 'committed' }] : []
    return { rows: rows as R[], rowCount: 1 }
  }
  let defaults: Record<string, unknown> = { other: { winnerArm: 'control', params: {}, experiment: 9 } }
  const payload = fakePayload({ executor, config: { custom: { xp: options }, collections: [{ slug: 'pages', fields: [], ...(drafts ? { versions: { drafts: {} } } : {}) }] },
    overrides: { findGlobal: vi.fn(async () => ({ flagDefaults: defaults })), updateGlobal: vi.fn(async args => { defaults = args.data.flagDefaults; return args.data }) },
    collections: {
      'xp-experiments': [{ id: 1, slug: 'hero', status: 'decided', kind, flagPoint: 'setting', unitType: 'visitor', phase: 1, allocation: 100,
        decision: { winnerArm: 'variantA' }, decidedAt: '2026-10-01T00:00:00.000Z', arms: [
          { key: 'control', kind: 'control', weight: 50, slot: 'control', pageTarget: '/original', params: { enabled: false } },
          { key: 'variantA', kind: 'variant', weight: 50, slot: 'variantA', pageTarget: '/winner', params: { enabled: true } },
        ] }],
      'xp-phases': [{ id: 2, experiment: 1, phase: 1, phaseKind: 'test', seed: 'seed|', allocation: 100, targeting: [], arms: [
        { key: 'control', kind: 'control', weight: 50, slot: 'control', pageTarget: '/original' },
        { key: 'variantA', kind: 'variant', weight: 50, slot: 'variantA', pageTarget: '/winner' },
      ] }],
      pages: [{ id: 3, _status: 'published', [field]: { content: [slot()] } }, { id: 4, _status: 'published', [field]: { content: [slot()] } }],
    } })
  Object.assign(payload.db, {
    findOne: vi.fn(async ({ collection, where }) => structuredClone(payload.documents[collection]?.find(doc => doc.id === where.id.equals))),
    findVersions: vi.fn(async ({ collection, where }) => ({ docs: [{ version: structuredClone(payload.documents[collection]?.find(doc => doc.id === where.and[0].parent.equals)) }] })),
  })
  const req = fakeReq({ payload, user: { id: 42 } as never })
  const experiment = payload.documents['xp-experiments']![0]!
  return { req, payload, executor, options, experiment, field }
}
const hostUpdates = (f: ReturnType<typeof fixture>) => f.payload.calls.filter(call => call.method === 'update' && call.args.collection === 'pages')
function mockDraftVersions(f: ReturnType<typeof fixture>, read: (id: string | number) => unknown | Promise<unknown>) {
  vi.spyOn(f.payload.db, 'findVersions').mockImplementation(async args => ({ docs: [{
    version: await read((args.where!.and as Array<{ parent: { equals: string | number } }>)[0]!.parent.equals),
  }] }) as never)
}

test.each(['draft', 'running', 'stopped', 'archived'])('refuses %s before any host write', async status => {
  const f = fixture(); f.experiment.status = status
  await expect(makeContent(f.req, { experimentId: 1, options: f.options })).rejects.toMatchObject({ code: 'invalid-status' })
  expect(hostUpdates(f)).toEqual([])
})
test.each(['locked', '_isLocked'])('any %s placement refuses all host writes', async property => {
  const f = fixture(); f.payload.documents.pages![1]![property] = true
  await expect(makeContent(f.req, { experimentId: 1, options: f.options })).rejects.toMatchObject({ code: 'locked-placement', status: 422 })
  expect(hostUpdates(f)).toEqual([])
  expect(f.payload.calls.filter(call => call.method === 'find' && call.args.collection === 'pages').every(call => call.args.includeLockStatus === true)).toBe(true)
})
test.each(['puckData', 'content'])('nested slots unwrap in %s; published and latest draft preserve their own edits', async field => {
  const f = fixture('block', true, field)
  const findByID = f.payload.findByID.bind(f.payload)
  const read = async (args: { id?: string | number; collection: string; draft?: boolean }) => {
    const doc = await findByID(args)
    return { ...doc, title: args.draft ? 'Draft outer title' : 'Published outer title', [field]: { root: { props: { title: args.draft ? 'Draft title' : 'Published title' } }, content: [
      { type: 'Section', props: { children: [slot([text('Before'), slot([text(args.draft ? 'Draft winner' : 'Published winner')], 'hero'), text('After')])] } },
      slot([text('Untouched')], 'another'),
    ] } }
  }
  vi.spyOn(f.payload, 'findByID').mockImplementation(read)
  vi.spyOn(f.payload.db, 'findOne').mockImplementation(async args => read({ collection: args.collection, id: (args.where!.id as { equals: string | number }).equals, draft: false }) as never)
  mockDraftVersions(f, id => read({ collection: 'pages', id, draft: true }))
  const result = await makeContent(f.req, { experimentId: 1, options: f.options })
  expect(result.doc.status).toBe('archived')
  expect(result.docs).toEqual([{ collection: 'pages', id: 3, ok: true }, { collection: 'pages', id: 4, ok: true }])
  const calls = hostUpdates(f)
  expect(calls.map(call => call.args.draft)).toEqual([false, true, false, true])
  for (const [index, call] of calls.entries()) {
    const draft = index % 2 === 1
    expect(call.args.overrideAccess).toBe(false)
    expect(call.args.overrideLock).toBe(false)
    expect(call.args.req).toBe(f.req)
    expect(call.args.data).toEqual({ title: draft ? 'Draft outer title' : 'Published outer title', _status: draft ? 'draft' : 'published', [field]: {
      root: { props: { title: draft ? 'Draft title' : 'Published title' } }, content: [
        { type: 'Section', props: { children: [text('Before'), text(draft ? 'Draft winner' : 'Published winner'), text('After')] } }, slot([text('Untouched')], 'another'),
      ],
    } })
  }
  expect(f.payload.dbCalls.filter(call => call.method === 'beginTransaction')).toHaveLength(3)
  expect(f.payload.dbCalls.filter(call => call.method === 'commitTransaction')).toHaveLength(3)
  expect(f.req.transactionID).toBeUndefined()
})
test('without drafts each document is written once', async () => {
  const f = fixture('block', false)
  await makeContent(f.req, { experimentId: 1, options: f.options })
  expect(hostUpdates(f)).toHaveLength(2)
})
test('a previous placement with no matching slot reports ok without writing it', async () => {
  const f = fixture()
  f.experiment.decision = { winnerArm: 'variantA', contentReport: { docs: [{ collection: 'pages', id: 3, ok: false }] } }
  f.payload.documents.pages![0]!.puckData = { content: [text('Already shipped')] }
  const result = await makeContent(f.req, { experimentId: 1, options: f.options })
  expect(result.doc.status).toBe('archived')
  expect(result.docs.find(doc => doc.id === 3)).toMatchObject({ ok: true })
  expect(hostUpdates(f).some(call => call.args.id === 3)).toBe(false)
})
test('manager denied update access on one doc: others commit; retry converges and archives', async () => {
  const f = fixture()
  const update = f.payload.update.bind(f.payload)
  let denied = true
  const hostTransactions: unknown[] = []
  vi.spyOn(f.payload, 'update').mockImplementation(async args => {
    if (args.collection === 'pages') {
      expect(args.req).toBe(f.req)
      expect(args.overrideAccess).toBe(false)
      expect(f.req.user?.id).toBe(42)
      expect(f.req.context.xpTransition).toBeUndefined()
      hostTransactions.push(await f.req.transactionID)
      if (args.id === 3 && denied) throw new Forbidden()
    }
    return update(args)
  })
  const first = await makeContent(f.req, { experimentId: 1, options: f.options })
  expect(first.doc.status).toBe('decided')
  expect(first.docs).toMatchObject([{ id: 3, ok: false, detail: 'forbidden' }, { id: 4, ok: true }])
  expect(f.experiment.decision).toMatchObject({ contentReport: { docs: first.docs } })
  expect(hostTransactions[0]).not.toBe(hostTransactions[1])
  expect(f.payload.dbCalls.filter(call => call.method === 'rollbackTransaction')).toHaveLength(1)
  denied = false
  const second = await makeContent(f.req, { experimentId: 1, options: f.options })
  expect(second.doc.status).toBe('archived')
  expect(second.docs.every(doc => doc.ok)).toBe(true)
  expect(hostUpdates(f).filter(call => call.args.id === 4)).toHaveLength(2)
})
test.each([false, true])('flag writes defaults and supplies winner params; host throw is a failed report (throws=%s)', async throws => {
  const f = fixture('flag')
  const callback = vi.fn(async ({ req }) => {
    expect(req).toBe(f.req)
    if (throws) throw new Error('Host could not ship content')
  })
  f.options.flagPoints = [{ id: 'setting', label: 'Setting', defaultParams: {}, params: {}, makeContent: callback }]
  const result = await makeContent(f.req, { experimentId: 1, options: f.options })
  expect(callback).toHaveBeenCalledExactlyOnceWith({ experimentId: 1, winner: { arm: 'variantA', params: { enabled: true } }, req: f.req })
  expect(f.payload.updateGlobal).toHaveBeenCalledWith(expect.objectContaining({ slug: 'xp-state', req: f.req, overrideAccess: true,
    data: { flagDefaults: { other: expect.any(Object), setting: { winnerArm: 'variantA', params: { enabled: true }, experiment: 1, decidedAt: f.experiment.decidedAt } } } }))
  expect(result.doc.status).toBe(throws ? 'decided' : 'archived')
  expect(result.docs[0]).toMatchObject({ ok: !throws })
  expect(hostUpdates(f)).toEqual([])
})
test('flag without a host callback ships defaults and archives', async () => {
  const f = fixture('flag')
  f.options.flagPoints = [{ id: 'setting', label: 'Setting', defaultParams: {}, params: {} }]
  expect((await makeContent(f.req, { experimentId: 1, options: f.options })).doc.status).toBe('archived')
})
test('page performs no host writes and archives winner routing', async () => {
  const f = fixture('page')
  const result = await makeContent(f.req, { experimentId: 1, options: f.options })
  expect(result.doc.status).toBe('archived')
  expect(result.docs).toEqual([])
  expect(hostUpdates(f)).toEqual([])
  const manifest = f.executor.calls.find(call => call.text.includes('"manifest" ='))!
  expect(JSON.parse(manifest.params[0] as string).archivedPages).toEqual({ '/original': { slug: 'hero', winnerPath: '/winner' } })
})

test('Payload latest-version merge preserves published and draft fields outside Puck', async () => {
  const f = fixture()
  const published = new Map(f.payload.documents.pages!.map(doc => [doc.id, { ...doc, title: 'Published title', seo: { description: 'Published SEO' } }]))
  const latest = new Map(f.payload.documents.pages!.map(doc => [doc.id, { ...doc, _status: 'draft', title: 'Unpublished title', seo: { description: 'Draft SEO' } }]))
  vi.spyOn(f.payload, 'findByID').mockImplementation(async args => structuredClone((args.draft ? latest : published).get(args.id!)!))
  vi.spyOn(f.payload.db, 'findOne').mockImplementation(async args => structuredClone(published.get((args.where!.id as { equals: number }).equals)) as never)
  mockDraftVersions(f, id => structuredClone(latest.get(id)))
  const update = f.payload.update.bind(f.payload)
  vi.spyOn(f.payload, 'update').mockImplementation(async args => {
    if (args.collection === 'pages') {
      // Real updateByID always starts from the latest version, even on publish.
      const doc = { ...latest.get(args.id!)!, ...args.data }
      latest.set(args.id!, doc)
      if (!args.draft) published.set(args.id!, doc)
    }
    return update(args)
  })
  await makeContent(f.req, { experimentId: 1, options: f.options })
  for (const id of [3, 4]) {
    expect(published.get(id)).toMatchObject({ title: 'Published title', seo: { description: 'Published SEO' }, puckData: { content: [text('Winner')] } })
    expect(latest.get(id)).toMatchObject({ title: 'Unpublished title', seo: { description: 'Draft SEO' }, puckData: { content: [text('Winner')] } })
  }
})

test.each(([
  [{ name: 'secret', type: 'text', hidden: true }],
  [{ name: 'secret', type: 'text', access: { read: () => false, update: () => true } }],
  [{ name: 'secret', type: 'text', access: { read: () => true, update: () => false } }],
  [{ name: 'secret', type: 'text', access: { read: () => false, update: () => false } }],
] satisfies Field[][]).map(fields => ({ fields })))('restricted fields round-trip published values unchanged: %j', async ({ fields }) => {
  const f = fixture()
  f.payload.config.collections[0]!.fields = fields
  for (const doc of f.payload.documents.pages!) doc.secret = 'Published private value'
  const read = f.payload.findByID.bind(f.payload)
  vi.spyOn(f.payload, 'findByID').mockImplementation(async args => {
    const doc = await read(args)
    if ('hidden' in fields[0]! && fields[0]!.hidden && !args.showHiddenFields) delete doc.secret
    if ('access' in fields[0]! && fields[0]!.access?.read && !await fields[0]!.access.read()) delete doc.secret
    return doc
  })
  const result = await makeContent(f.req, { experimentId: 1, options: f.options })
  expect(result.docs.every(doc => doc.ok)).toBe(true)
  for (const call of hostUpdates(f).filter(call => !call.args.draft)) {
    expect(call.args.data).toMatchObject({ secret: 'Published private value', puckData: { content: [text('Winner')] } })
  }
})

test.each(([
  [{ type: 'tabs', tabs: [{ label: 'SEO', fields: [{ name: 'title', type: 'text', localized: true }] }] }],
  [{ name: 'blocks', type: 'blocks', blocks: [{ slug: 'copy', fields: [{ name: 'title', type: 'text', localized: true }] }] }],
  [{ name: 'puckData', type: 'json', localized: true }],
  [{ type: 'tabs', tabs: [{ name: 'localizedContent', label: 'Content', localized: true, fields: [{ name: 'puckData', type: 'json' }] }] }],
] satisfies Field[][]).map(fields => ({ fields })))('localized collections are refused and warned about before Decide', async ({ fields }) => {
  const f = fixture()
  f.payload.config.collections[0]!.fields = fields
  f.payload.documents.pages![0]!.title = 'Landing page'
  const original = structuredClone(f.payload.documents.pages)
  const preflight = await preflightData(f.req, { experimentId: 1, options: f.options })
  expect(preflight!.checks).toContainEqual({ code: 'make-content-unsupported', ok: true, warning: true, detail: 'Landing page' })
  const result = await makeContent(f.req, { experimentId: 1, options: f.options })
  expect(result.doc.status).toBe('decided')
  expect(result.docs.every(doc => !doc.ok && doc.detail === 'localized' && doc.error === 'localized')).toBe(true)
  expect(contentReportCopy('localized')).toBe("This page has more than one language; Make it the content can't publish it safely yet. Copy the winning version by hand.")
  expect(hostUpdates(f)).toEqual([])
  expect(f.payload.documents.pages).toEqual(original)
})

test('published and draft adapter reads borrow the same detached host transaction, never the outer transition', async () => {
  const f = fixture()
  const transactions: unknown[] = []
  const read = vi.mocked(f.payload.db.findOne).getMockImplementation()!
  vi.spyOn(f.payload.db, 'findOne').mockImplementation(async args => {
    expect(args.req).toBe(f.req)
    expect(args.req!.context?.xpTransition).toBeUndefined()
    transactions.push(args.req!.transactionID)
    return read(args)
  })
  const readVersions = vi.mocked(f.payload.db.findVersions).getMockImplementation()!
  vi.spyOn(f.payload.db, 'findVersions').mockImplementation(async args => {
    expect(args).toMatchObject({ collection: 'pages', req: f.req, limit: 1, pagination: false,
      sort: '-updatedAt', where: { and: [{ parent: { equals: expect.any(Number) } }, { latest: { equals: true } }] } })
    expect(args.req!.context?.xpTransition).toBeUndefined()
    transactions.push(args.req!.transactionID)
    return readVersions(args)
  })
  await makeContent(f.req, { experimentId: 1, options: f.options })
  expect(transactions).toEqual(['fake-transaction-2', 'fake-transaction-2', 'fake-transaction-3', 'fake-transaction-3'])
})

test.each([true, {}])('retry after a failed placement is deleted reports it ok and archives (read=%j)', async access => {
  const f = fixture()
  Object.assign(f.payload.config.collections[0]!, { access: { read: () => access } })
  const update = f.payload.update.bind(f.payload)
  vi.spyOn(f.payload, 'update').mockImplementation(async args => {
    if (args.collection === 'pages' && args.id === 3) throw new Error('Update denied')
    return update(args)
  })
  expect((await makeContent(f.req, { experimentId: 1, options: f.options })).doc.status).toBe('decided')
  f.payload.documents.pages = f.payload.documents.pages!.filter(doc => doc.id !== 3)
  const findByID = f.payload.findByID.bind(f.payload)
  vi.spyOn(f.payload, 'findByID').mockImplementation(async args => {
    if (args.collection === 'pages' && args.id === 3) {
      expect(args.disableErrors).toBe(true)
      expect(f.req.transactionID).toBeUndefined()
      return null as never
    }
    return findByID(args)
  })
  const result = await makeContent(f.req, { experimentId: 1, options: f.options })
  expect(result.doc.status).toBe('archived')
  expect(result.docs).toContainEqual({ collection: 'pages', id: 3, ok: true, detail: 'not-found' })
})
test('a retained page made unreadable is reported without killing the outer transaction', async () => {
  const f = fixture()
  f.experiment.decision = { winnerArm: 'variantA', contentReport: { docs: [{ collection: 'pages', id: 3, ok: false }] } }
  Object.assign(f.payload.config.collections[0]!, { access: { read: ({ id }: { id?: string | number }) => id !== 3 } })
  const findByID = f.payload.findByID.bind(f.payload)
  vi.spyOn(f.payload, 'findByID').mockImplementation(async args => {
    if (args.id === 3) { expect(args.disableErrors).toBe(true); return null as never }
    return findByID(args)
  })
  const result = await makeContent(f.req, { experimentId: 1, options: f.options })
  expect(result.doc.status).toBe('decided')
  expect(result.docs).toMatchObject([{ id: 3, ok: false, detail: 'forbidden' }, { id: 4, ok: true }])
  expect(f.payload.dbCalls.some(call => call.method === 'rollbackTransaction')).toBe(false)
  expect(hostUpdates(f).some(call => call.args.id === 3)).toBe(false)
})
test.each([false, true])('a lock acquired after pre-check fails only that document (draft write=%s)', async draftWrite => {
  const f = fixture()
  const update = f.payload.update.bind(f.payload)
  vi.spyOn(f.payload, 'update').mockImplementation(async args => {
    if (args.collection === 'pages') {
      expect(args.overrideLock).toBe(false)
      if (args.id === 3 && args.draft === draftWrite) throw new Locked('secret-value locked row')
    }
    return update(args)
  })
  const result = await makeContent(f.req, { experimentId: 1, options: f.options })
  expect(result.doc.status).toBe('decided')
  expect(result.docs).toMatchObject([{ id: 3, ok: false, detail: 'locked' }, { id: 4, ok: true }])
  expect(f.payload.dbCalls.filter(call => call.method === 'rollbackTransaction')).toHaveLength(1)
})

test('collection read access removed since a partial run cannot abort the outer transaction during scanning', async () => {
  const f = fixture()
  f.experiment.decision = { winnerArm: 'variantA', contentReport: { docs: [{ collection: 'pages', id: 3, ok: false }, { collection: 'pages', id: 4, ok: true }] } }
  Object.assign(f.payload.config.collections[0]!, { access: { read: () => false } })
  const find = f.payload.find.bind(f.payload)
  vi.spyOn(f.payload, 'find').mockImplementation(async args => {
    if (args.collection === 'pages') {
      expect(f.req.transactionID).toBeUndefined()
      throw Object.assign(new Error('Forbidden'), { status: 403 })
    }
    return find(args)
  })
  vi.spyOn(f.payload, 'findByID').mockImplementation(async args => {
    expect(args.disableErrors).toBe(true)
    return null as never
  })
  const result = await makeContent(f.req, { experimentId: 1, options: f.options })
  expect(result.doc.status).toBe('decided')
  expect(result.docs).toMatchObject([{ id: 3, ok: false, detail: 'forbidden' }, { id: 4, ok: false, detail: 'forbidden' }])
  expect(hostUpdates(f)).toEqual([])
  expect(f.payload.dbCalls.some(call => call.method === 'rollbackTransaction')).toBe(false)
})

test.each(['field', 'tab'] as const)('readable admin-only %s update access refuses draft leakage before either write', async container => {
  const f = fixture()
  const updateAccess = vi.fn(({ id, req, doc, data, siblingData, blockData }) => {
    expect(id).toBe(doc.id)
    expect(req).toBe(f.req)
    expect(req.user.id).toBe(42)
    expect(doc.adminOnly).toBe('Draft-only secret')
    expect(data.adminOnly).toBe('Published value')
    expect(siblingData).toBe(data)
    expect(blockData).toBeUndefined()
    return false
  })
  f.payload.config.collections[0]!.fields = container === 'field'
    ? [{ name: 'adminOnly', type: 'text', access: { read: () => true, update: updateAccess } }]
    : [{ type: 'tabs', tabs: [{ name: 'settings', access: { read: () => true, update: updateAccess }, fields: [{ name: 'label', type: 'text' }] }] }]
  const published = new Map(f.payload.documents.pages!.map(doc => [doc.id, { ...doc, adminOnly: 'Published value', settings: { label: 'Published setting' } }]))
  const drafts = new Map(f.payload.documents.pages!.map(doc => [doc.id, { ...doc, adminOnly: 'Draft-only secret', settings: { label: 'Draft-only setting' } }]))
  vi.spyOn(f.payload.db, 'findOne').mockImplementation(async args => structuredClone(published.get((args.where!.id as { equals: number }).equals)) as never)
  const originalPublished = structuredClone(published), originalDrafts = structuredClone(drafts)
  mockDraftVersions(f, id => structuredClone(drafts.get(id)))
  vi.spyOn(f.payload, 'findByID').mockImplementation(async args => structuredClone((args.draft ? drafts : published).get(args.id!)!))
  const result = await makeContent(f.req, { experimentId: 1, options: f.options })
  expect(result.doc.status).toBe('decided')
  expect(updateAccess).toHaveBeenCalledTimes(2)
  for (const doc of result.docs) expect(doc).toMatchObject({ ok: false, detail: 'validation' })
  expect(hostUpdates(f)).toEqual([])
  expect(published).toEqual(originalPublished)
  expect(drafts).toEqual(originalDrafts)
})
test('nested block update access gets the proposed row and root data with the latest draft as doc', async () => {
  const f = fixture()
  const read = f.payload.findByID.bind(f.payload)
  vi.spyOn(f.payload, 'findByID').mockImplementation(async args => ({ ...await read(args), blocks: [{ id: 'row', blockType: 'copy', title: args.draft ? 'Draft-only title' : 'Published title' }] }))
  vi.spyOn(f.payload.db, 'findOne').mockImplementation(async args => ({ ...await read({ collection: args.collection, id: (args.where!.id as { equals: number }).equals }), blocks: [{ id: 'row', blockType: 'copy', title: 'Published title' }] }) as never)
  mockDraftVersions(f, async id => ({ ...await read({ collection: 'pages', id }), blocks: [{ id: 'row', blockType: 'copy', title: 'Draft-only title' }] }))
  const updateAccess = vi.fn(({ req, doc, data, siblingData, blockData }) => {
    expect(req).toBe(f.req)
    expect(doc.blocks[0].title).toBe('Draft-only title')
    expect(data.blocks[0].title).toBe('Published title')
    expect(siblingData).toBe(data.blocks[0])
    expect(blockData).toBe(siblingData)
    return false
  })
  f.payload.config.collections[0]!.fields = [{ name: 'blocks', type: 'blocks', blocks: [{ slug: 'copy', fields: [{ name: 'title', type: 'text', access: { read: () => true, update: updateAccess } }] }] }]
  const result = await makeContent(f.req, { experimentId: 1, options: f.options })
  expect(result.doc.status).toBe('decided')
  expect(updateAccess).toHaveBeenCalledTimes(2)
  expect(result.docs.every(doc => !doc.ok)).toBe(true)
  expect(hostUpdates(f)).toEqual([])
})

test('a Where-filtered miss fails closed: not done, stays decided, and says how to get out (exp-orch 16:20)', async () => {
  const f = fixture()
  Object.assign(f.payload.config.collections[0]!, { access: { read: () => ({ id: { not_equals: 3 } }) } })
  const findByID = f.payload.findByID.bind(f.payload)
  vi.spyOn(f.payload, 'findByID').mockImplementation(async args => {
    if (args.collection === 'pages' && args.id === 3) return null as never
    return findByID(args)
  })
  const result = await makeContent(f.req, { experimentId: 1, options: f.options })
  expect(result.doc.status).toBe('decided')
  expect(result.docs).toContainEqual(expect.objectContaining({ collection: 'pages', id: 3, ok: false,
    detail: 'forbidden' }))
  expect(hostUpdates(f).some(call => call.args.id === 3)).toBe(false)
})
test('a page already fixed by hand is done even if it would be refused for a write (review F1)', async () => {
  const f = fixture()
  f.experiment.decision = { winnerArm: 'variantA', contentReport: { docs: [{ collection: 'pages', id: 3, ok: false }, { collection: 'pages', id: 4, ok: false }] } }
  Object.assign(f.payload.config.collections[0]!, { fields: [{ name: 'puckData', type: 'json' }, { name: 'secret', type: 'text', hidden: true }] })
  f.payload.documents.pages = f.payload.documents.pages!.map(doc => ({ ...doc, puckData: { content: [] } }))
  const result = await makeContent(f.req, { experimentId: 1, options: f.options })
  expect(result.doc.status).toBe('archived')
  expect(result.docs).toEqual([expect.objectContaining({ id: 3, ok: true }), expect.objectContaining({ id: 4, ok: true })])
  expect(hostUpdates(f)).toEqual([])
})

test('localized content cannot take the already-fixed shortcut', async () => {
  const f = fixture()
  f.experiment.decision = { winnerArm: 'variantA', contentReport: { docs: [{ collection: 'pages', id: 3, ok: false }] } }
  f.payload.config.collections[0]!.fields = [{ name: 'puckData', type: 'json', localized: true }]
  f.payload.documents.pages = f.payload.documents.pages!.map(doc => ({ ...doc, puckData: { content: [] } }))
  const result = await makeContent(f.req, { experimentId: 1, options: f.options })
  expect(result.docs).toContainEqual({ collection: 'pages', id: 3, ok: false, detail: 'localized', error: 'localized' })
  expect(hostUpdates(f)).toEqual([])
})

test.each([
  ['update-failed', (): unknown => new Error('secret-value pg row')],
  ['update-failed', (): unknown => 'secret-value thrown string'],
  ['forbidden', (): unknown => new Forbidden()],
  ['not-found', (): unknown => new NotFound()],
  ['validation', (): unknown => new ValidationError({ errors: [{ path: 'title', message: 'secret-value invalid row' }] })],
  ['locked', (): unknown => new Locked('secret-value locked row')],
  ...['Forbidden', 'NotFound', 'ValidationError', 'Locked'].map((name, i) => [
    ['forbidden', 'not-found', 'validation', 'locked'][i], (): unknown => Object.assign(new Error('secret-value host text'), { name }),
  ] as const),
] as const)('host failure maps to %s without storing or returning its message', async (reason, failure) => {
  const f = fixture('flag')
  const error = failure()
  f.options.flagPoints = [{ id: 'setting', label: 'Setting', defaultParams: {}, params: {}, makeContent: async () => { throw error } }]
  const result = await makeContent(f.req, { experimentId: 1, options: f.options })
  expect(result.docs).toEqual([{ collection: 'xp-experiments', id: 1, ok: false, detail: reason, error: reason }])
  expect(JSON.stringify(result)).not.toContain('secret-value')
  expect(JSON.stringify(f.experiment.decision)).not.toContain('secret-value')
  expect(f.payload.logs).toContainEqual({ level: 'error', args: [expect.objectContaining({ experimentId: 1, collection: 'xp-experiments', id: 1 }), 'Experiment content update failed'] })
  expect(JSON.stringify(f.payload.logs)).not.toContain('secret-value')
})


test('a retained page read that fails with a plain 404 reports ok with not-found, never update-failed', async () => {
  const f = fixture()
  f.experiment.decision = { winnerArm: 'variantA', contentReport: { docs: [{ collection: 'pages', id: 3, ok: false }] } }
  const findByID = f.payload.findByID.bind(f.payload)
  vi.spyOn(f.payload, 'findByID').mockImplementation(async args => {
    if (args.collection === 'pages' && args.id === 3 && args.disableErrors) throw Object.assign(new Error('secret-value gone'), { status: 404 })
    return findByID(args)
  })
  const result = await makeContent(f.req, { experimentId: 1, options: f.options })
  expect(result.docs).toContainEqual({ collection: 'pages', id: 3, ok: true, detail: 'not-found' })
  expect(JSON.stringify(result)).not.toContain('secret-value')
})

test('a retained page read-hook failure is update-failed, stays decided, and keeps row data private', async () => {
  const f = fixture()
  f.experiment.decision = { winnerArm: 'variantA', contentReport: { docs: [{ collection: 'pages', id: 3, ok: false }] } }
  const findByID = f.payload.findByID.bind(f.payload)
  vi.spyOn(f.payload, 'findByID').mockImplementation(async args => {
    if (args.collection === 'pages' && args.id === 3 && args.disableErrors) throw new Error('secret-value read row')
    return findByID(args)
  })
  const result = await makeContent(f.req, { experimentId: 1, options: f.options })
  expect(result.doc.status).toBe('decided')
  expect(result.docs[0]).toMatchObject({ id: 3, ok: false, detail: 'update-failed', error: 'update-failed' })
  expect(JSON.stringify(result)).not.toContain('secret-value')
  expect(JSON.stringify(f.experiment.decision)).not.toContain('secret-value')
  expect(f.payload.logs).toContainEqual({ level: 'error', args: [expect.objectContaining({ experimentId: 1, id: 3 }), 'Experiment content read failed'] })
  expect(JSON.stringify(f.payload.logs)).not.toContain('secret-value')
})

test.each(['update-failed', 'forbidden', 'validation'] as const)('published adapter failure reports %s and rolls back the detached transaction', async reason => {
  const f = fixture()
  const error = reason === 'forbidden' ? new Forbidden() : reason === 'validation' ? new ValidationError({ errors: [] }) : new Error('secret-value')
  vi.spyOn(f.payload.db, 'findOne').mockRejectedValue(error)
  const result = await makeContent(f.req, { experimentId: 1, options: f.options })
  expect(result.docs.every(doc => !doc.ok && doc.detail === reason)).toBe(true)
  expect(hostUpdates(f)).toEqual([])
  expect(f.payload.dbCalls.filter(call => call.method === 'rollbackTransaction')).toHaveLength(2)
  expect(JSON.stringify(f.payload.logs)).not.toContain('secret-value')
})

test('reordered array rows compare denied fields against the same row ID as Payload', async () => {
  const f = fixture()
  f.payload.config.collections[0]!.fields = [{ name: 'items', type: 'array', fields: [
    { name: 'secret', type: 'text', access: { update: () => false } },
  ] }]
  for (const doc of f.payload.documents.pages!) doc.items = [{ id: 'A', secret: 'X' }, { id: 'B', secret: 'Y' }]
  const read = f.payload.findByID.bind(f.payload)
  vi.spyOn(f.payload, 'findByID').mockImplementation(async args => ({ ...await read(args), items: [{ id: 'B', secret: 'X' }, { id: 'A', secret: 'Y' }] }))
  mockDraftVersions(f, async id => ({ ...await read({ collection: 'pages', id }), items: [{ id: 'B', secret: 'X' }, { id: 'A', secret: 'Y' }] }))
  const result = await makeContent(f.req, { experimentId: 1, options: f.options })
  expect(result.docs.every(doc => !doc.ok && doc.detail === 'validation')).toBe(true)
  expect(hostUpdates(f)).toEqual([])
})

test('unreadable unpublished draft values survive the publish and draft patch', async () => {
  const f = fixture()
  f.payload.config.collections[0]!.fields = [{ name: 'privateTitle', type: 'text', access: { read: () => false, update: () => true } }]
  const published = new Map(f.payload.documents.pages!.map(doc => [doc.id, { ...doc, privateTitle: 'Published private title' }]))
  const latest = new Map(f.payload.documents.pages!.map(doc => [doc.id, { ...doc, privateTitle: 'Unpublished private title' }]))
  mockDraftVersions(f, id => structuredClone(latest.get(id)))
  vi.spyOn(f.payload.db, 'findOne').mockImplementation(async args => structuredClone(published.get((args.where!.id as { equals: number }).equals)) as never)
  vi.spyOn(f.payload, 'findByID').mockImplementation(async args => {
    const { privateTitle: _omitted, ...doc } = structuredClone((args.draft ? latest : published).get(args.id!)!)
    return doc
  })
  const update = f.payload.update.bind(f.payload)
  vi.spyOn(f.payload, 'update').mockImplementation(async args => {
    if (args.collection === 'pages') {
      const doc = { ...latest.get(args.id!)!, ...args.data }
      latest.set(args.id!, doc)
      if (!args.draft) published.set(args.id!, doc)
    }
    return update(args)
  })
  await makeContent(f.req, { experimentId: 1, options: f.options })
  expect(published.get(3)!.privateTitle).toBe('Published private title')
  expect(latest.get(3)!.privateTitle).toBe('Unpublished private title')
})

test.each(['publish', 'draft'] as const)('a differing unreadable value denied on the %s write refuses the placement', async stage => {
  const f = fixture()
  const updateAccess = vi.fn(({ req, data, doc }) => {
    expect(req).toBe(f.req)
    if (data._status === 'published') {
      expect(data.privateTitle).toBe('Published private title')
      expect(doc.privateTitle).toBe('Unpublished private title')
    } else {
      expect(data.privateTitle).toBe('Unpublished private title')
      expect(doc.privateTitle).toBe('Published private title')
    }
    return stage === 'draft' && data._status === 'published'
  })
  f.payload.config.collections[0]!.fields = [{ name: 'privateTitle', type: 'text', access: { read: () => false, update: updateAccess } }]
  for (const doc of f.payload.documents.pages!) doc.privateTitle = 'Published private title'
  mockDraftVersions(f, id => ({ ...structuredClone(f.payload.documents.pages!.find(doc => doc.id === id)), privateTitle: 'Unpublished private title' }))
  const read = f.payload.findByID.bind(f.payload)
  vi.spyOn(f.payload, 'findByID').mockImplementation(async args => {
    const { privateTitle: _omitted, ...doc } = await read(args)
    return doc as never
  })
  const result = await makeContent(f.req, { experimentId: 1, options: f.options })
  expect(result.doc.status).toBe('decided')
  expect(result.docs).toMatchObject([{ ok: false, detail: 'validation' }, { ok: false, detail: 'validation' }])
  expect(updateAccess).toHaveBeenCalledTimes(stage === 'publish' ? 2 : 4)
  expect(hostUpdates(f)).toEqual([])
  expect(f.payload.dbCalls.filter(call => call.method === 'rollbackTransaction')).toHaveLength(2)
})

test('a document without a latest version uses the main row for its draft baseline', async () => {
  const f = fixture()
  vi.spyOn(f.payload.db, 'findVersions').mockResolvedValue({ docs: [] } as never)
  const result = await makeContent(f.req, { experimentId: 1, options: f.options })
  expect(result.doc.status).toBe('archived')
  expect(hostUpdates(f).filter(call => call.args.draft)).toHaveLength(2)
})

test('a draft-only array row with an update-denied value is refused before restoring can strip it', async () => {
  const f = fixture()
  const updateAccess = vi.fn(() => false)
  f.payload.config.collections[0]!.fields = [{ name: 'items', type: 'array', fields: [
    { name: 'secret', type: 'text', access: { read: () => false, update: updateAccess } },
  ] }]
  for (const doc of f.payload.documents.pages!) doc.items = []
  mockDraftVersions(f, id => ({ ...structuredClone(f.payload.documents.pages!.find(doc => doc.id === id)),
    items: [{ id: 'new-row', secret: 'Unpublished private value' }],
  }))
  const result = await makeContent(f.req, { experimentId: 1, options: f.options })
  expect(result.doc.status).toBe('decided')
  expect(result.docs).toMatchObject([{ ok: false, detail: 'validation' }, { ok: false, detail: 'validation' }])
  expect(updateAccess).toHaveBeenCalledTimes(2)
  expect(hostUpdates(f)).toEqual([])
  expect(f.payload.dbCalls.filter(call => call.method === 'rollbackTransaction')).toHaveLength(2)
})
