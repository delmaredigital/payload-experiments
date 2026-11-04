import { createLocalReq, type PayloadRequest } from 'payload'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { createIntegrationHarness } from './harness.js'
import { createExperimentBlock } from '../src/blocks/createExperimentBlock.js'
import { wrapExperimentBlock } from '../src/blocks/formState.js'
import { start } from '../src/transitions/start.js'
import { stop } from '../src/transitions/stop.js'
import { decide } from '../src/transitions/decide.js'
import { makeContent } from '../src/transitions/makeContent.js'
import { lockTransitionScope } from '../src/db/locks.js'
import { txExecutor } from '../src/db/executor.js'
import { isPageBusy } from '../src/db/pageBusy.js'
import type { ResolvedOptions, DocId } from '../src/types/contracts.js'

// Train-only: exp-core measures these on serial and uuid. No network database in this lane.
let harness: Awaited<ReturnType<typeof createIntegrationHarness>>
let sequence = 0
let race: { held?: DocId; editorHasX: () => void; editorReady: Promise<void>; makeEntered: () => void; makeReady: Promise<void> } | undefined
function deferred() { let resolve!: () => void; return { promise: new Promise<void>(r => { resolve = r }), resolve: () => resolve() } }
beforeAll(async () => {
  const blocks = [{ slug: 'text', fields: [{ name: 'text', type: 'text' as const }] }]
  harness = await createIntegrationHarness({
    collections: [{ slug: 'guard-pages', versions: { drafts: true },
      access: { create: () => true, read: () => true, update: () => true, delete: () => true, readVersions: () => true, unlock: () => true },
      fields: [{ name: 'slug', type: 'text' }, { name: 'puckData', type: 'json' }, { name: 'layout', type: 'blocks', blocks: [...blocks, createExperimentBlock({ blocks })] }],
      hooks: { beforeChange: [async ({ req, data }) => {
        if (race && req.context.placementEditor) {
          await lockTransitionScope(txExecutor(req), { experimentId: race.held! })
          race.editorHasX(); await race.makeReady
        } else if (race && req.context.xpHeldExperiments) {
          race.makeEntered(); await race.editorReady
        }
        return data
      }] },
    }],
    puckCollections: ['guard-pages'], blocks: { collections: [{ slug: 'guard-pages', field: 'layout', appliesTo: doc => !doc.puckData }] },
    pages: { collections: [{ slug: 'guard-pages', pathOf: doc => typeof doc.slug === 'string' ? `/${doc.slug}` : null,
      findByPath: async (path, req) => {
        const { docs } = await req.payload.find({ collection: 'guard-pages', req, overrideAccess: false, draft: false, where: { slug: { equals: path.slice(1) } } })
        return docs[0] ? { id: docs[0].id, published: docs[0]._status === 'published' } : null
      } }] },
  })
}, 60_000) // Train must record bootstrap duration (<20 s).
afterAll(async () => { await harness?.teardown() })
const options = () => harness.payload.config.custom!.xp as ResolvedOptions
const request = () => createLocalReq({}, harness.payload)
async function experiment(kind: 'block' | 'page', targets?: string[]) {
  const req = await request(), suffix = ++sequence
  const metric = await harness.payload.create({ collection: 'xp-metrics', req, overrideAccess: true, data: { name: 'Goal', slug: `placement-goal-${suffix}`, source: 'binomial', direction: 'increase' } })
  return harness.payload.create({ collection: 'xp-experiments', req, overrideAccess: true, data: { name: `Placement ${suffix}`, slug: `placement-${suffix}`, kind,
    unitType: 'visitor', allocation: 100, exposurePolicy: kind === 'block' ? 'render' : 'pageview', ...(kind === 'page' ? { pageCollection: 'guard-pages' } : {}),
    arms: [{ key: 'control', label: 'Original', kind: 'control', weight: 50, ...(kind === 'block' ? { slot: 'control' } : { pageTarget: targets![0] }) },
      { key: 'variantA', label: 'Variant A', kind: 'variant', weight: 50, ...(kind === 'block' ? { slot: 'variantA' } : { pageTarget: targets![1] }) }],
    metrics: { primary: metric.id }, analysis: { plannedDurationDays: 14, reachPerDay: 100 } } })
}
const puck = (slug: string) => ({ type: 'ExperimentSlot', props: { id: `slot-${slug}`, experiment: { slug }, control: [{ type: 'Text', props: { text: 'Original' } }], variantA: [{ type: 'Text', props: { text: 'Winner' } }] } })
async function blockFixture(editor: 'blocks' | 'puck', extra?: string, existing?: Awaited<ReturnType<typeof experiment>>) {
  const testDoc = existing ?? await experiment('block'), req = await request()
  const layout = wrapExperimentBlock({ blockType: 'text', text: 'Original' }, String(testDoc.slug))
  layout.slots[1]!.blocks[0]!.text = 'Winner'
  const page = await harness.payload.create({ collection: 'guard-pages', req, overrideAccess: false, data: { slug: `placement-page-${sequence}`, _status: 'published',
    ...(editor === 'blocks' ? { layout: [layout, ...(extra ? [wrapExperimentBlock({ blockType: 'text', text: 'Other' }, extra)] : [])] } : { puckData: { content: [puck(String(testDoc.slug))] } }) } })
  await start(req, { experimentId: testDoc.id, options: options() })
  await stop(req, { experimentId: testDoc.id })
  await decide(req, { experimentId: testDoc.id, winnerArm: 'variantA', note: 'Ship', confirmation: 'Variant A' })
  return { req, testDoc, page }
}
test.each(['blocks', 'puck'] as const)('make-content of decided %s placements completes with guard installed', async editor => {
  const { req, testDoc, page } = await blockFixture(editor)
  const result = await makeContent(req, { experimentId: testDoc.id, options: options() })
  expect(result.docs).toContainEqual({ collection: 'guard-pages', id: page.id, ok: true })
}, 30_000) // Train must measure <10 s; guard wait bound is 5 s.
test('editor holding earlier X racing make-content T finishes retryably rather than waiting on its caller', async () => {
  const candidates = [await experiment('block'), await experiment('block')].sort((a, b) => String(a.id) < String(b.id) ? -1 : 1)
  const x = candidates[0]!
  const { testDoc, page } = await blockFixture('blocks', String(x.slug), candidates[1]!)
  await start(await request(), { experimentId: x.id, options: options() })
  const xReady = deferred(), makeReady = deferred()
  race = { held: x.id, editorHasX: xReady.resolve, editorReady: xReady.promise, makeEntered: makeReady.resolve, makeReady: makeReady.promise }
  try {
    const editorReq = await request(); editorReq.context.placementEditor = true
    const editing = harness.payload.update({ collection: 'guard-pages', id: page.id, req: editorReq, overrideAccess: false, data: { _status: 'published' } })
    await xReady.promise
    const shipping = makeContent(await request(), { experimentId: testDoc.id, options: options() })
    const [editor, result] = await Promise.allSettled([editing, shipping])
    const retryable = editor.status === 'rejected' && (editor.reason.code === 'page-busy' || isPageBusy(editor.reason))
    const updateFailed = result.status === 'fulfilled' && result.value.docs.some(doc => doc.detail === 'update-failed')
    expect(retryable || updateFailed).toBe(true)
    expect(result.status).toBe('fulfilled')
  } finally { race = undefined }
}, 30_000) // Train must measure <10 s; deliberately exercises the 5 s timeout.
async function pageFixture() {
  const suffix = ++sequence, req = await request()
  const pages = await Promise.all(['original', 'version'].map(label => harness.payload.create({ collection: 'guard-pages', req: undefined, overrideAccess: false, data: { slug: `${label}-${suffix}`, _status: 'published' } })))
  const testDoc = await experiment('page', pages.map(page => `/${page.slug}`))
  await start(req, { experimentId: testDoc.id, options: options() }); await stop(req, { experimentId: testDoc.id })
  return { testDoc, page: pages[0]! }
}
test('publishing Original and deciding from stopped serialize E before paths', async () => {
  const { page, testDoc } = await pageFixture()
  const result = await Promise.allSettled([
    harness.payload.update({ collection: 'guard-pages', id: page.id, req: await request(), overrideAccess: false, data: { _status: 'published' } }),
    decide(await request(), { experimentId: testDoc.id, winnerArm: 'variantA', note: 'Ship', confirmation: 'Variant A' }),
  ])
  expect(result.map(row => row.status)).toEqual(['fulfilled', 'fulfilled'])
}, 30_000) // Train must measure <10 s.
test('KI-6 adjacent-path publish racing Start never acquires path before E', async () => {
  const { page, testDoc } = await pageFixture()
  const adjacent = await harness.payload.create({ collection: 'guard-pages', req: await request(), overrideAccess: false, data: { slug: `adjacent-${++sequence}`, _status: 'published' } })
  const outcomes = await Promise.allSettled([
    harness.payload.update({ collection: 'guard-pages', id: adjacent.id, req: await request(), overrideAccess: false, data: { slug: page.slug, _status: 'published' } }),
    start(await request(), { experimentId: testDoc.id, options: options() }),
  ])
  for (const outcome of outcomes) if (outcome.status === 'rejected') expect(isPageBusy(outcome.reason) || outcome.reason.code === 'page-busy' || outcome.reason.code === 'page-target-unpublished').toBe(true)
}, 30_000) // Train must measure <10 s.
