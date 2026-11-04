import { createHmac, timingSafeEqual } from 'node:crypto'
import type { Endpoint, PayloadRequest } from 'payload'
import { XP_MANIFEST_KEY_HEADER } from '../constants.js'
import { XpNotImplemented, XpRefusal } from '../errors.js'
import { readUnitCookie } from '../runtime/cookie.js'
import type { ResolvedOptions } from '../types/contracts.js'
import type { AccessKind, EndpointContext, ErrorEnvelope, RefusalCode } from '../types/endpoints.js'
import { handleManifest } from './manifest.js'
import { handleEvents } from './events.js'
import { handleStart, handleAllocate, handleAddMetric, handleStop, handleDecide, handleReleaseHoldout, handleReleasePages, handleMakeContent, handleDismissContentEntry, handleArchive } from './transitions.js'
import { handlePreflight } from './preflight.js'
import { handlePreviewToken } from './previewToken.js'
import { handleResults } from './results.js'
import { handleRecompute } from './recompute.js'
import { handleSummary } from './summary.js'

export const ROUTES: Array<{ method: Endpoint['method']; path: string; access: AccessKind; handler: <TUser extends { id: string | number }>(req: PayloadRequest, ctx: EndpointContext<TUser>) => Promise<Response> }> = [
  { method: 'get', path: '/xp/manifest', access: 'manifestKey', handler: handleManifest },
  { method: 'post', path: '/xp/events', access: 'signedCookie', handler: handleEvents },
  { method: 'post', path: '/xp/experiments/:id/start', access: 'manage', handler: handleStart },
  { method: 'post', path: '/xp/experiments/:id/allocate', access: 'manage', handler: handleAllocate },
  { method: 'post', path: '/xp/experiments/:id/add-metric', access: 'manage', handler: handleAddMetric },
  { method: 'post', path: '/xp/experiments/:id/stop', access: 'manage', handler: handleStop },
  { method: 'post', path: '/xp/experiments/:id/decide', access: 'manage', handler: handleDecide },
  { method: 'post', path: '/xp/experiments/:id/release-holdout', access: 'manage', handler: handleReleaseHoldout },
  { method: 'post', path: '/xp/experiments/:id/release-pages', access: 'manage', handler: handleReleasePages },
  { method: 'post', path: '/xp/experiments/:id/make-content', access: 'manage', handler: handleMakeContent },
  { method: 'post', path: '/xp/experiments/:id/content-report/dismiss', access: 'manage', handler: handleDismissContentEntry },
  { method: 'post', path: '/xp/experiments/:id/archive', access: 'manage', handler: handleArchive },
  { method: 'get', path: '/xp/experiments/:id/preflight', access: 'manage', handler: handlePreflight },
  { method: 'get', path: '/xp/experiments/:id/preview-token', access: 'manage', handler: handlePreviewToken },
  { method: 'get', path: '/xp/experiments/:id/results', access: 'readResults', handler: handleResults },
  { method: 'post', path: '/xp/experiments/:id/recompute', access: 'manage', handler: handleRecompute },
  { method: 'get', path: '/xp/experiments/summary', access: 'readResults', handler: handleSummary },
]
function error(status: number, code: RefusalCode, message: string, detail?: unknown): Response {
  return Response.json({ errors: [{ code, message, ...(detail === undefined ? {} : { detail }) }] } satisfies ErrorEnvelope, { status })
}
export function buildEndpoints<TUser extends { id: string | number } = { id: string | number }>(ctx: { options: ResolvedOptions<TUser> }): Endpoint[] {
  return ROUTES.map(route => ({ method: route.method, path: route.path, handler: async req => {
    const { options } = ctx
    const handlerContext: EndpointContext<TUser> = { options }
    try {
      if (route.access === 'manage' || route.access === 'readResults') {
        if (!req.user) return error(401, 'unauthenticated', 'Authentication required')
        const access = route.access === 'readResults' ? options.access.readResults ?? options.access.manage : options.access.manage
        if (await access({ req }) !== true) return error(403, 'forbidden', 'Access denied')
      } else if (route.access === 'manifestKey') {
        const secret = options.runtime.proxyRuntime.secrets[0]
        if (!secret) return error(401, 'unauthenticated', 'Invalid manifest key')
        const expected = createHmac('sha256', secret).update('xp:manifest-key').digest('hex')
        const supplied = req.headers.get(XP_MANIFEST_KEY_HEADER)
        // Compare the wire hex bytes, including length and case, rather than permissive hex decoding.
        if (!supplied || Buffer.byteLength(supplied) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
          return error(401, 'unauthenticated', 'Invalid manifest key')
        }
      } else {
        const visitorId = readUnitCookie(req.headers, options.runtime.proxyRuntime)
        if (!visitorId) return error(401, 'unauthenticated', 'Invalid unit cookie')
        handlerContext.unit = { visitorId }
      }
      return await route.handler(req, handlerContext)
    } catch (cause) {
      if (cause instanceof XpRefusal) return error(cause.status, cause.code, cause.message, cause.detail)
      if (cause instanceof XpNotImplemented) return error(501, 'not-implemented', cause.lane)
      throw cause
    }
  } }))
}
