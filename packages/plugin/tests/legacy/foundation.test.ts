import { expect, test, vi } from 'vitest'
import type { CollectionAfterChangeHook, Config } from 'payload'
import { sampleOptions, field, validate } from '../collections/fixtures.js'
import { resolveOptions, documentEditor } from '../../src/options.js'
import { createExperimentsPlugin } from '../../src/plugin.js'
import { contentChangesBeforeHook, contentChangesHook } from '../../src/hooks/contentChanges.js'
import { pageGuardAfterChange, pageGuardBeforeChange, pageGuardBeforeDelete } from '../../src/hooks/pageGuard.js'
import { serializePageCollections } from '../../src/admin/pageCollections.js'
import { collectionLabel } from '../../src/collections/labels.js'
import { sortLockKeys, lockPagePaths } from '../../src/db/locks.js'
import { checkStart, type StartExperiment } from '../../src/transitions/checkStart.js'
import { sanitizeReadinessDetail } from '../../src/sanitizeReadinessDetail.js'
import { createFakeExecutor } from '../_fakes/executor.js'
import { fakePayload } from '../_fakes/payload.js'
import { fakeReq } from '../_fakes/req.js'
import { pageStatusCopy } from '../../src/admin/placementStatus.model.js'
import type { PageTestStatus } from '../../src/types/endpoints.js'

