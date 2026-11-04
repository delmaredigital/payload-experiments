// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, test, vi } from 'vitest'
import { nextNavigationMock, payloadUiMock, resetPayloadUiMock, setAuth } from '../_helpers/payloadUiMock.js'
import { TestsNavLink } from '../../../src/admin/TestsNavLink.js'
import { TestsNavLinkServer } from '../../../src/admin/views/TestsNavLinkServer.js'
import { XP_TESTS_NAV_CLIENT } from '../../../src/admin/paths.js'
import { fakePayload } from '../../_fakes/payload.js'

vi.mock('@payloadcms/ui', () => payloadUiMock())
vi.mock('next/navigation', () => nextNavigationMock())
beforeEach(() => {
  resetPayloadUiMock()
  setAuth({ permissions: { collections: { 'xp-experiments': { update: true } } } })
})

function setup(value?: unknown) {
  const find = vi.fn(async () => ({ docs: value === undefined ? [] : [{ value }] }))
  const payload = fakePayload({ overrides: { find, importMap: { [XP_TESTS_NAV_CLIENT]: TestsNavLink } } })
  const props = { payload, user: { id: 'manager', collection: 'users' }, permissions: { collections: { 'xp-experiments': { fields: {}, update: true as const } } } }
  return { props, payload, find }
}

test('stored collapsed state is passed to NavGroup in the initial markup', async () => {
  const { props } = setup({ groups: { Tests: { open: false } } })
  const html = renderToStaticMarkup(await TestsNavLinkServer(props))
  expect(html).toContain('data-is-open="false"')
  expect(html).not.toContain('data-is-open="true"')
  expect(html).toContain('nav-xp-tests')
})

test.each([undefined, null, {}, { groups: {} }, { groups: { Tests: {} } }, { groups: { Tests: { open: true } } }])(
  'missing or open preference %j renders open on the first render', async value => {
    const { props } = setup(value)
    expect(renderToStaticMarkup(await TestsNavLinkServer(props))).toContain('data-is-open="true"')
  },
)

test.each(['users', 'admins'])('reads only the signed-in %s user’s nav preference, without writes', async collection => {
  const { props, find, payload } = setup({ groups: { Tests: { open: false } } })
  const user = { id: 'signed-in-user', collection }
  await TestsNavLinkServer({ ...props, user })
  expect(find).toHaveBeenCalledExactlyOnceWith({
    collection: 'payload-preferences',
    where: { and: [
      { key: { equals: 'nav' } },
      { 'user.relationTo': { equals: collection } },
      { 'user.value': { equals: user.id } },
    ] },
    limit: 1, pagination: false, depth: 0, user, overrideAccess: false,
  })
  expect(payload.calls).toEqual([])
})

test('readers without update permission see nothing and trigger no preference read', async () => {
  const { props, find } = setup()
  expect(await TestsNavLinkServer({ ...props, permissions: { collections: { 'xp-experiments': { fields: {} } } } })).toBeNull()
  expect(find).not.toHaveBeenCalled()
})

test('missing user or permissions renders nothing without a preference read', async () => {
  const { props, find } = setup()
  expect(await TestsNavLinkServer({ ...props, user: undefined })).toBeNull()
  expect(await TestsNavLinkServer({ ...props, permissions: undefined })).toBeNull()
  expect(find).not.toHaveBeenCalled()
})
