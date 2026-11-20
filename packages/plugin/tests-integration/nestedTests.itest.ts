import { createLocalReq } from 'payload'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { createIntegrationHarness } from './harness.js'
import { preflightData } from '../src/transitions/preflightData.js'
import { start } from '../src/transitions/start.js'
import type { ResolvedOptions } from '../src/types/contracts.js'

let harness: Awaited<ReturnType<typeof createIntegrationHarness>>
let sequence = 0
beforeAll(async () => {
  harness = await createIntegrationHarness({
    localization: { defaultLocale: 'en', locales: ['en', 'es'], fallback: false },
    puckCollections: ['nested-pages', 'nested-localized'],
    collections: [{ slug: 'nested-pages', versions: { drafts: { autosave: true } },
      access: { create: () => true, read: () => true, update: () => true, delete: () => true, readVersions: () => true, unlock: () => true },
      fields: [{ name: 'title', type: 'text' }, { name: 'puckData', type: 'json' }],
    }, { slug: 'nested-localized', versions: { drafts: true },
      access: { create: () => true, read: () => true, update: () => true, delete: () => true, readVersions: () => true, unlock: () => true },
      fields: [{ name: 'title', type: 'text' }, { name: 'puckData', type: 'json', localized: true }],
    }],
  })
}, 60_000)
afterAll(async () => { await harness?.teardown() }, 60_000)
const request = () => createLocalReq({}, harness.payload)

async function fixture() {
  const { payload } = harness, suffix = ++sequence
  const metric = await payload.create({ collection: 'xp-metrics', req: await request(), overrideAccess: true,
    data: { name: 'Goal', slug: `nested-goal-${suffix}`, source: 'binomial', direction: 'increase' } })
  const tests = await Promise.all(['outer', 'inner'].map(async name => payload.create({ collection: 'xp-experiments', req: await request(), overrideAccess: true, data: {
    name: `${name} test ${suffix}`, slug: `${name}-test-${suffix}`, kind: 'block', unitType: 'visitor', allocation: 100, exposurePolicy: 'render',
    arms: [{ key: 'control', label: 'Original', kind: 'control', weight: 50, slot: 'control' },
      { key: 'variantA', label: 'Variant A', kind: 'variant', weight: 50, slot: 'variantA' }],
    metrics: { primary: metric.id }, analysis: { plannedDurationDays: 14, reachPerDay: 100 },
  } })))
  const [outer, inner] = tests.map((experiment, index) => ({ type: 'ExperimentSlot', props: {
    id: `nested-block-${suffix}-${index}`, experiment: { id: experiment.id, slug: experiment.slug },
    control: [{ type: 'Text', props: { id: `original-${suffix}-${index}`, text: 'Original' } }],
    variantA: [{ type: 'Text', props: { id: `variant-${suffix}-${index}`, text: 'Variant' } }],
  } }))
  const flat = { root: { props: {} }, content: [outer!, inner!] }
  const page = await payload.create({ collection: 'nested-pages', req: await request(), overrideAccess: false,
    data: { title: 'Nested page', puckData: flat, _status: 'published' } })
  const nested = { root: { props: {} }, content: [{ ...outer!, props: { ...outer!.props, control: [...outer!.props.control, inner!] } }] }
  return { payload, tests, page, flat, nested }
}
async function seed(f: Awaited<ReturnType<typeof fixture>>) {
  await f.payload.db.updateOne({ collection: 'nested-pages', id: f.page.id, req: await request(), data: { puckData: f.nested } })
  // Keep Payload's latest version consistent with the pre-release published row.
  await f.payload.update({ collection: 'nested-pages', id: f.page.id, req: await request(), overrideAccess: false,
    data: { puckData: f.nested, _status: 'published' } })
}
const options = () => harness.payload.config.custom!.xp as ResolvedOptions

test.each(['outer', 'inner', 'both'])('an already published nested page can be untangled with %s running', async running => {
  const f = await fixture()
  const { payload, tests, page, flat } = f
  for (const experiment of tests) if (running === 'both' || experiment.name.startsWith(running)) {
    await start(await request(), { experimentId: experiment.id, options: options() })
  }
  // Seed the published main row as a page from before the nesting rule. Adapter
  // writes bypass collection hooks; the real publish below must pass every guard.
  await seed(f)
  const saved = await payload.update({ collection: 'nested-pages', id: page.id, req: await request(), overrideAccess: false,
    data: { puckData: flat, _status: 'published' } })
  expect(saved.puckData).toEqual(flat)
}, 30_000)


