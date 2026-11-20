import { afterEach, expect, test, vi } from 'vitest'
import { buildEndpoints } from '../../src/endpoints/index.js'
import { compileManifest } from '../../src/manifest/compile.js'
import type { ManifestInputExperiment, ManifestPhase } from '../../src/manifest/compile.js'
import { sampleOptions } from '../collections/fixtures.js'
import { fakePayload } from '../_fakes/payload.js'
import { fakeReq } from '../_fakes/req.js'

afterEach(() => vi.useRealTimers())

const phase: ManifestPhase = { phase: 1, phaseKind: 'test', seed: 'seed|', allocation: 100, targeting: [], arms: [
  { key: 'control', kind: 'control', label: 'Current hero', weight: 50, slot: 'control', pageTarget: '/original' },
  { key: 'variantA', kind: 'variant', label: 'New welcome', weight: 50, slot: 'variantA', pageTarget: '/new' },
] }
const experiment: ManifestInputExperiment = { id: 'test', slug: 'welcome', kind: 'block', status: 'archived', unitType: 'visitor', exposurePolicy: 'render',
  arms: [], decision: { winnerArm: 'variantA' }, currentPhase: null }
const slot = (visibility?: unknown) => ({ type: 'ExperimentSlot', props: { experiment: { slug: 'welcome' }, control: [{}], variantA: [{}], _visibility: visibility } })
function setup(change: Partial<ManifestInputExperiment> = {}, manage = true, signedIn = true) {
  const options = sampleOptions()
  options.access = { manage: vi.fn(() => manage), readResults: () => true }
  options.puck = { enabled: true, collections: ['pages'] }
  options.blocks = { collections: [{ slug: 'articles', field: 'layout' }] }
  options.pages = { collections: [{ slug: 'pages', pathOf: doc => `/site/${doc.slug}`, findByPath: async () => null }, { slug: 'articles', pathOf: doc => `/${doc.slug}`, findByPath: async () => null }] }
  const payload = fakePayload({ config: { collections: [{ slug: 'pages', fields: [], versions: { drafts: true }, admin: { useAsTitle: 'headline' } }, { slug: 'articles', fields: [] }] }, collections: {
    'xp-experiments': [{ ...experiment, ...change }], 'xp-phases': [{ ...phase, id: 'phase', experiment: 'test' }],
    pages: [{ id: 1, headline: 'Added after the decision', slug: 'welcome', _status: 'published', puckData: { content: [slot(), slot()] } },
      { id: 2, title: 'Hidden', _status: 'published', puckData: { content: [slot({ hidden: true })] } },
      { id: 3, title: 'Draft', _status: 'draft', puckData: { content: [slot()] } }],
  } })
  payload.config.custom!.xp = options
  payload.findGlobal = vi.fn(async () => ({ flagDefaults: {} })) as typeof payload.findGlobal
  const req = fakeReq({ payload, routeParams: { id: 'test' }, user: signedIn ? { id: 'manager' } : null })
  const endpoint = buildEndpoints({ options }).find(route => route.path === '/xp/experiments/:id/delete-impact')!
  return { options, payload, req, read: () => endpoint.handler(req) }
}
test.each([[true, true, 200], [false, true, 403], [true, false, 401]] as const)('delete impact requires a manager (manage=%s, signed in=%s)', async (manage, signedIn, status) => {
  const { read, payload } = setup({}, manage, signedIn)
  expect((await read()).status).toBe(status)
  if (status !== 200) expect(payload.calls).toEqual([])
})
test('uses current published placements, not the decision report, and lists each page once', async () => {
  const { read, payload, req } = setup()
  payload.documents['xp-experiments']![0]!.decision = { winnerArm: 'variantA', contentReport: { docs: [{ collection: 'pages', id: 1, ok: true }] } }
  const response = await read()
  expect(response.headers.get('Cache-Control')).toContain('no-store')
  expect(await response.json()).toEqual({ effect: 'block', controlLabel: 'Current hero', unreadablePages: 0, pageCount: 1, placements: [{ collection: 'pages', id: 1,
    title: 'Added after the decision', path: '/site/welcome', before: { key: 'variantA', label: 'New welcome' }, after: { key: 'control', label: 'Current hero' } }] })
  expect(payload.calls[0]!.args).toMatchObject({ req, overrideAccess: false })
  expect(payload.calls.some(call => call.args.collection === 'pages' && call.args.overrideAccess === true)).toBe(true)
  expect(payload.dbCalls).toEqual([])
  expect(payload.calls.filter(call => call.args.collection === 'pages').every(call => call.args.draft === false)).toBe(true)
})
test.each(['self', 'ancestor', 'zone', 'sizes', 'partial'] as const)('shares the placement visibility rules: %s', async mode => {
  const { read, payload } = setup()
  const hidden = slot(mode === 'sizes' ? { hideOn: ['phone', 'tablet', 'desktop'] } : mode === 'partial' ? { hideOn: ['phone'] } : { hidden: true })
  payload.documents.pages = [{ id: 1, _status: 'published', puckData: mode === 'ancestor' || mode === 'zone'
    ? { content: [{ type: 'Container', props: { id: 'owner', _visibility: { hidden: true }, children: mode === 'ancestor' ? [slot()] : [] } }], zones: mode === 'zone' ? { 'owner:children': [slot()] } : {} }
    : { content: [hidden] } }]
  const result = await (await read()).json()
  expect(result.effect).toBe(mode === 'partial' ? 'block' : 'none')
})
test('native Experiment blocks use their registered field and published slug', async () => {
  const { read, payload } = setup()
  payload.documents.pages = []
  payload.documents.articles = [{ id: 5, title: 'Article', slug: 'article', layout: [{ blockType: 'xpExperiment', experiment: 'welcome', slots: [
    { slot: 'control', blocks: [{ blockType: 'text' }] }, { slot: 'variantA', blocks: [{ blockType: 'text' }] },
  ] }] }]
  expect(await (await read()).json()).toMatchObject({ effect: 'block', placements: [{ collection: 'articles', id: 5, title: 'Article', path: '/article' }] })
})
test('native blocks with an empty winner already show Original', async () => {
  const { read, payload } = setup()
  payload.documents.pages = []
  payload.documents.articles = [{ id: 5, layout: [{ blockType: 'xpExperiment', experiment: 'welcome', slots: [{ slot: 'control', blocks: [{ blockType: 'text' }] }] }] }]
  expect(await (await read()).json()).toEqual({ effect: 'none' })
})
test.each(['block', 'page', 'flag', 'code'] as const)('draft %s has no visitor effect without reading phases or pages', async kind => {
  const { read, payload } = setup({ kind, status: 'draft' })
  expect(await (await read()).json()).toEqual({ effect: 'none' })
  expect(payload.calls).toHaveLength(1)
})
test.each(['running', 'stopped', 'decided'] as const)('a test that cannot be deleted (%s) gets a status refusal', async status => {
  const { read } = setup({ status })
  const response = await read()
  expect(response.status).toBe(409)
  expect(await response.json()).toMatchObject({ errors: [{ code: 'invalid-status' }] })
})
test.each([
  { kind: 'flag' }, { kind: 'code' }, { decision: {} }, { decision: { winnerArm: 'variantA', discardedAt: 'date' } },
  { decision: { winnerArm: 'control' } }, { kind: 'page', decision: { winnerArm: 'variantA', discardedAt: 'date' } },
  { kind: 'page', decision: { winnerArm: 'control', pagesReleasedAt: 'date' } }, { kind: 'page', decision: { winnerArm: 'variantA', pagesReleasedAt: 'date' } },
] as Partial<ManifestInputExperiment>[])('no current visitor effect: %j', async change => {
  expect(await (await setup(change).read()).json()).toEqual({ effect: 'none' })
})
test('no remaining references means no effect', async () => {
  const { read, payload } = setup()
  payload.documents.pages = []
  expect(await (await read()).json()).toEqual({ effect: 'none' })
})
test.each(['control', 'variantA'])('page addresses exactly match compiled archived routing when %s won', async winnerArm => {
  const changed = { ...experiment, kind: 'page' as const, decision: { winnerArm } }
  const { read } = setup(changed)
  const routing = compileManifest({ experiments: [{ ...changed, lastTestPhase: phase }], flagDefaults: {} }, 1).archivedPages
  expect(await (await read()).json()).toEqual({ effect: 'page', winnerPath: phase.arms.find(arm => arm.key === winnerArm)!.pageTarget,
    addresses: Object.keys(routing) })
})
test('a missing test returns the usual not-found envelope', async () => {
  const { read, payload } = setup()
  payload.documents['xp-experiments'] = []
  const response = await read()
  expect(response.status).toBe(404)
  expect(await response.json()).toMatchObject({ errors: [{ code: 'not-found' }] })
})
test('scan failures propagate rather than reporting no effect', async () => {
  const { read, payload } = setup()
  const find = payload.find.bind(payload)
  vi.spyOn(payload, 'find').mockImplementation(args => args.collection === 'pages' ? Promise.reject(new Error('Unavailable')) : find(args))
  await expect(read()).rejects.toThrow('Unavailable')
})

