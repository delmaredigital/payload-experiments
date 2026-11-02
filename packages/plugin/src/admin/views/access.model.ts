import type { TestsRoute } from '../../types/surface.js'

export function routeAccess({ route, hasUser, canManage, canReadResults }: {
  route: TestsRoute; hasUser: boolean; canManage: unknown; canReadResults?: unknown
}): 'login' | 'unauthorized' | 'ok' {
  if (!hasUser) return 'login'
  const allowed = route === 'results' ? canReadResults ?? canManage : canManage
  return allowed === true ? 'ok' : 'unauthorized'
}
