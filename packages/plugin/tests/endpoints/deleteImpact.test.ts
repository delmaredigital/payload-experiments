import { expect, test, vi } from 'vitest'
import { buildEndpoints } from '../../src/endpoints/index.js'
import { compileManifest } from '../../src/manifest/compile.js'
import type { ManifestInputExperiment, ManifestPhase } from '../../src/manifest/compile.js'
import { sampleOptions } from '../collections/fixtures.js'
import { fakePayload } from '../_fakes/payload.js'
import { fakeReq } from '../_fakes/req.js'

const phase: ManifestPhase = { phase: 1, phaseKind: 'test', seed: 'seed|', allocation: 100, targeting: [], arms: [
  { key: 'control', kind: 'control', label: 'Original', weight: 50, slot: 'control', pageTarget: '/original' },
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
  const payload = fakePayload({ config: { collections: [{ slug: 'pages', versions: { drafts: true }, admin: { useAsTitle: 'headline' } }, { slug: 'articles' }] }, collections: {
    'xp-experiments': [{ ...experiment, ...change }], 'xp-phases': [{ ...phase, id: 'phase', experiment: 'test' }],
    pages: [{ id: 1, headline: 'Added after the decision', slug: 'welcome', _status: 'published', puckData: { content: [slot(), slot()] } },
      { id: 2, title: 'Hidden', _status: 'published', puckData: { content: [slot({ hidden: true })] } },
      { id: 3, title: 'Draft', _status: 'draft', puckData: { content: [slot()] } }],
  } })
  const req = fakeReq({ payload, routeParams: { id: 'test' }, user: signedIn ? { id: 'manager' } : null })
  const endpoint = buildEndpoints({ options }).find(route => route.path === '/xp/experiments/:id/delete-impact')!
  return { options, payload, req, read: () => endpoint.handler(req) }
}
test.each([[true, true, 200], [false, true, 403], [true, false, 401]] as const)('delete impact requires a manager (manage=%s, signed in=%s)', async (manage, signedIn, status) => {
  const { read, payload } = setup({}, manage, signedIn)
  expect((await read()).status).toBe(status)
  if (status !== 200) expect(payload.calls).toEqual([])
})
test('uses current published placements, not the decision report, and retains each occurrence', async () => {
  const { read, payload, req } = setup()
  payload.documents['xp-experiments']![0]!.decision = { winnerArm: 'variantA', contentReport: { docs: [{ collection: 'pages', id: 1, ok: true }] } }
  const response = await read()
  expect(response.headers.get('Cache-Control')).toContain('no-store')
  expect(await response.json()).toEqual({ effect: 'block', placements: [1, 2].map(() => ({ collection: 'pages', id: 1,
    title: 'Added after the decision', path: '/site/welcome', before: { key: 'variantA', label: 'New welcome' }, after: { key: 'control', label: 'Original' } })) })
  for (const call of payload.calls) expect(call.args).toMatchObject({ req, overrideAccess: false })
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
  expect(response.status).toBe(409)
  expect(await response.json()).toMatchObject({ errors: [{ code: 'invalid-status' }] })
})
test('published preview adapter supplies paths when the collection has no page routing adapter', async () => {
  const { read, options } = setup()
  options.pages = undefined
  options.admin = { previewUrl: vi.fn(async place => `/published/${place.id}`) }
  expect(await (await read()).json()).toMatchObject({ effect: 'block', placements: [{ path: '/published/1' }, { path: '/published/1' }] })
  expect(options.admin.previewUrl).toHaveBeenCalledWith(expect.objectContaining({ published: true, id: 1 }))
})
