import type { PayloadRequest } from 'payload'
import type { ResolvedOptions } from '../types/contracts.js'
import type { ErrorEnvelope } from '../types/endpoints.js'
export async function handleEvents(_req: PayloadRequest, _ctx: { options: ResolvedOptions }): Promise<Response> {
  return Response.json({ errors: [{ code: 'not-implemented', message: 'CORE-08b' }] } satisfies ErrorEnvelope, { status: 501 })
}
