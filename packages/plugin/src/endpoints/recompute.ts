import type { PayloadRequest } from 'payload'
import type { EndpointContext } from '../types/endpoints.js'
import { runResults } from '../server/runResults.js'
import { readSnapshots, resultsError } from './results.js'
export async function handleRecompute<TUser extends { id: string | number } = { id: string | number }>(req: PayloadRequest, _ctx: EndpointContext<TUser>): Promise<Response> {
  const id = req.routeParams?.id
  if (typeof id !== 'string' && typeof id !== 'number') return resultsError(404, 'not-found', 'Experiment not found')
  const { docs } = await req.payload.find({ collection: 'xp-experiments', req, overrideAccess: false, depth: 0, limit: 1, where: { id: { equals: id } } })
  if (!docs[0]) return resultsError(404, 'not-found', 'Experiment not found')
  const result = await runResults(req.payload, { experimentId: docs[0].id })
  const latest = result.ran ? (await readSnapshots(req, [docs[0].id]))[0] : undefined
  return Response.json({ snapshotId: latest?.id ?? null }, { headers: { 'Cache-Control': 'no-store' } })
}