const page = () => ({ slug: 'pages', pathOf: (doc: Record<string, unknown>) => typeof doc.path === 'string' ? doc.path : null, findByPath: vi.fn(async () => ({ id: 1, published: true })) })
test('page options accept callbacks and guidance, refuse malformed additions', () => {
  for (const invalid of [{ contentOf: 1 }, { copyHint: '' }, { copyHint: 'x'.repeat(201) }, { copyLabel: 'x' }, { copyUrl: '//host' }, { copyUrl: '/\\host' }, { copyUrl: '/\t/host' }, { copyUrl: 'https://host' }, { copyUrl: '/ok', copyLabel: 'x'.repeat(41) }]) {
    expect(() => resolveOptions({ ...sampleOptions(), pages: { collections: [{ ...page(), ...invalid } as never] } })).toThrow()
  }
  const registration = { ...page(), contentOf: (doc: Record<string, unknown>) => doc.layout, copyHint: 'Copy in Pages', copyUrl: '/staff/pages?copy=yes', copyLabel: 'Open Pages' }
  expect(resolveOptions({ ...sampleOptions(), pages: { collections: [registration] } }).pages?.collections).toEqual([registration])
})
test('blocks validates the whole registration and requires appliesTo for double registration', () => {
  const options = { ...sampleOptions(), puck: { enabled: true, collections: ['pages'] } }
  for (const invalid of [{ slug: '', field: 'layout' }, { slug: 'pages', field: '' }, { slug: 'pages', field: 'layout', appliesTo: 1 }, { slug: 'pages', field: 'layout', blockSlug: '' }, { slug: 'pages', field: 'layout' }]) {
    expect(() => resolveOptions({ ...options, blocks: { collections: [invalid as never] } })).toThrow()
  }
  const blocks = { collections: [{ slug: 'pages', field: 'layout', appliesTo: (doc: Record<string, unknown>) => doc.editor !== 'puck' }] }
  const resolved = resolveOptions({ ...options, blocks })
  expect(documentEditor(resolved, 'pages', { editor: 'puck' })).toBe('puck')
  expect(documentEditor(resolved, 'pages', { editor: 'legacy' })).toBe('blocks')
})
test('triple registration composes one guarded audit pair and a column-free sidebar field', async () => {
  const config = await createExperimentsPlugin({ ...sampleOptions(), pages: { collections: [page()] }, puck: { enabled: true, collections: ['pages'] }, blocks: { collections: [{ slug: 'pages', field: 'layout', appliesTo: () => false }] } })({ collections: [{ slug: 'pages', fields: [] }] } as unknown as Config)
  const collection = config.collections![0]!
  expect(collection.hooks?.beforeChange).toEqual([pageGuardBeforeChange, contentChangesBeforeHook])
  expect(collection.hooks?.afterChange).toEqual([pageGuardAfterChange, contentChangesHook])
  expect(collection.hooks?.beforeDelete).toEqual([pageGuardBeforeDelete])
  expect(collection.fields[0]).toMatchObject({ name: 'xpPlacementStatus', type: 'ui', admin: { position: 'sidebar' } })
  const experiment = config.collections!.find(entry => entry.slug === 'xp-experiments')!
  const choice = field(experiment.fields, 'pageCollection', 'text')
  expect(validate(choice.validate, 'pages')).toBe(true)
  expect(validate(choice.validate, null)).toBe(true)
  expect(validate(choice.validate, 'other')).toBeTypeOf('string')
})
test('one locale-independent comparator orders and deduplicates every lock set', async () => {
  const query = vi.fn(async () => ({ rows: [], rowCount: 0 }))
  expect(sortLockKeys(['z', 'a', 'z'])).toEqual(['a', 'z'])
  await lockPagePaths({ query }, ['/z', '/a', '/z'])
  expect(query.mock.calls.map(call => (call as unknown[])[1])).toEqual([['/a'], ['/z']])
})
test('function labels use request translations and safely fall back', () => {
  const req = fakeReq(); Object.assign(req, { i18n: { language: 'fr', t: vi.fn() } })
  const label = vi.fn(({ t }) => t === req.i18n.t ? 'Pages traduites' : null)
  expect(collectionLabel(label, 'pages', req)).toBe('Pages traduites')
  expect(label).toHaveBeenCalledWith({ i18n: req.i18n, t: req.i18n.t })
  expect(collectionLabel(() => { throw new Error() }, 'pages', req)).toBe('pages')
  expect(collectionLabel(() => 1, 'pages', req)).toBe('pages')
  expect(collectionLabel(() => ({ en: 'Wrong' }), 'pages', req)).toBe('pages')
  expect(collectionLabel({ en: 'Pages', fr: 'Les pages' }, 'pages', req)).toBe('Les pages')
})
test('same-address check normalises both paths and ignores holdouts; identical warnings carry identifiers only', () => {
  const experiment = { id: 1, kind: 'page', arms: [{ key: 'control', kind: 'control', pageTarget: '/one/' }, { key: 'variantA', kind: 'variant', pageTarget: '/one' }, { key: 'holdout', kind: 'holdout', pageTarget: '/one' }] } as StartExperiment
  const checks = checkStart({ experiment, metrics: [], identicalVersions: [{ arm: 'variantA', path: '/one', collection: 'pages', id: 2 }] })
  expect(checks.find(check => check.code === 'version-same-address')).toMatchObject({ ok: false, detail: { arm: 'variantA', otherArm: 'control', path: '/one' } })
  expect(checks.find(check => check.code === 'version-identical')).toMatchObject({ ok: true, warning: true })
  expect(sanitizeReadinessDetail('version-identical', { arm: 'variantA', path: '/one', collection: 'pages', id: 2, title: 'Secret' })).toEqual({ arm: 'variantA', path: '/one', collection: 'pages', id: 2 })
  expect(sanitizeReadinessDetail('version-same-address', { arm: 'variantA', otherArm: 'control', path: 'https://host' })).toBeUndefined()
})
test('page audit compares stored rows, unions bindings once and sorts experiment ids', async () => {
  const executor = createFakeExecutor()
  const query = executor.query.bind(executor)
  vi.spyOn(executor, 'query').mockImplementation(async <R>(text: string, params?: unknown[]) => {
    const result = await query<R>(text, params)
    if (text.includes('current_setting')) return { rows: [{ timeout: '0' }] as R[], rowCount: 1 }
    if (text.includes('JOIN') && text.includes('xp_phases')) return { rows: [{ id: 'z', arms: [{ pageTarget: '/old/' }] }, { id: 'a', arms: [{ pageTarget: '/new/' }] }] as R[], rowCount: 2 }
    if (text.startsWith('SELECT') && text.includes('FROM')) return { rows: [{ id: params?.[0], phase: 2 }] as R[], rowCount: 1 }
    if (text.startsWith('UPDATE')) return { rows: [] as R[], rowCount: 1 }
    return result
  })
  const registration = { ...page(), contentOf: (doc: Record<string, unknown>) => doc.layout }
  const payload = fakePayload({ executor, config: { custom: { xp: { ...sampleOptions(), pages: { collections: [registration] } } } } })
  const req = executor.withSession({ payload })
  const before = { id: 9, path: '/old', layout: [{ text: 'Before' }], _status: 'published' }
  const after = { ...before, path: '/new', layout: [{ text: 'After' }] }
  Object.assign(payload.db, { findOne: vi.fn().mockResolvedValueOnce(before).mockResolvedValue(after) })
  const collection = { slug: 'pages', fields: [], versions: { drafts: {} } }
  await contentChangesBeforeHook({ req, collection, originalDoc: before, data: after, operation: 'update' } as never)
  await contentChangesHook({ req, collection, previousDoc: { ...before, path: '/draft-only' }, doc: { ...after, path: '/after-read-wrong' } } as unknown as Parameters<CollectionAfterChangeHook>[0])
  expect(executor.calls.filter(call => call.text.includes('pg_advisory_xact_lock')).map(call => call.params)).toEqual([['a'], ['z']])
  expect(executor.calls.filter(call => call.text.startsWith('UPDATE'))).toHaveLength(2)
  expect(registration.findByPath).not.toHaveBeenCalled()
})
test.each(['draft', 'running', 'stopped', 'decided', 'archived'] as const)('page status has authored %s copy', status => {
  const test: PageTestStatus = { slug: 'test', name: 'Test', status, role: 'version', winner: false, armLabel: 'Variant A', winnerLabel: 'Original', winnerTitle: 'Home', originalPath: '/', rollout: false, pagesReleased: false }
  expect(pageStatusCopy(test)).toBeTypeOf('string')
  if (status === 'stopped') expect(pageStatusCopy(test)).toContain('the homepage (/)')
  if (status === 'archived') expect(pageStatusCopy({ ...test, winner: true })).toContain("other versions' addresses")
  expect(pageStatusCopy({ ...test, pagesReleased: true })).toBeNull()
})

