import type { PayloadRequest } from 'payload'
import type { EndpointContext, ErrorEnvelope } from '../types/endpoints.js'
export async function handleStart<TUser extends { id: string | number } = { id: string | number }>(_req: PayloadRequest, _ctx: EndpointContext<TUser>): Promise<Response> {
  return Response.json({ errors: [{ code: 'not-implemented', message: 'CORE-10b' }] } satisfies ErrorEnvelope, { status: 501 })
}
export async function handleAllocate<TUser extends { id: string | number } = { id: string | number }>(_req: PayloadRequest, _ctx: EndpointContext<TUser>): Promise<Response> {
  return Response.json({ errors: [{ code: 'not-implemented', message: 'CORE-10b' }] } satisfies ErrorEnvelope, { status: 501 })
}
export async function handleAddMetric<TUser extends { id: string | number } = { id: string | number }>(_req: PayloadRequest, _ctx: EndpointContext<TUser>): Promise<Response> {
  return Response.json({ errors: [{ code: 'not-implemented', message: 'CORE-10b' }] } satisfies ErrorEnvelope, { status: 501 })
}
export async function handleStop<TUser extends { id: string | number } = { id: string | number }>(_req: PayloadRequest, _ctx: EndpointContext<TUser>): Promise<Response> {
  return Response.json({ errors: [{ code: 'not-implemented', message: 'CORE-10b' }] } satisfies ErrorEnvelope, { status: 501 })
}
export async function handleDecide<TUser extends { id: string | number } = { id: string | number }>(_req: PayloadRequest, _ctx: EndpointContext<TUser>): Promise<Response> {
  return Response.json({ errors: [{ code: 'not-implemented', message: 'CORE-11' }] } satisfies ErrorEnvelope, { status: 501 })
}
export async function handleReleaseHoldout<TUser extends { id: string | number } = { id: string | number }>(_req: PayloadRequest, _ctx: EndpointContext<TUser>): Promise<Response> {
  return Response.json({ errors: [{ code: 'not-implemented', message: 'CORE-11' }] } satisfies ErrorEnvelope, { status: 501 })
}
export async function handleMakeContent<TUser extends { id: string | number } = { id: string | number }>(_req: PayloadRequest, _ctx: EndpointContext<TUser>): Promise<Response> {
  return Response.json({ errors: [{ code: 'not-implemented', message: 'CORE-12' }] } satisfies ErrorEnvelope, { status: 501 })
}
export async function handleArchive<TUser extends { id: string | number } = { id: string | number }>(_req: PayloadRequest, _ctx: EndpointContext<TUser>): Promise<Response> {
  return Response.json({ errors: [{ code: 'not-implemented', message: 'CORE-11' }] } satisfies ErrorEnvelope, { status: 501 })
}
