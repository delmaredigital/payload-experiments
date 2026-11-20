import { expect, test } from 'vitest'
import type { Field } from 'payload'
import { placementReader, placementLocaleContent, mergedPlacementLocales } from '../../src/blocks/placementLocale.js'
import { fakeReq } from '../_fakes/req.js'
import { fakePayload } from '../_fakes/payload.js'

const opaqueTypes = ['json', 'richText', 'relationship', 'upload', 'point', 'text', 'date', 'number'] as const
function request(fields: Field[], blocks: unknown[] = []) {
  return Object.assign(fakeReq({ payload: fakePayload({ config: {
    localization: { defaultLocale: 'en', localeCodes: ['en', 'fr'], locales: [{ code: 'en' }, { code: 'fr' }], fallback: true },
    collections: [{ slug: 'pages', fields }], blocks,
  } }) }), { locale: 'fr', fallbackLocale: false as const })
}
test.each(opaqueTypes)('%s values stay opaque in either direction of localized nesting', type => {
  const value = { en: 'opaque', nested: { fr: ['untouched'] } }
  const fields = [{ name: 'outer', type: 'group', fields: [{ name: 'value', type, localized: true }] },
    { name: 'translated', type: 'group', localized: true, fields: [{ name: 'value', type }] }] as Field[]
  const req = request(fields)
  const raw = { outer: { value: { fr: value } }, translated: { fr: { value } } }
  expect(placementLocaleContent(req, 'pages', raw, 'all-locales')).toEqual({ outer: { value }, translated: { value } })
  const localized = { outer: { value }, translated: { value } }
  expect(placementLocaleContent(req, 'pages', localized, 'localized')).toBe(localized)
  const merged = mergedPlacementLocales(req, 'pages', raw, localized)
  expect(placementLocaleContent(req, 'pages', merged, 'all-locales')).toEqual(localized)
})
test.each(['group', 'array', 'blocks', 'tabs', 'row', 'collapsible'] as const)('schema traverses %s, including block references and named/unnamed tabs', type => {
  const child = { name: 'title', type: 'text', localized: true }
  const fields = type === 'tabs' ? [{ type, tabs: [{ label: 'Unnamed', fields: [child] }, { name: 'named', label: 'Named', fields: [child] }] }]
    : type === 'blocks' ? [{ name: 'container', type, blocks: [], blockReferences: ['shared'] }]
    : type === 'row' || type === 'collapsible' ? [{ type, label: 'Container', fields: [child] }]
    : [{ name: 'container', type, fields: [child] }]
  const req = request(fields as Field[], [{ slug: 'shared', fields: [child] }])
  const row = { title: { en: 'English', fr: 'French' } }
  const raw = type === 'tabs' ? { ...row, named: row } : type === 'row' || type === 'collapsible' ? row
    : { container: type === 'array' ? [row] : type === 'blocks' ? [{ blockType: 'shared', ...row }] : row }
  const expected = JSON.parse(JSON.stringify(raw).replaceAll('{"en":"English","fr":"French"}', '"French"'))
  expect(placementLocaleContent(req, 'pages', raw, 'all-locales')).toEqual(expected)
  expect(placementLocaleContent(req, 'pages', mergedPlacementLocales(req, 'pages', raw, expected), 'all-locales')).toEqual(expected)
})
test('unlocalized branches share their identity; localization off does no work', () => {
  const stable = { deep: ['unchanged'] }, raw = { stable, title: { fr: 'French' } }
  const req = request([{ name: 'stable', type: 'json' }, { name: 'title', type: 'text', localized: true }])
  expect(placementLocaleContent(req, 'pages', raw, 'all-locales')!.stable).toBe(stable)
  req.payload.config.localization = false
  expect(placementLocaleContent(req, 'pages', raw, 'all-locales')).toBe(raw)
})

test.each(['group', 'array', 'blocks', 'tabs'] as const)('localized %s parents do not project their already-local children twice', type => {
  const child = { name: 'title', type: 'text', localized: true }
  const fields = type === 'tabs' ? [{ type, tabs: [{ name: 'container', label: 'Named', localized: true, fields: [child] }] }]
    : type === 'blocks' ? [{ name: 'container', type, localized: true, blocks: [{ slug: 'shared', fields: [child] }] }]
    : [{ name: 'container', type, localized: true, fields: [child] }]
  const req = request(fields as Field[])
  const content = type === 'array' ? [{ title: 'French' }] : type === 'blocks' ? [{ blockType: 'shared', title: 'French' }] : { title: 'French' }
  const raw = { container: { en: null, fr: content } }
  expect(placementLocaleContent(req, 'pages', raw, 'all-locales')).toEqual({ container: content })
  expect(placementLocaleContent(req, 'pages', { container: content }, 'localized')).toEqual({ container: content })
})

