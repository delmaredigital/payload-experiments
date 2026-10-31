import type { PayloadRequest } from 'payload'
import type { EndpointContext, ErrorEnvelope } from '../types/endpoints.js'
export async function handleManifest<TUser extends { id: string | number } = { id: string | number }>(_req: PayloadRequest, _ctx: EndpointContext<TUser>): Promise<Response> {
  return Response.json({ errors: [{ code: 'not-implemented', message: 'CORE-05' }] } satisfies ErrorEnvelope, { status: 501 })
}
