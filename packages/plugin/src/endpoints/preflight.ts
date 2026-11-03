import type { PayloadRequest } from 'payload'
import type { EndpointContext, ErrorEnvelope } from '../types/endpoints.js'
import { preflightData } from '../transitions/preflightData.js'
import type { PreflightDependencies } from '../transitions/preflightData.js'
import { routeId } from './routeId.js'

export async function handlePreflight<TUser extends { id: string | number } = { id: string | number }>(req: PayloadRequest, ctx: EndpointContext<TUser>, dependencies?: PreflightDependencies): Promise<Response> {
  const id = routeId(req)
  const result = id !== undefined
    ? await preflightData(req, { experimentId: id, options: ctx.options }, dependencies) : null
  const headers = { 'Cache-Control': 'no-store' }
  if (!result) return Response.json({ errors: [{ code: 'not-found', message: 'Experiment not found' }] } satisfies ErrorEnvelope, { status: 404, headers })
  return Response.json(result, { headers })
}