test('missing frozen phase data fails the check instead of promising no effect', async () => {
  const { read, payload } = setup()
  payload.documents['xp-phases'] = []
  const response = await read()
  expect(response.status).toBe(422)
  expect(await response.json()).toMatchObject({ errors: [{ code: 'placement-unchecked', message: 'The effect of deleting this test could not be determined.' }] })
})
test.each(['throw', 'stall', 'object', 'tokenized'] as const)('preview callback cannot supply the public path or disrupt the read: %s', async mode => {
  const { read, options } = setup()
  options.admin = { previewUrl: vi.fn(() => { if (mode === 'throw') throw new Error('host failure'); return mode === 'stall' ? new Promise<string>(() => {}) : mode === 'object' ? {} as never : 'https://preview.test/?token=secret' }) }
  expect((await (await read()).json()).placements.every((p: { path: string }) => p.path === '/site/welcome')).toBe(true)
  expect(options.admin.previewUrl).not.toHaveBeenCalled()
  options.pages = undefined
  expect((await (await read()).json()).placements.every((p: { path: string | null }) => p.path === null)).toBe(true)
})
test('plain-string Puck bindings are already on control and do not change', async () => {
  const { read, payload } = setup()
  payload.documents.pages = [{ id: 1, _status: 'published', puckData: { content: [{ ...slot(), props: { ...slot().props, experiment: 'welcome' } }] } }]
  expect(await (await read()).json()).toEqual({ effect: 'none' })
})
test.each([[0, 1, 'empty', 'control'], [1, 0, 'variantA', 'empty'], [0, 0, null, null]] as const)('Puck empty winner/control lengths %s/%s match what is served', async (before, after, beforeKey, afterKey) => {
  const { read, payload } = setup()
  payload.documents.pages = [{ id: 1, _status: 'published', puckData: { content: [{ type: 'ExperimentSlot', props: { experiment: { slug: 'welcome' }, variantA: Array(before).fill({}), control: Array(after).fill({}) } }] } }]
  expect(await (await read()).json()).toMatchObject(beforeKey ? { effect: 'block', placements: [{ before: { key: beforeKey }, after: { key: afterKey } }] } : { effect: 'none' })
})
test('full manifest collisions determine which archived page test serves an address', async () => {
  const { read, payload } = setup({ kind: 'page' })
  payload.documents['xp-experiments']!.push({ ...experiment, id: 'other', slug: 'other', kind: 'page' })
  payload.documents['xp-phases']!.push({ ...phase, id: 'other-phase', experiment: 'other' })
  expect(await (await read()).json()).toEqual({ effect: 'none' })
})
test.each(['hidden', 'locale', 'mixed'] as const)('visitor scan includes inaccessible and localized content: %s', async mode => {
  const { read, payload } = setup()
  const localization = { defaultLocale: 'en', localeCodes: ['en', 'fr'], locales: [{ code: 'en' }, { code: 'fr' }], fallback: false }
  Object.assign(payload.config, { localization, collections: [{ slug: 'pages', fields: [{ name: 'puckData', type: 'json', localized: true }] }, { slug: 'articles', fields: [] }] })
  payload.documents.pages = [
    { id: 1, title: 'Readable', slug: 'public', tenant: 'mine', puckData: { en: { content: [] }, fr: { content: [slot()] } } },
    ...(mode === 'locale' ? [] : [{ id: 2, title: 'SECRET', slug: 'SECRET', tenant: 'other', puckData: { en: { content: [slot(), slot()] }, fr: { content: [slot()] } } }]),
  ]
  const find = payload.find.bind(payload)
  vi.spyOn(payload, 'find').mockImplementation(async args => {
    // Emulate Payload combining a tenant-scoped read Where with the caller's query.
    const result = await find(args.collection === 'pages' && args.overrideAccess === false ? { ...args, where: { and: [args.where ?? {}, { tenant: { equals: mode === 'hidden' ? 'none' : 'mine' } }] } } : args)
    if (args.collection === 'pages' && args.locale !== 'all') result.docs = result.docs.map(doc => ({ ...doc, puckData: (doc.puckData as Record<string, unknown>)[String(args.locale ?? 'en')] }))
    return result
  })
  const result = await (await read()).json()
  expect(result).toMatchObject({ effect: 'block', unreadablePages: mode === 'locale' ? 0 : mode === 'hidden' ? 2 : 1, pageCount: mode === 'locale' ? 1 : 2 })
  expect(result.placements).toHaveLength(mode === 'hidden' ? 0 : 1)
  expect(JSON.stringify(result)).not.toContain('SECRET')
  expect(payload.calls.some(call => call.args.collection === 'pages' && call.args.overrideAccess === true && call.args.locale === 'all')).toBe(true)
})

