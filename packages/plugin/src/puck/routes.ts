export interface PuckRoutes { admin?: string; api?: string }
// Payload's documented route defaults; hosts pass config.routes when customized.
export const DEFAULT_PUCK_ROUTES = { admin: '/admin', api: '/api' } as const
export function resolvePuckRoutes(routes?: PuckRoutes) {
  return {
    admin: (routes?.admin ?? DEFAULT_PUCK_ROUTES.admin).replace(/\/$/, ''),
    api: (routes?.api ?? DEFAULT_PUCK_ROUTES.api).replace(/\/$/, ''),
  }
}
