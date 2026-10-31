import type { PayloadRequest } from 'payload'
import type { ResolvedOptions } from '../types/contracts.js'
import type { ErrorEnvelope } from '../types/endpoints.js'
export async function handleStart(_req: PayloadRequest, _ctx: { options: ResolvedOptions }): Promise<Response> {
  return Response.json({ errors: [{ code: 'not-implemented', message: 'CORE-10b' }] } satisfies ErrorEnvelope, { status: 501 })
}
export async function handleAllocate(_req: PayloadRequest, _ctx: { options: ResolvedOptions }): Promise<Response> {
  return Response.json({ errors: [{ code: 'not-implemented', message: 'CORE-10b' }] } satisfies ErrorEnvelope, { status: 501 })
}
export async function handleAddMetric(_req: PayloadRequest, _ctx: { options: ResolvedOptions }): Promise<Response> {
  return Response.json({ errors: [{ code: 'not-implemented', message: 'CORE-10b' }] } satisfies ErrorEnvelope, { status: 501 })
}
export async function handleStop(_req: PayloadRequest, _ctx: { options: ResolvedOptions }): Promise<Response> {
  return Response.json({ errors: [{ code: 'not-implemented', message: 'CORE-10b' }] } satisfies ErrorEnvelope, { status: 501 })
}
export async function handleDecide(_req: PayloadRequest, _ctx: { options: ResolvedOptions }): Promise<Response> {
  return Response.json({ errors: [{ code: 'not-implemented', message: 'CORE-11' }] } satisfies ErrorEnvelope, { status: 501 })
}
export async function handleReleaseHoldout(_req: PayloadRequest, _ctx: { options: ResolvedOptions }): Promise<Response> {
  return Response.json({ errors: [{ code: 'not-implemented', message: 'CORE-11' }] } satisfies ErrorEnvelope, { status: 501 })
}
export async function handleMakeContent(_req: PayloadRequest, _ctx: { options: ResolvedOptions }): Promise<Response> {
  return Response.json({ errors: [{ code: 'not-implemented', message: 'CORE-12' }] } satisfies ErrorEnvelope, { status: 501 })
}
export async function handleArchive(_req: PayloadRequest, _ctx: { options: ResolvedOptions }): Promise<Response> {
  return Response.json({ errors: [{ code: 'not-implemented', message: 'CORE-11' }] } satisfies ErrorEnvelope, { status: 501 })
}
