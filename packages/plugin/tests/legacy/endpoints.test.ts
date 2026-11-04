import { expect, test, vi } from 'vitest'
import { buildEndpoints } from '../../src/endpoints/index.js'
import { handlePlacementStatus } from '../../src/endpoints/placementStatus.js'
import { defaultArms } from '../../src/collections/experiments/armInvariants.js'
import { resolvePageCollection } from '../../src/transitions/pageCollection.js'
import { unpublishedPageTargets } from '../../src/transitions/preflightData.js'
import { sampleOptions } from '../collections/fixtures.js'
import { fakePayload } from '../_fakes/payload.js'
import { fakeReq } from '../_fakes/req.js'

const page = { slug: 'pages', pathOf: (doc: Record<string, unknown>) => String(doc.path), findByPath: vi.fn(async (path: string) => ({ id: path === '/' ? 1 : 2, published: true })) }
const arms = defaultArms('page').map((arm, index) => ({ ...arm, pageTarget: index ? '/version' : '/' }))
test.each(['draft', 'stopped', 'running', 'decided', 'archived'] as const)('doc status includes %s tests with role, Original and winner addresses', async status => {
  const options = { ...sampleOptions(), pages: { collections: [page] } }
  const payload = fakePayload({ config: { collections: [{ slug: 'pages', admin: { useAsTitle: 'title' } }] }, collections: {
    pages: [{ id: 1, title: 'Home', path: '/' }, { id: 2, title: 'Version', path: '/version/' }],
    'xp-experiments': [{ id: 10, name: 'Home test', slug: 'home-test', pageCollection: 'pages', kind: 'page', status, arms, decision: { winnerArm: 'variantA' } }],
    'xp-phases': [{ id: 1, experiment: 10, phaseKind: 'test', arms }],
  } })
  Object.assign(payload.db, { findOne: vi.fn(async () => ({ id: 2, title: 'Version', path: '/version/' })) })
  const req = fakeReq({ payload, body: JSON.stringify({ docs: [{ collection: 'pages', id: 2 }] }) })
  const response = await handlePlacementStatus(req, { options })
  expect((await response.json()).docs['pages:2']).toEqual({ path: '/version/', tests: [{
    slug: 'home-test', name: 'Home test', status, role: 'version', winner: status === 'decided' || status === 'archived', armLabel: 'Variant A',
    winnerLabel: 'Variant A', winnerTitle: 'Version', winnerPath: '/version', originalPath: '/', rollout: false, pagesReleased: false,
  }] })
  expect(payload.calls.every(call => call.args.req === req && call.args.overrideAccess === false)).toBe(true)
})
test('status refuses limits and unknown collections before any reads', async () => {
  const payload = fakePayload(), options = sampleOptions()
  for (const [body, code, status] of [
    [{ docs: Array.from({ length: 101 }, () => ({ collection: 'pages', id: 1 })) }, 'too-many-ids', 422],
    [{ slugs: Array(101).fill('a') }, 'too-many-ids', 422],
    [{ docs: [{ collection: 'unknown', id: 1 }] }, 'unknown-collection', 422],
    [{ slugs: ['a'.repeat(17_000)] }, 'body-too-large', 413],
    [{ docs: [{ collection: 'pages', id: {} }] }, 'invalid-body', 422],
  ] as const) {
    const response = await handlePlacementStatus(fakeReq({ payload, body: JSON.stringify(body) }), { options })
    expect(response.status).toBe(status)
    expect(await response.json()).toMatchObject({ errors: [{ code }] })
  }
  expect(payload.calls).toEqual([])
})
test('pages refuses an unregistered collection with the public code', async () => {
  const route = buildEndpoints({ options: sampleOptions() }).find(route => route.path === '/xp/pages')!
  const response = await route.handler(fakeReq({ user: { id: 1 }, url: 'https://host/api/xp/pages?collection=unknown' }))
  expect(response.status).toBe(422)
  expect(await response.json()).toMatchObject({ errors: [{ code: 'unknown-collection', message: "That page type isn't set up for tests." }] })
})
test('legacy fallback resolves one collection from the Original, never each version independently', async () => {
  const first = { ...page, slug: 'first', findByPath: vi.fn(async (path: string) => path === '/' ? { id: 1, published: true } : null) }
  const second = { ...page, slug: 'second', findByPath: vi.fn(async () => ({ id: 2, published: true })) }
  const options = { ...sampleOptions(), pages: { collections: [first, second] } }
  const req = fakeReq()
  expect(await resolvePageCollection(req, options, { arms })).toBe(first)
  expect(await unpublishedPageTargets(req, options, { id: 1, arms })).toEqual(['/version'])
  expect(second.findByPath).not.toHaveBeenCalled()
})