test('serialized page copying links honour a non-default admin route and keep custom URLs verbatim', () => {
  const req = fakeReq({ payload: fakePayload({ config: { routes: { admin: '/staff' }, collections: [{ slug: 'pages', labels: { plural: 'Pages' } }] } }) })
  expect(serializePageCollections([page()], req)).toEqual([{ slug: 'pages', label: 'Pages', copyUrl: '/staff/collections/pages', copyLabel: 'Open Pages' }])
  expect(serializePageCollections([{ ...page(), copyUrl: '/tree?copy=1', copyLabel: 'Open Tree', copyHint: 'Use Duplicate' }], req)).toEqual([{ slug: 'pages', label: 'Pages', copyUrl: '/tree?copy=1', copyLabel: 'Open Tree', copyHint: 'Use Duplicate' }])
})

const statusBase: PageTestStatus = { slug: 'test', name: 'Test', status: 'draft', role: 'version', winner: false,
  armLabel: 'Variant A', winnerLabel: 'Original', winnerTitle: 'Home', originalPath: '/original', rollout: false, pagesReleased: false }
test.each([
  [{}, 'This page is Variant A in the draft test Test.'],
  [{ status: 'stopped' }, 'This page is Variant A in the stopped test Test. Visitors to /original see the Original.'],
  [{ status: 'stopped', role: 'original', armLabel: 'Original' }, 'This page is Original in the stopped test Test. Visitors see this page.'],
  [{ status: 'stopped', originalPath: '/' }, 'This page is Variant A in the stopped test Test. Visitors to the homepage (/) see the Original.'],
  [{ status: 'stopped', originalPath: undefined }, 'This page is Variant A in the stopped test Test. Visitors see the Original.'],
  [{ status: 'running' }, 'This page is the Variant A of a running test: Test.'],
  [{ status: 'decided' }, 'This page is Variant A of a decided test; visitors see Original (Home).'],
  [{ status: 'decided', rollout: true }, 'This page is Variant A of a decided test; most visitors see Original (Home); a holdout still sees the Original.'],
  [{ status: 'archived' }, "This page's address now shows Original (Home). To show this page again, open the test and choose \"Release pages\"."],
  [{ status: 'archived', winner: true }, "This page is also shown at the other versions' addresses because test Test made it the winner. To free it, open the test and choose \"Release pages\"."],
  [{ status: 'archived', role: 'original', armLabel: 'Original', winnerLabel: 'Variant A', winnerTitle: 'Version' }, "This page's address now shows the winner of test Test. To free it, open the test and choose \"Release pages\"."],
] as Array<[Partial<PageTestStatus>, string]>)('status copy is exact for %j', (changes, expected) => {
  expect(pageStatusCopy({ ...statusBase, ...changes })).toBe(expected)
})
test('page collection validation accepts an unchanged unregistered value but refuses a changed one', async () => {
  const config = await createExperimentsPlugin(sampleOptions())({ collections: [] } as unknown as Config)
  const choice = field(config.collections!.find(c => c.slug === 'xp-experiments')!.fields, 'pageCollection', 'text')
  expect(validate(choice.validate, 'retired', { previousValue: 'retired' })).toBe(true)
  expect(validate(choice.validate, 'retired', { previousValue: 'other' })).toBe('Choose a registered page collection.')
})

