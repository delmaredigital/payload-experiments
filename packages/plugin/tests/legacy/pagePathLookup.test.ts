import { expect, test, vi } from 'vitest'
import { handlePages } from '../../src/endpoints/pages.js'
import { buildEndpoints } from '../../src/endpoints/index.js'
import { sampleOptions } from '../collections/fixtures.js'
import { fakePayload } from '../_fakes/payload.js'
import { fakeReq } from '../_fakes/req.js'

function fixture(draft = false) {
  const findByPath = vi.fn(async (_path: string, _req: unknown) => ({ id: 7, published: !draft }))
  const options = { ...sampleOptions(), pages: { collections: [{ slug: 'pages', pathOf: (doc: Record<string, unknown>) => String(doc.path), findByPath }] } }
  const payload = fakePayload({ config: { collections: [{ slug: 'pages', admin: { useAsTitle: 'title' }, ...(draft ? { versions: { drafts: true } } : {}) }] }, collections: { pages: [{ id: 7, title: 'Landing', path: 'odd path/?a=1', _status: draft ? 'draft' : 'published' }] } })
  const req = fakeReq({ payload, user: { id: 1 }, url: `https://host/api/xp/pages?collection=pages&path=${encodeURIComponent('odd path/?a=1')}` })
  return { options, payload, req, findByPath }
}
test('path lookup keeps the exact stored target and reads its title with manager access', async () => {
  const { options, payload, req, findByPath } = fixture()
  expect(await (await handlePages(req, { options })).json()).toEqual({ docs: [{ id: 7, title: 'Landing', path: 'odd path/?a=1', pathKey: 'odd path/?a=1', published: true }], hasNextPage: false })
  expect(findByPath).toHaveBeenCalledWith('odd path/?a=1', req)
  expect(payload.calls).toHaveLength(1)
  expect(payload.calls[0]).toMatchObject({ method: 'findByID', args: { req, overrideAccess: false, draft: false, depth: 0, id: 7 } })
})
test('missing target returns no rows and no Local API read', async () => {
  const f = fixture()
  f.findByPath.mockResolvedValueOnce(null as never)
  expect(await (await handlePages(f.req, { options: f.options })).json()).toEqual({ docs: [], hasNextPage: false })
  expect(f.payload.calls).toEqual([])
})
test('draft-only target takes title and path from the latest draft', async () => {
  const f = fixture(true)
  const read = vi.spyOn(f.payload, 'findByID')
  read.mockResolvedValueOnce({ id: 7, title: 'Create-time title', path: '/old', _status: 'draft' } as never)
  read.mockResolvedValueOnce({ id: 7, title: 'Latest draft title', path: '/new', _status: 'draft' } as never)
  expect(await (await handlePages(f.req, { options: f.options })).json()).toMatchObject({ docs: [{ id: 7, title: 'Latest draft title', path: '/new', published: false }], hasNextPage: false })
  expect(read).toHaveBeenNthCalledWith(2, expect.objectContaining({ req: f.req, overrideAccess: false, draft: true, depth: 0 }))
})
test.each(['path=', `path=${'a'.repeat(2049)}`, 'path=/a&q=', 'path=/a&q=hello'])('invalid path query is a 422 invalid-body (%s)', async query => {
  const f = fixture()
  const req = fakeReq({ payload: f.payload, url: `https://host/api/xp/pages?collection=pages&${query}` })
  await expect(handlePages(req, { options: f.options })).rejects.toMatchObject({ code: 'invalid-body', status: 422, message: 'Enter a valid request body.' })
  expect(f.findByPath).not.toHaveBeenCalled()
})
test('path route retains manage access and never invokes a lookup for a reader', async () => {
  const f = fixture()
  f.options.access.manage = vi.fn(async () => false)
  const endpoint = buildEndpoints({ options: f.options }).find(route => route.path === '/xp/pages')!
  expect((await endpoint.handler(f.req)).status).toBe(403)
  expect(f.findByPath).not.toHaveBeenCalled()
})

test.each(['id', 'missing'])('path title never reveals a raw id when useAsTitle is %s', async titleField => {
  const f = fixture()
  f.payload.config.collections[0]!.admin.useAsTitle = titleField
  expect(await (await handlePages(f.req, { options: f.options })).json()).toMatchObject({ docs: [{ title: 'odd path/?a=1' }] })
})
