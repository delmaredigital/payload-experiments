import { Locked } from 'payload'
import { createExperimentBlock } from '../../src/blocks/createExperimentBlock.js'
import { expect, test, vi } from 'vitest'
import { scanBlockPlacements } from '../../src/transitions/placements.js'
import { checkStart } from '../../src/transitions/checkStart.js'
import { handleWrapBlock } from '../../src/endpoints/wrapBlock.js'
import { fakePayload } from '../_fakes/payload.js'
import { fakeReq } from '../_fakes/req.js'
import { sampleOptions } from '../collections/fixtures.js'
import { defaultArms } from '../../src/collections/experiments/armInvariants.js'
import { createOnInit } from '../../src/onInit.js'
const block = { id: 'wrapper', blockType: 'xpExperiment', experiment: 'hero', slots: [
  { slot: 'control', blocks: [{ id: 'original', blockType: 'text', text: 'same' }] },
  { slot: 'variantA', blocks: [{ id: 'variant', blockType: 'text', text: 'same' }] },
] }
function fixture() {
  const options = sampleOptions()
  options.blocks = { collections: [{ slug: 'pages', field: 'layout', appliesTo: doc => !doc.puckData }] }
  options.puck = { enabled: true, collections: ['pages'] }
  const payload = fakePayload({ config: { collections: [{ slug: 'pages', versions: { drafts: true }, fields: [{ name: 'layout', type: 'blocks', blocks: [{ slug: 'text', fields: [] }, createExperimentBlock({ blocks: [{ slug: 'text', fields: [] }] })] }] }] }, collections: { pages: [
    { id: 1, title: 'Live', _status: 'published', layout: [block] },
    { id: 2, title: 'Puck', _status: 'published', puckData: {}, layout: [block] },
    { id: 3, title: 'Draft', _status: 'draft', layout: [block] },
    { id: 4, title: 'Nested', _status: 'published', layout: [{ blockType: 'container', children: [block] }] },
  ], 'xp-experiments': [{ id: 1, slug: 'hero', kind: 'block', status: 'draft' }] } })
  Object.assign(payload.db, { findOne: vi.fn(async ({ collection, where }) => payload.documents[collection]?.find(d => d.id === where.id.equals)) })
  const req = fakeReq({ payload, user: { id: 1 } as never })
  return { options, payload, req }
}
test('scan reads published then latest drafts, applies editor rule and ignores nested wrappers', async () => {
  const f = fixture()
  const result = await scanBlockPlacments(f)
  expect(result.map(p => [p.id, p.published])).toEqual([[1, true], [3, false]])
  expect(result[0]?.identicalSlots).toEqual(['variantA'])
  expect(f.payload.calls.every(c => c.args.overrideAccess === false && c.args.req === f.req)).toBe(true)
  expect(f.payload.calls.map(c => c.args.draft)).toEqual([false, true, false, true])
})
function scanBlockPlacments(f: ReturnType<typeof fixture>) {
  return scanBlockPlacements(f.req, { slug: 'hero', compareVersions: true, puckCollections: f.options.puck!.collections, blocksCollections: f.options.blocks!.collections })
}
test('readiness refuses unpublished, duplicate published rows and empty published versions', async () => {
  const f = fixture(), result = await scanBlockPlacments(f)
  const checks = (placements: typeof result) => checkStart({ experiment: { id: 1, slug: 'hero', status: 'draft', kind: 'block', unitType: 'visitor', allocation: 100, exposurePolicy: 'render', arms: defaultArms('block') }, metrics: [], placements })
  expect(checks(result).find(c => c.code === 'placement-unpublished')).toMatchObject({ ok: false, detail: [expect.objectContaining({ id: 3 })] })
  expect(checks([{ ...result[0]!, duplicateRows: true, slots: { control: 1, variantA: 0, variantB: 0, variantC: 0 } }]).filter(c => ['duplicate-version-row', 'empty-slot'].includes(c.code)).every(c => !c.ok)).toBe(true)
})
test('wrap endpoint writes latest draft, uses row id and respects access and document locks', async () => {
  const f = fixture(); f.payload.documents.pages![0]!.layout = [{ id: 'source', blockType: 'text', text: 'Hello' }]
  f.req.data = { collection: 'pages', id: 1, field: 'layout', blockId: 'source', experiment: 'hero' }
  expect((await handleWrapBlock(f.req, { options: f.options })).status).toBe(200)
  const write = f.payload.calls.find(c => c.method === 'update')
  expect(write?.args).toMatchObject({ req: f.req, draft: true, overrideAccess: false, overrideLock: false })
  expect(write?.args.data).toMatchObject({ layout: [{ experiment: 'hero', slots: [{ slot: 'control' }, { slot: 'variantA' }] }] })
  await expect(handleWrapBlock(f.req, { options: f.options })).rejects.toMatchObject({ code: 'wrap-target-missing' })
  f.req.data = { ...f.req.data, collection: 'unknown' }
  await expect(handleWrapBlock(f.req, { options: f.options })).rejects.toMatchObject({ code: 'unknown-collection' })
})
test('onInit refuses registered fields missing their Experiment block before transaction probing', async () => {
  const f = fixture()
  f.payload.config.collections[0]!.fields = []
  await expect(createOnInit(f.options)(f.payload)).rejects.toThrow('must contain xpExperiment')
})

