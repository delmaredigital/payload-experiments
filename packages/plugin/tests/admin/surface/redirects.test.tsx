import type { DocumentViewServerProps, ListViewServerProps } from 'payload'
import { expect, test, vi } from 'vitest'
import { CollectionListRedirect } from '../../../src/admin/views/CollectionListRedirect.js'
import { CollectionEditRedirect } from '../../../src/admin/views/CollectionEditRedirect.js'
import { fakeReq } from '../../_fakes/req.js'
import { fakePayload } from '../../_fakes/payload.js'
import { fakeInitPageResult } from '../_helpers/fakeInitPageResult.js'

const { redirect } = vi.hoisted(() => ({ redirect: vi.fn((url: string): never => { throw new Error(url) }) }))
vi.mock('next/navigation', () => ({ redirect }))

test.each(['/control', '/'])('list redirects using only list-view props with admin at %s', adminRoute => {
  const props = { payload: fakePayload({ config: { routes: { admin: adminRoute } } }) } satisfies Pick<ListViewServerProps, 'payload'>
  const expected = adminRoute === '/' ? '/experiments' : '/control/experiments'
  expect(() => CollectionListRedirect(props)).toThrow(expected)
  expect(redirect).toHaveBeenLastCalledWith(expected)
})

test.each(['/control', '/'])('document-view props redirect edit/create/results with admin at %s', async adminRoute => {
  const payload = fakePayload({ config: { routes: { admin: adminRoute } } })
  for (const [tail, expected] of [
    [['create'], '/new'], [['123'], '/123'], [['123', 'results'], '/123/results'], [['x/y', 'results'], '/x%2Fy/results'],
  ] as const) {
    const segments = ['collections', 'xp-experiments', ...tail]
    const props = {
      initPageResult: fakeInitPageResult({ req: fakeReq({ payload }), docID: tail[0] === 'create' ? undefined : tail[0] }),
      routeSegments: segments, params: { segments },
    } satisfies Pick<DocumentViewServerProps, 'initPageResult' | 'params' | 'routeSegments'>
    const target = `${adminRoute === '/' ? '' : adminRoute}/experiments${expected}`
    await expect(CollectionEditRedirect(props)).rejects.toThrow(target)
    expect(redirect).toHaveBeenLastCalledWith(target)
  }
})