test('recursive global block references compile once and project finite document trees', () => {
  const block = { slug: 'copy', fields: [{ name: 'title', type: 'text', localized: true }, { name: 'children', type: 'blocks', blocks: [], blockReferences: ['copy'] }] }
  const req = request([{ name: 'layout', type: 'blocks', blocks: [], blockReferences: ['copy'] }], [block])
  const child = { blockType: 'copy', title: { en: 'English', fr: 'French' }, children: [] }
  const raw = { layout: [{ ...child, children: [child] }] }
  expect(placementLocaleContent(req, 'pages', raw, 'all-locales')).toEqual({ layout: [{ ...child, title: 'French', children: [{ ...child, title: 'French' }] }] })
})


test('referenced block descendants determine placement languages and missing rows never call host predicates', () => {
  const req = request([{ name: 'layout', type: 'blocks', blocks: [], blockReferences: ['shared'] }], [{ slug: 'shared', fields: [{ name: 'value', type: 'json', localized: true }] }])
  req.payload.config.custom!.xp = { blocks: { collections: [{ slug: 'pages', field: 'layout' }] } }
  expect(placementReader(req, 'pages').views.map(view => view.locale)).toEqual(['en', 'fr'])
  const reader = placementReader(req, 'pages', { blocks: { collections: [{ slug: 'pages', field: 'layout', appliesTo: () => { throw new Error('No document') } }] } })
  expect(reader.read(undefined, 'all-locales').editor).toBe('page')
  expect(reader.read(undefined, 'all-locales').slugs).toEqual([])
})

test('single-view consumers normalize locale all to the configured default', () => {
  const req = request([{ name: 'title', type: 'text', localized: true }]); req.locale = 'all'
  expect(placementLocaleContent(req, 'pages', { title: { en: 'English', fr: 'French' } }, 'all-locales')).toEqual({ title: 'English' })
})


test('new nested rows with ids never inherit another row’s translations by position', () => {
  const req = request([{ name: 'layout', type: 'array', fields: [{ name: 'title', type: 'text', localized: true }] }])
  const before = { layout: [{ id: 'old', title: { en: 'Old English', fr: 'Old French' } }] }
  const after = { layout: [{ id: 'new', title: 'New French' }, { id: 'old', title: 'Updated French' }] }
  expect(mergedPlacementLocales(req, 'pages', before, after)).toEqual({ layout: [
    { id: 'new', title: { fr: 'New French' } }, { id: 'old', title: { en: 'Old English', fr: 'Updated French' } },
  ] })
  expect(mergedPlacementLocales(req, 'pages', before, { layout: [{ title: 'No id' }] })).toEqual({ layout: [{ title: { en: 'Old English', fr: 'No id' } }] })
})

test('locale all bulk changes keep already projected sibling views intact', async () => {
  const { bulkRemoves } = await import('../../src/db/bulkPlacementRemoval.js')
  const req = request([{ name: 'layout', type: 'json', localized: true }]); req.locale = 'all'
  req.payload.config.custom!.xp = { blocks: { collections: [{ slug: 'pages', field: 'layout' }] } }
  const block = { blockType: 'xpExperiment', experiment: 'hero' }
  const doc = { id: 1, layout: { en: [block], fr: [block] }, _status: 'published' }
  const bulk = { documents: new Set([JSON.stringify(['pages', '1'])]), refusals: new Map(), change: { collection: 'pages', data: { title: 'Changed' }, draft: false, deleting: false } }
  for (const view of placementReader(req, 'pages').views) expect(bulkRemoves(bulk, req, 'pages', doc, 'hero', view)).toBe(false)
})

test('compiled locale transforms are reused across readers and pending merges, but isolated per config', () => {
  let nameReads = 0
  const field = { type: 'json', localized: true, get name() { nameReads++; return 'layout' } } as Field
  const make = () => {
    const req = request([field])
    req.payload.config.custom!.xp = { blocks: { collections: [{ slug: 'pages', field: 'layout', appliesTo: () => true }] } }
    return req
  }
  const req = make(), raw = { layout: { en: [], fr: [] } }, after = { layout: [] }
  mergedPlacementLocales(req, 'pages', raw, after)
  const compiledReads = nameReads
  expect(compiledReads).toBeGreaterThan(0)
  mergedPlacementLocales(req, 'pages', raw, after)
  placementReader(req, 'pages').read(raw, 'all-locales').doc
  expect(nameReads).toBe(compiledReads)
  mergedPlacementLocales(make(), 'pages', raw, after)
  expect(nameReads).toBeGreaterThan(compiledReads)
})


test('a fresh block id at index zero does not borrow the previous block’s English field', () => {
  const req = request([{ name: 'layout', type: 'blocks', blocks: [{ slug: 'copy', fields: [{ name: 'title', type: 'text', localized: true }] }] }])
  const before = { layout: [{ id: 'old', blockType: 'copy', title: { en: 'Old English', fr: 'Old French' } }] }
  const after = { layout: [{ id: 'new', blockType: 'copy', title: 'New French' }, { id: 'old', blockType: 'copy', title: 'Updated French' }] }
  expect(mergedPlacementLocales(req, 'pages', before, after)).toEqual({ layout: [
    { id: 'new', blockType: 'copy', title: { fr: 'New French' } }, { id: 'old', blockType: 'copy', title: { en: 'Old English', fr: 'Updated French' } },
  ] })
})
