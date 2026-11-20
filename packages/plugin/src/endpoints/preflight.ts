import { contentLocale } from './contentLocale.js'
import { sanitizeFallbackLocale, type PayloadRequest } from 'payload'
import { localeRequest } from '../blocks/placementLocale.js'
import type { EndpointContext, ErrorEnvelope } from '../types/endpoints.js'
import { preflightData } from '../transitions/preflightData.js'
import type { PreflightDependencies } from '../transitions/preflightData.js'
import { routeId } from './routeId.js'

export async function handlePreflight<TUser extends { id: string | number } = { id: string | number }>(req: PayloadRequest, ctx: EndpointContext<TUser>, dependencies?: PreflightDependencies): Promise<Response> {
  const id = routeId(req)
  const placementLocale = contentLocale(req).locale ?? undefined
  const localization = req.payload.config.localization
  // The query selects readiness labels only. Host reads must match Start's default request.
  const readinessReq = localization ? localeRequest(req, { locale: localization.defaultLocale,
    fallbackLocale: sanitizeFallbackLocale({ fallbackLocale: null, locale: localization.defaultLocale, localization }) }) : req
  const result = id !== undefined
    ? await preflightData(readinessReq, { experimentId: id, options: ctx.options, placementLocale }, dependencies) : null
  const headers = { 'Cache-Control': 'no-store' }
  if (!result) return Response.json({ errors: [{ code: 'not-found', message: 'Experiment not found' }] } satisfies ErrorEnvelope, { status: 404, headers })
  return Response.json(result, { headers })
}