test.each([true, false])('content audit respects appliesTo=%s for a document with stale Puck slots', async appliesTo => {
  const executor = createFakeExecutor()
  const query = executor.query.bind(executor)
  vi.spyOn(executor, 'query').mockImplementation(async <R>(text: string, params?: unknown[]) => {
    const result = await query<R>(text, params)
    if (text.includes('current_setting')) return { rows: [{ timeout: '0' }] as R[], rowCount: 1 }
    if (text.startsWith('SELECT') && text.includes('xp_experiments')) return { rows: [{ id: 10, phase: 1 }] as R[], rowCount: 1 }
    if (text.startsWith('UPDATE')) return { rows: [] as R[], rowCount: 1 }
    return result
  })
  const options = { ...sampleOptions(), puck: { enabled: true, collections: ['pages'] },
    blocks: { collections: [{ slug: 'pages', field: 'layout', appliesTo: () => appliesTo }] } }
  const payload = fakePayload({ executor, config: { custom: { xp: options } } })
  const req = executor.withSession({ payload })
  const slot = (text: string) => ({ content: [{ type: 'ExperimentSlot', props: { experiment: 'hero', control: [{ text }], variantA: [] } }] })
  const previous = { id: 1, puckData: slot('Before') }, current = { id: 1, puckData: slot('After') }
  await contentChangesHook({ req, collection: { slug: 'pages', fields: [] }, previousDoc: previous, doc: current } as never)
  expect(executor.calls.some(call => call.text.includes('current_setting'))).toBe(true)
  expect(executor.calls.some(call => call.text.startsWith('ROLLBACK'))).toBe(false)
  expect(executor.calls.filter(call => call.text.includes('xp_experiments'))).toHaveLength(appliesTo ? 0 : 2)
  const appends = executor.calls.filter(call => call.text.startsWith('UPDATE'))
  expect(appends).toHaveLength(appliesTo ? 0 : 1)
  if (!appliesTo) {
    expect(appends[0]!.text).toContain('content_changes')
    expect(appends[0]!.params.slice(1)).toEqual([10, 1])
    expect(JSON.parse(appends[0]!.params[0] as string)).toEqual([expect.objectContaining({ doc: { collection: 'pages', id: 1 } })])
  }
})