test('onInit accepts a custom Experiment block through unnamed tabs', async () => {
  const f = fixture()
  f.options.blocks!.collections[0]!.blockSlug = 'testBlock'
  f.payload.config.collections[0]!.fields = [{ type: 'tabs', tabs: [{ label: 'Content', fields: [{ name: 'layout', type: 'blocks', blocks: [{ slug: 'testBlock', fields: [] }] }] }] }]
  Object.assign(f.payload.db, { packageName: '@payloadcms/db-postgres' })
  await expect(createOnInit(f.options)(f.payload)).resolves.toBeUndefined()
})

test('wrap endpoint validates body, block kind and draft status before writing', async () => {
  const f = fixture()
  f.req.data = { collection: 'pages', id: 1, field: 'layout', blockId: 'source', experiment: 'hero', unexpected: true }
  await expect(handleWrapBlock(f.req, { options: f.options })).rejects.toMatchObject({ code: 'invalid-body' })
  delete f.req.data.unexpected
  f.payload.documents['xp-experiments']![0]!.kind = 'page'
  await expect(handleWrapBlock(f.req, { options: f.options })).rejects.toMatchObject({ code: 'invalid-body' })
  f.payload.documents['xp-experiments']![0]!.kind = 'block'
  f.payload.documents['xp-experiments']![0]!.status = 'running'
  await expect(handleWrapBlock(f.req, { options: f.options })).rejects.toMatchObject({ code: 'invalid-status' })
  expect(f.payload.calls.some(call => call.method === 'update')).toBe(false)
})

// Measured below 100 ms locally; each cap leaves CI headroom.
test.each(['data', 'stream'])('wrap caps its %s body at 16 KiB', async source => {
  const f = fixture()
  const data = { collection: 'pages', id: 1, field: 'layout', blockId: 'source', experiment: 'x'.repeat(16384) }
  if (source === 'data') f.req.data = data
  else Object.defineProperty(f.req, 'body', { value: new Request('https://host/wrap', { method: 'POST', body: JSON.stringify(data) }).body })
  await expect(handleWrapBlock(f.req, { options: f.options })).rejects.toMatchObject({ code: 'body-too-large', status: 413 })
  expect(f.payload.calls).toEqual([])
}, 5000)

test('wrap refuses locked-placement when another editor owns the lock', async () => {
  const f = fixture()
  f.payload.documents.pages![0]!.layout = [{ id: 'source', blockType: 'text' }]
  f.req.data = { collection: 'pages', id: 1, field: 'layout', blockId: 'source', experiment: 'hero' }
  vi.spyOn(f.payload, 'update').mockRejectedValue(new Locked('Page is locked'))
  await expect(handleWrapBlock(f.req, { options: f.options })).rejects.toMatchObject({ code: 'locked-placement', status: 409 })
}, 5000)

test.each([
  ['group', { name: 'group', type: 'group', fields: [] }],
  ['sections', { name: 'sections', type: 'array', fields: [] }],
  ['content', { type: 'tabs', tabs: [{ name: 'content', label: 'Content', fields: [] }] }],
] as const)('onInit refuses a registered blocks field nested in %s and names its path', async (name, container) => {
  const f = fixture(), field = f.payload.config.collections[0]!.fields[0]!
  const nested = structuredClone(container) as unknown as import('payload').Field
  if (nested.type === 'tabs') nested.tabs[0]!.fields = [field]
  else if ('fields' in nested) nested.fields = [field]
  f.payload.config.collections[0]!.fields = [nested]
  await expect(createOnInit(f.options)(f.payload)).rejects.toThrow(`pages.${name}.layout must be a top-level blocks field`)
}, 5000)