test('archived-from-stopped has no page status or winner lookup', async () => {
  const lookup = vi.fn(async () => ({ id: 1, published: true }))
  const options = { ...sampleOptions(), pages: { collections: [{ ...page, findByPath: lookup }] } }
  const payload = fakePayload({ config: { collections: [] }, collections: {
    pages: [{ id: 1, path: '/' }],
    'xp-experiments': [{ id: 10, slug: 'stopped', name: 'Stopped', kind: 'page', status: 'archived', arms }],
    'xp-phases': [{ id: 1, experiment: 10, phaseKind: 'test', arms }],
  } })
  Object.assign(payload.db, { findOne: vi.fn(async () => ({ id: 1, path: '/' })) })
  const req = fakeReq({ payload, body: JSON.stringify({ docs: [{ collection: 'pages', id: 1 }] }) })
  expect(await (await handlePlacementStatus(req, { options })).json()).toEqual({ docs: { 'pages:1': { path: '/', tests: [] } }, slugs: {} })
  expect(lookup).not.toHaveBeenCalled()
  expect(payload.calls[0]!.args.where).toEqual({ kind: { equals: 'page' } })
})

test('running status uses the current test round labels for documents and slugs', async () => {
  const options = { ...sampleOptions(), pages: { collections: [page] } }
  const frozen = arms.map(arm => ({ ...arm, label: `Round ${arm.label}` }))
  const payload = fakePayload({ overrides: { findGlobal: vi.fn(async () => ({ retiredSlugs: [] })) }, collections: {
    pages: [{ id: 2, path: '/version' }],
    'xp-experiments': [{ id: 10, name: 'Running', slug: 'running', pageCollection: 'pages', kind: 'page', status: 'running', arms }],
    'xp-phases': [{ id: 1, experiment: 10, phase: 1, phaseKind: 'test', arms: frozen }],
  } })
  Object.assign(payload.db, { findOne: vi.fn(async () => ({ id: 2, path: '/version' })) })
  const req = fakeReq({ payload, body: JSON.stringify({ docs: [{ collection: 'pages', id: 2 }], slugs: ['running'] }) })
  const response = await handlePlacementStatus(req, { options })
  expect(response.status).toBe(200)
  const result = await response.json()
  expect(result.slugs.running).toMatchObject({ status: 'running', arms: frozen.map(({ key, label }) => ({ key, label })), rollout: false })
  expect(result.docs['pages:2'].tests).toEqual([expect.objectContaining({ armLabel: 'Round Variant A', status: 'running', rollout: false })])
})

