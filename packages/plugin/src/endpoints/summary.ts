import type { PayloadRequest } from 'payload'
import type { ResolvedOptions } from '../types/contracts.js'
import type { ErrorEnvelope } from '../types/endpoints.js'
export async function handleSummary(_req: PayloadRequest, _ctx: { options: ResolvedOptions }): Promise<Response> {
  return Response.json({ errors: [{ code: 'not-implemented', message: 'CORE-15b' }] } satisfies ErrorEnvelope, { status: 501 })
}
