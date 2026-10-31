import { afterEach, expect, test, vi } from 'vitest'
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
  const payload = fakePayload({ executor, config: { custom: { xp: options }, collections: [{ slug: 'pages', ...(drafts ? { versions: { drafts: {} } } : {}) }] },
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
  const req = fakeReq({ payload, user: { id: 42 } as never })
  const experiment = payload.documents['xp-experiments']![0]!
  return { req, payload, executor, options, experiment, field }
}
const hostUpdates = (f: ReturnType<typeof fixture>) => f.payload.calls.filter(call => call.method === 'update' && call.args.collection === 'pages')

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
  vi.spyOn(f.payload, 'findByID').mockImplementation(async args => {
    const doc = await findByID(args)
    return { ...doc, title: args.draft ? 'Draft outer title' : 'Published outer title', [field]: { root: { props: { title: args.draft ? 'Draft title' : 'Published title' } }, content: [
      { type: 'Section', props: { children: [slot([text('Before'), slot([text(args.draft ? 'Draft winner' : 'Published winner')], 'hero'), text('After')])] } },
      slot([text('Untouched')], 'another'),
    ] } }
  })
  const result = await makeContent(f.req, { experimentId: 1, options: f.options })
  expect(result.doc.status).toBe('archived')
  expect(result.docs).toEqual([{ collection: 'pages', id: 3, ok: true }, { collection: 'pages', id: 4, ok: true }])
  const calls = hostUpdates(f)
  expect(calls.map(call => call.args.draft)).toEqual([false, true, false, true])
  for (const [index, call] of calls.entries()) {
    const draft = index % 2 === 1
    expect(call.args.overrideAccess).toBe(false)
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
      if (args.id === 3 && denied) throw new Error('You do not have access to update this document.')
    }
    return update(args)
  })
  const first = await makeContent(f.req, { experimentId: 1, options: f.options })
  expect(first.doc.status).toBe('decided')
  expect(first.docs).toMatchObject([{ id: 3, ok: false, detail: expect.stringContaining('access') }, { id: 4, ok: true }])
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
