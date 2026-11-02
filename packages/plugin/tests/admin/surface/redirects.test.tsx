import type { InitPageResult } from 'payload'
import { expect, test, vi } from 'vitest'
import { CollectionListRedirect } from '../../../src/admin/views/CollectionListRedirect.js'
import { CollectionEditRedirect } from '../../../src/admin/views/CollectionEditRedirect.js'
import { fakeReq } from '../../_fakes/req.js'
import { fakePayload } from '../../_fakes/payload.js'

const { redirect } = vi.hoisted(() => ({ redirect: vi.fn((url: string): never => { throw new Error(url) }) }))
vi.mock('next/navigation', () => ({ redirect }))
const props = { initPageResult: { req: fakeReq({ payload: fakePayload({ config: { routes: { admin: '/control' } } }) }) } as InitPageResult }
test('list redirects to Tests home', () => {
  expect(() => CollectionListRedirect(props)).toThrow('/control/experiments')
  expect(redirect).toHaveBeenLastCalledWith('/control/experiments')
})
test.each([
  [['create'], '/new'], [['123'], '/123'], [['123', 'results'], '/123/results'],
] as const)('collection path %j redirects to %s from params', async (tail, expected) => {
  await expect(CollectionEditRedirect({ ...props, params: { segments: ['collections', 'xp-experiments', ...tail] } })).rejects.toThrow(`/control/experiments${expected}`)
  expect(redirect).toHaveBeenLastCalledWith(`/control/experiments${expected}`)
})
test.each([
  [['create'], '/new'], [['123'], '/123'], [['123', 'results'], '/123/results'],
] as const)('document routeSegments %j redirects to %s', async (tail, expected) => {
  await expect(CollectionEditRedirect({ ...props, routeSegments: ['collections', 'xp-experiments', ...tail] })).rejects.toThrow(`/control/experiments${expected}`)
})
test('no id means create, and the explicit view id is supported', async () => {
  await expect(CollectionEditRedirect(props)).rejects.toThrow('/control/experiments/new')
  await expect(CollectionEditRedirect({ ...props, docID: 42 })).rejects.toThrow('/control/experiments/42')
})
