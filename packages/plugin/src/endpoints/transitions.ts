import type { PayloadRequest } from 'payload'
import type { EndpointContext, ErrorEnvelope } from '../types/endpoints.js'
import { XpRefusal } from '../errors.js'
import { start } from '../transitions/start.js'
import { allocate } from '../transitions/allocate.js'
import { addMetric } from '../transitions/addMetric.js'
import { stop } from '../transitions/stop.js'
import { decide } from '../transitions/decide.js'
import { releaseHoldout } from '../transitions/releaseHoldout.js'
import { archive } from '../transitions/archive.js'
import type { ArchiveBody } from '../types/endpoints.js'

const invalidBody = () => Response.json({ errors: [{ code: 'invalid-body', message: 'Enter a valid request body.' }] } satisfies ErrorEnvelope, { status: 400 })
async function body(req: PayloadRequest): Promise<Record<string, unknown> | null> {
  try {
    if (!req.body && !req.data) return {}
    // An empty body (Content-Length: 0) means no options, not a malformed request.
    const text = req.data === undefined ? await req.text!() : ''
    const value: unknown = req.data ?? (text.trim() ? JSON.parse(text) : {})
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
  } catch { return null }
}
const only = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).every(key => keys.includes(key))
async function respond(req: PayloadRequest, action: (id: string | number) => Promise<unknown>) {
  const id = req.routeParams?.id
  if (typeof id !== 'string' && typeof id !== 'number') return Response.json({ errors: [{ code: 'not-found', message: 'Experiment not found' }] } satisfies ErrorEnvelope, { status: 404 })
  try { return Response.json(await action(id), { headers: { 'Cache-Control': 'no-store' } }) }
  catch (cause) {
    if (cause instanceof XpRefusal) return Response.json({ errors: [{ code: cause.code, message: cause.message, ...(cause.detail === undefined ? {} : { detail: cause.detail }) }] } satisfies ErrorEnvelope, { status: cause.status === 409 ? 422 : cause.status })
    throw cause
  }
}
export async function handleStart<TUser extends { id: string | number } = { id: string | number }>(req: PayloadRequest, ctx: EndpointContext<TUser>): Promise<Response> {
  const value = await body(req)
  if (!value || !only(value, [])) return invalidBody()
  return respond(req, id => start(req, { experimentId: id, options: ctx.options }))
}
export async function handleAllocate<TUser extends { id: string | number } = { id: string | number }>(req: PayloadRequest, _ctx: EndpointContext<TUser>): Promise<Response> {
  const value = await body(req)
  if (!value || !only(value, ['allocation']) || typeof value.allocation !== 'number' || !Number.isInteger(value.allocation) || value.allocation < 1 || value.allocation > 100) return invalidBody()
  const allocation = value.allocation
  return respond(req, id => allocate(req, { experimentId: id, allocation }))
}
export async function handleAddMetric<TUser extends { id: string | number } = { id: string | number }>(req: PayloadRequest, ctx: EndpointContext<TUser>): Promise<Response> {
  const value = await body(req)
  if (!value || !only(value, ['metric', 'role']) || !(typeof value.metric === 'string' && value.metric.trim() || typeof value.metric === 'number' && Number.isSafeInteger(value.metric)) || value.role !== 'secondary' && value.role !== 'guardrail') return invalidBody()
  const metric = value.metric as string | number, role = value.role
  return respond(req, id => addMetric(req, { experimentId: id, metric, role, options: ctx.options }))
}
export async function handleStop<TUser extends { id: string | number } = { id: string | number }>(req: PayloadRequest, _ctx: EndpointContext<TUser>): Promise<Response> {
  const value = await body(req)
  if (!value || !only(value, [])) return invalidBody()
  return respond(req, id => stop(req, { experimentId: id }))
}
export async function handleDecide<TUser extends { id: string | number } = { id: string | number }>(req: PayloadRequest, _ctx: EndpointContext<TUser>): Promise<Response> {
  const value = await body(req)
  if (!value || !only(value, ['winnerArm', 'note', 'confirmation']) || typeof value.winnerArm !== 'string'
    || value.note !== undefined && typeof value.note !== 'string' || value.confirmation !== undefined && typeof value.confirmation !== 'string') return invalidBody()
  const { winnerArm, note, confirmation } = value as { winnerArm: string; note?: string; confirmation?: string }
  return respond(req, id => decide(req, { experimentId: id, winnerArm, note, confirmation }))
}
export async function handleReleaseHoldout<TUser extends { id: string | number } = { id: string | number }>(req: PayloadRequest, _ctx: EndpointContext<TUser>): Promise<Response> {
  const value = await body(req)
  if (!value || !only(value, [])) return invalidBody()
  return respond(req, id => releaseHoldout(req, { experimentId: id }))
}
export async function handleMakeContent<TUser extends { id: string | number } = { id: string | number }>(_req: PayloadRequest, _ctx: EndpointContext<TUser>): Promise<Response> {
  return Response.json({ errors: [{ code: 'not-implemented', message: 'CORE-12' }] } satisfies ErrorEnvelope, { status: 501 })
}
export async function handleArchive<TUser extends { id: string | number } = { id: string | number }>(req: PayloadRequest, _ctx: EndpointContext<TUser>): Promise<Response> {
  const value = await body(req)
  if (!value || !only(value, ['mode', 'confirmation']) || !['stopped', 'after-content', 'discard', 'hard-coded'].includes(value.mode as string)
    || value.confirmation !== undefined && typeof value.confirmation !== 'string') return invalidBody()
  const { mode, confirmation } = value as ArchiveBody
  return respond(req, id => archive(req, { experimentId: id, mode, confirmation }))
}