test('deleting a colliding page route reveals the other compiled route rather than its own page', async () => {
  const { read, payload } = setup({ kind: 'page' })
  payload.documents['xp-experiments']!.unshift({ ...experiment, id: 'older', slug: 'older', kind: 'page' })
  payload.documents['xp-phases']!.push({ ...phase, id: 'older-phase', experiment: 'older', arms: phase.arms.map(arm => arm.key === 'variantA' ? { ...arm, pageTarget: '/older-winner' } : arm) })
  expect(await (await read()).json()).toEqual({ effect: 'page', winnerPath: '/new', addresses: ['/original'], afterPaths: { '/original': '/older-winner' } })
})

// Payload's locale:'all' result preserves the stored locale maps even with fallback enabled.
test.each(['puck', 'blocks'] as const)('fallback locales do not duplicate %s pages; own locales share one row', async editor => {
  const { read, payload, options } = setup()
  options.blocks = { collections: [{ slug: 'pages', field: 'layout', appliesTo: () => editor === 'blocks' }] }
  const field = editor === 'puck' ? 'puckData' : 'layout'
  const content = editor === 'puck' ? { content: [slot(), slot()] } : [{ blockType: 'xpExperiment', experiment: 'welcome', slots: [
    { slot: 'control', blocks: [{ blockType: 'text' }] }, { slot: 'variantA', blocks: [{ blockType: 'text' }] },
  ] }]
  Object.assign(payload.config, { localization: { defaultLocale: 'en', localeCodes: ['en', 'fr', 'de'], locales: [{ code: 'en' }, { code: 'fr' }, { code: 'de' }], fallback: true },
    collections: [{ slug: 'pages', fields: [{ name: field, type: 'json', localized: true }] }] })
  payload.documents.pages = [{ id: 1, title: 'English only', slug: 'one', [field]: { en: content } },
    { id: 2, title: 'Two languages', slug: 'two', [field]: { en: content, fr: content } }]
  const find = payload.find.bind(payload)
  vi.spyOn(payload, 'find').mockImplementation(async args => {
    const result = await find(args)
    if (args.collection === 'pages' && args.locale !== 'all') result.docs = result.docs.map(doc => {
      const values = doc[field] as Record<string, unknown>
      return { ...doc, [field]: values[String(args.locale ?? 'en')] ?? (args.fallbackLocale === false ? undefined : values.en) }
    })
    return result
  })
  const result = await (await read()).json()
  expect(result).toMatchObject({ effect: 'block', pageCount: 2, unreadablePages: 0, placements: [
    { id: 1, locales: ['en'] }, { id: 2, locales: ['en', 'fr'] },
  ] })
  expect(result.placements).toHaveLength(2)
  const scans = payload.calls.filter(call => call.args.collection === 'pages' && call.args.overrideAccess === true)
  expect(scans).toHaveLength(1)
  expect(scans[0]!.args).toMatchObject({ locale: 'all', fallbackLocale: false, limit: 100 })
})
test('abort after a scan page stops before readability, the next page or collection', async () => {
  const { read, req, payload } = setup()
  const controller = new AbortController(); Object.assign(req, { signal: controller.signal })
  const find = payload.find.bind(payload)
  vi.spyOn(payload, 'find').mockImplementation(async args => {
    const result = await find(args)
    if (args.collection === 'pages' && args.overrideAccess === true) { controller.abort(); result.hasNextPage = args.page === 1 }
    return result
  })
  await expect(read()).rejects.toMatchObject({ name: 'AbortError' })
  expect(payload.calls.filter(call => ['pages', 'articles'].includes(String(call.args.collection)))).toHaveLength(1)
})
test.each(['missing-rollout-test', 'missing-current', 'incomplete-layer'] as const)('unrelated routing failure is an unchecked impact: %s', async mode => {
  const { read, payload } = setup()
  payload.documents['xp-experiments']!.push({ ...experiment, id: 'other', slug: 'private-name', status: 'running', ...(mode === 'incomplete-layer' ? { layer: 'layer' } : {}) })
  if (mode !== 'missing-current') payload.documents['xp-phases']!.push({ ...phase, id: 'other-phase', experiment: 'other', phaseKind: mode === 'missing-rollout-test' ? 'rollout' : 'test' })
  const response = await read()
  expect(response.status).toBe(422)
  const body = await response.json()
  expect(body).toMatchObject({ errors: [{ code: 'placement-unchecked' }] })
  expect(JSON.stringify(body)).not.toContain('private-name')
})
test.each([undefined, null, 123, '/site/undefined', '/site/null', '/site/%75ndefined'])('unusable access-filtered public path %s is omitted', async path => {
  const { read, options } = setup()
  options.pages!.collections[0]!.pathOf = () => path as never
  expect((await (await read()).json()).placements).toMatchObject([{ path: null }])
})
test('readable page with an inaccessible layout still uses only readable metadata', async () => {
  const { read, payload } = setup()
  const find = payload.find.bind(payload)
  vi.spyOn(payload, 'find').mockImplementation(async args => {
    const result = await find(args)
    if (args.collection === 'pages' && args.overrideAccess === false) result.docs = result.docs.map(({ puckData, slug, ...doc }) => doc)
    return result
  })
  expect(await (await read()).json()).toMatchObject({ pageCount: 1, unreadablePages: 0, placements: [{ title: 'Added after the decision', path: null }] })
})
test('a non-403 readability failure rejects the whole check without disclosing a partial result', async () => {
  const { read, payload } = setup()
  const find = payload.find.bind(payload)
  vi.spyOn(payload, 'find').mockImplementation(args => args.collection === 'pages' && args.overrideAccess === false ? Promise.reject(new Error('Read failed')) : find(args))
  await expect(read()).rejects.toThrow('Read failed')
})

