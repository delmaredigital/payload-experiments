import { clickKeys } from '../goals/cache.js'
import { validClickSource } from '../goals/key.js'
import { safeError } from '../log.js'
import { NextRequest } from 'next/server.js'
import type { PayloadRequest } from 'payload'
import { DEFAULT_MAX_BODY_BYTES } from '../constants.js'
import { pooledExecutor } from '../db/executor.js'
import { insertEvents } from '../db/events.js'
import { EventsBodyError, readEvents } from '../events/body.js'
import { isPreview } from '../events/preview.js'
import { sourceRequest } from '../events/request.js'
import { eventRows } from '../events/rows.js'
import { assign } from '../runtime/assign.js'
import { isBot } from '../runtime/bot.js'
import { readUnitCookie } from '../runtime/cookie.js'
import { requestAttributes } from '../runtime/normalisePath.js'
import { serverManifest } from '../server/context.js'
import type { Attributes } from '../types/contracts.js'
import type { EndpointContext, ErrorEnvelope } from '../types/endpoints.js'

const accepted = () => Response.json({}, { status: 202 })
export async function handleEvents<TUser extends { id: string | number } = { id: string | number }>(req: PayloadRequest, { options }: EndpointContext<TUser>): Promise<Response> {
  const runtime = options.runtime, proxy = runtime.proxyRuntime
  const visitorId = readUnitCookie(req.headers, proxy)
  if (!visitorId) return Response.json({ errors: [{ code: 'unauthenticated', message: 'Invalid unit cookie' }] } satisfies ErrorEnvelope, { status: 401 })
  let events: unknown[]
  try { events = await readEvents(req.body, options.events?.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES) } catch (error) {
    if (error instanceof EventsBodyError) return Response.json({ errors: [{ code: error.code, message: error.message }] } satisfies ErrorEnvelope, { status: error.status })
    throw error
  }
  try {
    const request = new NextRequest(req.url ?? 'https://xp.invalid/', { headers: req.headers, method: req.method })
    // API paths bypass the proxy: re-check consent even when a stale signed cookie exists.
    try { if (proxy.cookie.consent?.(request) === false) return accepted() } catch { return accepted() }
    if (options.events?.rateLimit && await options.events.rateLimit({ req, unitId: visitorId }) !== true) return accepted()
    const manifest = await serverManifest(proxy)
    if (!manifest) return accepted()
    const source = sourceRequest(request)
    const unit = await proxy.getUnit?.(source ?? request)
    const user = (req.user ?? null) as TUser | null
    const userId = user ? runtime.userIdOf(user) : undefined
    // The beacon URL is an API route, not the page whose content was rendered.
    // A referrer supplies page context only, never an identity or an assigned arm.
    const attributes = requestAttributes({ ...unit?.attributes, ...runtime.attributesOf(user) } as Attributes, source?.nextUrl.pathname)
    const unresolvedStaff = Boolean(options.attributeKeys?.staff && unit?.sessionUnknown && !user)
    const assignments = assign(manifest, { visitorId, userId }, attributes, {
      now: Math.floor(Date.now() / 1000), method: req.method,
      staff: unit?.attributes.staff === true || attributes.staff === true,
      bot: isBot(req.headers.get('user-agent')), preview: isPreview(request),
    })
    if (unresolvedStaff) for (const assignment of Object.values(assignments.bySlug)) assignment.exposable = false
    const keys = events.some(event => event && typeof event === 'object' && 'eventName' in event && validClickSource(event.eventName)) ? await clickKeys(req.payload) : undefined
    const rows = eventRows(events, manifest, assignments, options, visitorId, userId, new Date().toISOString(), attributes, keys)
    // §7.8 events insert / assignment lookup exception: pooled SQL and cached manifest,
    // no Local API calls (and hence no implicit overrideAccess defaults).
    if (rows.length) await insertEvents(pooledExecutor(req.payload), rows, message => req.payload.logger.error(message))
  } catch (error) {
    try { req.payload.logger.error({ err: safeError(error) }, 'Experiments: events endpoint failed') } catch { /* Telemetry and logging must never break the request. */ }
  }
  return accepted()
}
