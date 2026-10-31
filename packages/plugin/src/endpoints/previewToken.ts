import type { PayloadRequest } from 'payload'
import type { EndpointContext, ErrorEnvelope } from '../types/endpoints.js'
import { signPreviewToken } from '../runtime/previewToken.js'

export async function handlePreviewToken<TUser extends { id: string | number } = { id: string | number }>(req: PayloadRequest, { options }: EndpointContext<TUser>): Promise<Response> {
  const headers = { 'Cache-Control': 'no-store' }
  const refuse = (status: number, code: 'not-found' | 'invalid-body' | 'invalid-status', message: string) =>
    Response.json({ errors: [{ code, message }] } satisfies ErrorEnvelope, { status, headers })
  const id = req.routeParams?.id
  if (typeof id !== 'string' && typeof id !== 'number') return refuse(404, 'not-found', 'Experiment not found')
  const result = await req.payload.find({ collection: 'xp-experiments', req, overrideAccess: false, depth: 0, limit: 1, where: { id: { equals: id } } })
  const experiment = result.docs[0]
  if (!experiment) return refuse(404, 'not-found', 'Experiment not found')
  if (!['draft', 'running', 'stopped', 'decided'].includes(experiment.status as string)) return refuse(409, 'invalid-status', 'This experiment cannot be previewed')
  const arm = req.searchParams?.get('arm') ?? (req.url ? new URL(req.url).searchParams.get('arm') : null)
  const arms = experiment.arms as Array<{ key: string }>
  if (!arm || !arms.some(candidate => candidate.key === arm)) return refuse(400, 'invalid-body', 'Unknown experiment arm')
  const now = Math.floor(Date.now() / 1000)
  const token = signPreviewToken({ e: experiment.id, a: arm, p: experiment.phase as number, exp: now + 3600 }, options.runtime.proxyRuntime.secrets, now)
  return Response.json({ token }, { headers })
}
