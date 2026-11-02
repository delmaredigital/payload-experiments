import { expect, test } from 'vitest'
import { routeAccess } from '../../../src/admin/views/access.model.js'
import type { TestsRoute } from '../../../src/types/surface.js'

const routes: TestsRoute[] = ['home', 'new', 'test', 'results']
test.each(routes)('%s requires a user and the appropriate permission', route => {
  expect(routeAccess({ route, hasUser: false, canManage: true, canReadResults: true })).toBe('login')
  expect(routeAccess({ route, hasUser: true, canManage: false, canReadResults: false })).toBe('unauthorized')
  expect(routeAccess({ route, hasUser: true, canManage: true })).toBe('ok')
  expect(routeAccess({ route, hasUser: true, canManage: false, canReadResults: true })).toBe(route === 'results' ? 'ok' : 'unauthorized')
})
test('an explicit readResults refusal wins over manage', () => {
  expect(routeAccess({ route: 'results', hasUser: true, canManage: true, canReadResults: false })).toBe('unauthorized')
})
test.each([1, 'yes', {}, undefined, null])('truthy and missing permissions never grant access: %s', canManage => {
  for (const route of routes) expect(routeAccess({ route, hasUser: true, canManage })).toBe('unauthorized')
})
