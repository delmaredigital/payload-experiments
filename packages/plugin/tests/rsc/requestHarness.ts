import { beforeEach, vi } from 'vitest'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { encodeUnitCookie } from '../../src/runtime/cookie.js'
import { secrets } from './helpers.js'

const requestState = vi.hoisted(() => ({ headers: new Headers(), cookie: '', headersRead: vi.fn(), cookiesRead: vi.fn() }))
export { requestState }
vi.mock('next/headers', () => ({
  headers: async () => { requestState.headersRead(); return requestState.headers },
  cookies: async () => { requestState.cookiesRead(); return { get: () => requestState.cookie ? { value: requestState.cookie } : undefined } },
}))
// Use React's real server cache with an isolated request dispatcher. The default
// non-RSC React export intentionally makes cache() a no-op.
vi.mock('react', async () => {
  const require = createRequire(import.meta.url)
  return require(join(dirname(require.resolve('react')), 'cjs/react.react-server.development.js'))
})
import * as React from 'react'
export function newRequest() {
  const roots = new Map<unknown, unknown>()
  const internals = (React as unknown as { __SERVER_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: { A: unknown } }).__SERVER_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE
  internals.A = { getCacheForType(factory: () => unknown) { if (!roots.has(factory)) roots.set(factory, factory()); return roots.get(factory) } }
  requestState.headers = new Headers({ cookie: `xp_id=${encodeUnitCookie('visitor', secrets)}` })
  requestState.cookie = encodeUnitCookie('visitor', secrets)
  requestState.headersRead.mockClear()
  requestState.cookiesRead.mockClear()
}
beforeEach(newRequest)
