import { expect, test, vi } from 'vitest'
import { scanBlockPlacements, flagPlacements } from '../../src/transitions/placements.js'
import { fakeReq } from '../_fakes/req.js'
import { fakePayload } from '../_fakes/payload.js'
import { sampleOptions } from '../collections/fixtures.js'
import { defaultArms } from '../../src/collections/experiments/armInvariants.js'
import { checkStart } from '../../src/transitions/checkStart.js'

const slot = (experiment: unknown, control: unknown[] = [{}], variantA: unknown[] = [{}, {}]) => ({ type: 'ExperimentSlot', props: { experiment, control, variantA } })
test('all placements use only the published main slug, including when a latest draft moves the page', async () => {
  const content = { content: [slot('hero'), slot('hero')] }
  const find = vi.fn(async ({ draft }: { draft?: boolean }) => ({ docs: draft ? [
    { id: 1, title: 'Moved draft', _status: 'draft', slug: 'draft-path', puckData: content },
    { id: 2, title: 'Unpublished', _status: 'draft', slug: 'never-published', puckData: content },
  ] : [
    { id: 1, title: 'Live page', _status: 'published', slug: 'live-path', puckData: content },
    { id: 3, title: 'No string slug', _status: 'published', slug: 123, puckData: content },
  ], hasNextPage: false }))
  const payload = fakePayload({ overrides: { find }, config: { collections: [{ slug: 'pages', versions: { drafts: true } }] } })
  const placements = await scanBlockPlacements(fakeReq({ payload }), { slug: 'hero', blocksCollections: [], puckCollections: ['pages'] })
  const live = placements.filter(p => p.id === 1)
  expect(live).toHaveLength(4)
  expect(live.map(p => [p.published, p.slug])).toEqual([[true, 'live-path'], [true, 'live-path'], [false, 'live-path'], [false, 'live-path']])
  for (const placement of placements.filter(p => p.id !== 1)) expect(placement).not.toHaveProperty('slug')
})
test('custom Puck fields are scanned without reading puckData', async () => {
  const payload = fakePayload({ collections: { templates: [{ id: 'template', content: { content: [slot('hero')] }, puckData: { content: [slot('wrong')] } }] } })
  const placements = await scanBlockPlacements(fakeReq({ payload }), { slug: 'hero', blocksCollections: [], puckCollections: [{ slug: 'templates', field: 'content' }] })
  expect(placements).toHaveLength(1)
  expect(placements[0]).toMatchObject({ collection: 'templates', id: 'template', slots: { control: 1, variantA: 2 } })
})
test('pages both views with manager access; finds nested slug and object refs, preserves top-level counts', async () => {
  const find = vi.fn(async ({ page, draft }: { page?: number; draft?: boolean }) => ({
    docs: page === 2 ? [{ id: 102, title: 'Nested', _status: draft ? 'draft' : 'published', puckData: { zones: { aside: [{ type: 'Wrapper', props: { content: [slot({ slug: 'hero' }, [{ props: { nested: [{}] } }])] } }] } } }]
      : Array.from({ length: 100 }, (_, n) => ({ id: n, title: 'Home', _status: draft ? 'draft' : 'published', puckData: { content: [slot('hero'), slot('other')] } })),
    hasNextPage: page === 1,
  }))
  const payload = fakePayload({ overrides: { find }, config: { collections: [{ slug: 'pages', versions: { drafts: true } }] } })
  const req = fakeReq({ payload })
  const result = await scanBlockPlacements(req, { slug: 'hero', blocksCollections: [], puckCollections: ['pages'] })
  expect(result).toHaveLength(202)
  expect(result[100]).toMatchObject({ collection: 'pages', id: 102, title: 'Nested', published: true, slots: { control: 1, variantA: 2, variantB: 0, variantC: 0 } })
  expect(result[201]!.published).toBe(false)
  expect(find.mock.calls.map(([args]) => [args.page, args.draft])).toEqual([[1, false], [2, false], [1, true], [2, true]])
  for (const [args] of find.mock.calls) expect(args).toMatchObject({ req, overrideAccess: false, limit: 100, collection: 'pages' })
  expect(find.mock.calls[0]![0]).toMatchObject({ where: { _status: { equals: 'published' } } })
})
test('one empty occurrence is refused even if another in the document has content', async () => {
  const payload = fakePayload({ collections: { pages: [{ id: 1, puckData: { content: [slot('hero'), slot({ slug: 'hero' }, [], [])] } }] } })
  const input = { experiment: { id: 1, slug: 'hero', status: 'draft', kind: 'block', unitType: 'visitor', allocation: 50, exposurePolicy: 'render', arms: defaultArms('block') }, metrics: [], placements: [] } as import('../../src/transitions/checkStart.js').CheckStartInput
  input.placements = await scanBlockPlacements(fakeReq({ payload }), { slug: 'hero', blocksCollections: [], puckCollections: ['pages'] })
  expect(input.placements).toHaveLength(2)
  expect(checkStart(input).find(check => check.code === 'empty-slot')?.ok).toBe(false)
})
test('ignores unrelated and missing data, skips published documents repeated by latest-draft reads', async () => {
  const payload = fakePayload({ collections: { pages: [{ id: 1, puckData: { content: [slot(null), slot('other')] } }, { id: 2 }, { id: 3, puckData: { content: [slot('hero')] } }] } })
  expect(await scanBlockPlacements(fakeReq({ payload }), { slug: 'hero', blocksCollections: [], puckCollections: ['pages'] })).toHaveLength(1)
})
test('flag placements pass the request and non-holdout arm keys, with an empty fallback', async () => {
  const options = sampleOptions(), req = fakeReq(), experiment = { id: 2, flagPoint: 'cta', arms: defaultArms('flag') }
  experiment.arms.push({ key: 'holdout', kind: 'holdout', label: 'Holdout', weight: 0 })
  const hook = vi.fn(async () => [{ arm: 'control', ok: false, detail: 'Missing' }])
  options.flagPoints![0]!.placements = hook
  expect(await flagPlacements(options, experiment, req)).toEqual([{ arm: 'control', ok: false, detail: 'Missing' }])
  expect(hook).toHaveBeenCalledWith({ experimentId: 2, arms: ['control', 'variantA'], req })
  delete options.flagPoints![0]!.placements
  expect(await flagPlacements(options, experiment, req)).toEqual([])
})

test.each([true, false])('Puck scan uses the published editor when the draft disagrees (published blocks=%s)', async publishedBlocks => {
  const find = vi.fn(async ({ draft }: { draft?: boolean }) => ({ docs: [{ id: 1, _status: draft ? 'draft' : 'published',
    legacy: draft ? !publishedBlocks : publishedBlocks, puckData: { content: [slot('hero')] } }], hasNextPage: false }))
  const payload = fakePayload({ overrides: { find }, config: { collections: [{ slug: 'pages', versions: { drafts: true } }] } })
  const result = await scanBlockPlacements(fakeReq({ payload }), { slug: 'hero', puckCollections: ['pages'],
    blocksCollections: [{ slug: 'pages', field: 'layout', appliesTo: doc => doc.legacy === true }] })
  expect(result).toHaveLength(publishedBlocks ? 0 : 2)
})
