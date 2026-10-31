import type { PayloadRequest } from 'payload'
import type { ResolvedOptions } from '../types/contracts.js'
import type { ErrorEnvelope } from '../types/endpoints.js'
export async function handleManifest(_req: PayloadRequest, _ctx: { options: ResolvedOptions }): Promise<Response> {
  return Response.json({ errors: [{ code: 'not-implemented', message: 'CORE-05' }] } satisfies ErrorEnvelope, { status: 501 })
}