test('201 published pages take three scan pages and no locale-multiplied reads', async () => {
  const { read, payload } = setup()
  Object.assign(payload.config, { localization: { defaultLocale: 'en', localeCodes: ['en', 'fr', 'de'], locales: [{ code: 'en' }, { code: 'fr' }, { code: 'de' }], fallback: true },
    collections: [{ slug: 'pages', fields: [{ name: 'puckData', type: 'json', localized: true }] }, { slug: 'articles', fields: [] }] })
  payload.documents.pages = Array.from({ length: 201 }, (_, i) => ({ id: i, puckData: { en: { content: [slot()] } } }))
  expect(await (await read()).json()).toMatchObject({ effect: 'block', pageCount: 201, unreadablePages: 0 })
  expect(payload.calls.filter(call => call.args.collection === 'pages' && call.args.overrideAccess === true).map(call => call.args.page)).toEqual([1, 2, 3])
  expect(payload.calls.filter(call => call.args.collection === 'pages' && call.args.overrideAccess === false)).toHaveLength(3)
})
test('a page without affected placements needs no readability read', async () => {
  const { read, payload } = setup()
  payload.documents.pages = [{ id: 1, puckData: { content: [] } }]
  expect(await (await read()).json()).toEqual({ effect: 'none' })
  expect(payload.calls.filter(call => call.args.collection === 'pages' && call.args.overrideAccess === false)).toHaveLength(0)
})
test('disabled Puck registration is not scanned', async () => {
  const { read, options, payload } = setup()
  options.puck!.enabled = false
  expect(await (await read()).json()).toEqual({ effect: 'none' })
  expect(payload.calls.some(call => call.args.collection === 'pages')).toBe(false)
})

test('abort during manifest phase loading stops before more manifest reads', async () => {
  const { read, payload, req } = setup()
  const controller = new AbortController(); Object.assign(req, { signal: controller.signal })
  const find = payload.find.bind(payload)
  vi.spyOn(payload, 'find').mockImplementation(async args => {
    const result = await find(args)
    if (args.collection === 'xp-phases') controller.abort()
    return result
  })
  await expect(read()).rejects.toMatchObject({ name: 'AbortError' })
  expect(payload.findGlobal).not.toHaveBeenCalled()
  expect(payload.calls.some(call => call.args.collection === 'pages')).toBe(false)
})