test('new published nesting is refused with both test names', async () => {
  const f = await fixture()
  await expect(f.payload.update({ collection: 'nested-pages', id: f.page.id, req: await request(), overrideAccess: false,
    data: { puckData: f.nested, _status: 'published' } })).rejects.toThrow(`“${f.tests[1]!.name}” is inside a version of “${f.tests[0]!.name}”`)
})
test('already published nesting permits unrelated edits and republishing', async () => {
  const f = await fixture()
  await seed(f)
  const saved = await f.payload.update({ collection: 'nested-pages', id: f.page.id, req: await request(), overrideAccess: false,
    data: { title: 'Edited title', _status: 'published' } })
  expect(saved.title).toBe('Edited title')
  expect(saved.puckData).toEqual(f.nested)
})
test.each([false, true])('draft and autosave permit nesting; publishing that draft refuses it (autosave %s)', async autosave => {
  const f = await fixture()
  const saved = await f.payload.update({ collection: 'nested-pages', id: f.page.id, req: await request(), overrideAccess: false, draft: true, autosave,
    data: { puckData: f.nested, _status: 'draft' } })
  expect(saved.puckData).toEqual(f.nested)
  await expect(f.payload.update({ collection: 'nested-pages', id: f.page.id, req: await request(), overrideAccess: false,
    data: { _status: 'published' } })).rejects.toThrow('Move “')
})
test('Start readiness and Start itself refuse both tests in existing nesting', async () => {
  const f = await fixture()
  await seed(f)
  for (const experiment of f.tests) {
    const preflight = await preflightData(await request(), { experimentId: experiment.id, options: options() })
    expect(preflight?.checks.find(check => check.code === 'nested-tests')).toEqual({ code: 'nested-tests', ok: false,
      detail: [{ collection: 'nested-pages', id: f.page.id, title: 'Nested page', outer: f.tests[0]!.name, inner: f.tests[1]!.name }] })
    await expect(start(await request(), { experimentId: experiment.id, options: options() })).rejects.toMatchObject({ code: 'nested-tests' })
  }
})
test('a fully hidden inner test is not new published nesting or an outer Start blocker', async () => {
  const f = await fixture()
  const inner = f.nested.content[0]!.props.control[1]!
  Object.assign(inner.props, { _visibility: { hidden: true } })
  await f.payload.update({ collection: 'nested-pages', id: f.page.id, req: await request(), overrideAccess: false,
    data: { puckData: f.nested, _status: 'published' } })
  const preflight = await preflightData(await request(), { experimentId: f.tests[0]!.id, options: options() })
  expect(preflight?.checks.find(check => check.code === 'nested-tests')).toEqual({ code: 'nested-tests', ok: true })
  await start(await request(), { experimentId: f.tests[0]!.id, options: options() })
  delete (inner.props as Record<string, unknown>)._visibility
  await expect(f.payload.update({ collection: 'nested-pages', id: f.page.id, req: await request(), overrideAccess: false,
    data: { puckData: f.nested, _status: 'published' } })).rejects.toThrow('Move “')
})


test('publishing and Start check nesting in a nondefault content language', async () => {
  const f = await fixture()
  const page = await f.payload.create({ collection: 'nested-localized', req: await request(), overrideAccess: false, locale: 'en',
    data: { title: 'Localized page', puckData: f.flat, _status: 'published' } })
  await expect(f.payload.update({ collection: 'nested-localized', id: page.id, req: await request(), overrideAccess: false, locale: 'es',
    data: { puckData: f.nested, _status: 'published' } })).rejects.toThrow('Move “')
  // A pre-release published row with nesting only in Spanish.
  await f.payload.db.updateOne({ collection: 'nested-localized', id: page.id, req: await request(), data: { puckData: { en: f.flat, es: f.nested } } })
  for (const experiment of f.tests) {
    const answer = await preflightData(await request(), { experimentId: experiment.id, options: options() })
    expect(answer?.checks).toContainEqual({ code: 'nested-tests', ok: false, detail: [{ collection: 'nested-localized', id: page.id, title: 'Localized page · Languages: es', locales: ['es'], outer: f.tests[0]!.name, inner: f.tests[1]!.name }] })
  }
})


test('the first publish of a new page refuses nesting on create', async () => {
  const f = await fixture()
  await expect(f.payload.create({ collection: 'nested-pages', req: await request(), overrideAccess: false,
    data: { title: 'New nested page', puckData: f.nested, _status: 'published' } })).rejects.toThrow("so this page can't be published")
})
test('old nesting must be moved out before republishing an unpublished page', async () => {
  const f = await fixture()
  await seed(f)
  const unpublished = await f.payload.update({ collection: 'nested-pages', id: f.page.id, req: await request(), overrideAccess: false,
    data: { _status: 'draft' } })
  expect(unpublished._status).toBe('draft')
  await expect(f.payload.update({ collection: 'nested-pages', id: f.page.id, req: await request(), overrideAccess: false,
    data: { _status: 'published' } })).rejects.toThrow("so this page can't be published")
  const published = await f.payload.update({ collection: 'nested-pages', id: f.page.id, req: await request(), overrideAccess: false,
    data: { puckData: f.flat, _status: 'published' } })
  expect(published._status).toBe('published')
})
