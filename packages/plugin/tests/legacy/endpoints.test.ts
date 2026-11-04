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