test.each(['control', 'variantA'])('status freezes labels and rollout while %s wins, caching the winner per request', async winnerArm => {
  const lookup = vi.fn(async (path: string) => ({ id: path === '/' ? 1 : 2, published: true }))
  const options = { ...sampleOptions(), pages: { collections: [{ ...page, findByPath: lookup }] } }
  const frozen = arms.map(arm => ({ ...arm, label: `Frozen ${arm.label}` }))
  const payload = fakePayload({ config: { collections: [{ slug: 'pages', admin: { useAsTitle: 'title' } }] }, overrides: { findGlobal: vi.fn(async () => ({ retiredSlugs: [] })) }, collections: {
    pages: [{ id: 1, title: 'Home', path: '/' }, { id: 2, title: 'Version', path: '/version' }],
    'xp-experiments': [{ id: 10, name: 'Rollout', slug: 'rollout', pageCollection: 'pages', kind: 'page', status: 'decided', arms, decision: { winnerArm } }],
    'xp-phases': [{ id: 2, experiment: 10, phase: 2, phaseKind: 'rollout', arms }, { id: 1, experiment: 10, phase: 1, phaseKind: 'test', arms: frozen }],
  } })
  Object.assign(payload.db, { findOne: vi.fn(async ({ where }) => payload.documents.pages!.find(doc => doc.id === where.id.equals)) })
  for (const released of [false, true]) {
    lookup.mockClear()
    payload.documents['xp-experiments']![0]!.decision = { winnerArm, ...(released ? { holdoutReleasedAt: 'now' } : {}) }
    const req = fakeReq({ payload, body: JSON.stringify({ docs: [{ collection: 'pages', id: 1 }, { collection: 'pages', id: 2 }], slugs: ['rollout'] }) })
    const result = await (await handlePlacementStatus(req, { options })).json()
    expect(result.slugs.rollout).toMatchObject({ arms: frozen.map(({ key, label }) => ({ key, label })), winnerArm, rollout: !released })
    expect(result.docs['pages:1'].tests[0]).toMatchObject({ armLabel: 'Frozen Original', winner: winnerArm === 'control', rollout: !released })
    expect(result.docs['pages:2'].tests[0]).toMatchObject({ armLabel: 'Frozen Variant A', winner: winnerArm === 'variantA', rollout: !released })
    expect(lookup).toHaveBeenCalledTimes(1)
    expect(payload.calls.filter(call => call.method === 'findByID' && call.args.req === req && call.args.disableErrors === true)).toHaveLength(1)
  }
})

test('winner title failures omit the title without failing document status', async () => {
  const options = { ...sampleOptions(), pages: { collections: [page] } }
  const payload = fakePayload({ config: { collections: [] }, collections: {
    pages: [{ id: 1, path: '/' }],
    'xp-experiments': [{ id: 10, name: 'Decided', slug: 'test', pageCollection: 'pages', kind: 'page', status: 'decided', arms, decision: { winnerArm: 'variantA' } }],
  } })
  Object.assign(payload.db, { findOne: vi.fn(async () => ({ id: 1, path: '/' })) })
  const read = payload.findByID.bind(payload)
  vi.spyOn(payload, 'findByID').mockImplementation(async args => {
    if (args.disableErrors) throw new Error('unreadable winner')
    return read(args)
  })
  const req = fakeReq({ payload, body: JSON.stringify({ docs: [{ collection: 'pages', id: 1 }] }) })
  const result = await (await handlePlacementStatus(req, { options })).json()
  expect(result.docs['pages:1'].tests).toHaveLength(1)
  expect(result.docs['pages:1'].tests[0]).not.toHaveProperty('winnerTitle')
})

test('a sole page registration resolves legacy tests even when their Original is missing', async () => {
  const missing = { ...page, findByPath: vi.fn(async () => null) }
  const options = { ...sampleOptions(), pages: { collections: [missing] } }
  expect(await resolvePageCollection(fakeReq(), options, { arms })).toBe(missing)
  expect(missing.findByPath).not.toHaveBeenCalled()
})
test('page picker avoids numeric-id title searches and bounds query and page', async () => {
  const { handlePages } = await import('../../src/endpoints/pages.js')
  const options = { ...sampleOptions(), pages: { collections: [page] } }
  const payload = fakePayload({ config: { collections: [{ slug: 'pages', admin: { useAsTitle: 'id' } }] } })
  const req = fakeReq({ payload, url: 'https://host/api/xp/pages?collection=pages&q=anything&page=1000' })
  expect((await handlePages(req, { options })).status).toBe(200)
  expect(payload.calls[0]!.args).toMatchObject({ page: 1000, where: undefined })
  payload.config.collections[0]!.admin.useAsTitle = 'title'
  const find = vi.spyOn(payload, 'find')
  await handlePages(fakeReq({ payload, url: `https://host/api/xp/pages?collection=pages&q=${'x'.repeat(101)}` }), { options })
  expect(find).toHaveBeenLastCalledWith(expect.objectContaining({ where: { title: { like: 'x'.repeat(100) } } }))
  await expect(handlePages(fakeReq({ payload, url: 'https://host/api/xp/pages?collection=pages&page=1001' }), { options })).rejects.toMatchObject({ code: 'invalid-body', status: 422 })
})
