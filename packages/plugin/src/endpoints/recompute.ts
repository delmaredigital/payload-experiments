import type { PayloadRequest } from 'payload'
import type { EndpointContext } from '../types/endpoints.js'
import { runResults } from '../server/runResults.js'
import { readSnapshots, resultsError } from './results.js'
import { routeId } from './routeId.js'
export async function handleRecompute<TUser extends { id: string | number } = { id: string | number }>(req: PayloadRequest, _ctx: EndpointContext<TUser>): Promise<Response> {
  const id = routeId(req)
  if (id === undefined) return resultsError(404, 'not-found', 'Experiment not found')
  const { docs } = await req.payload.find({ collection: 'xp-experiments', req, overrideAccess: false, depth: 0, limit: 1, where: { id: { equals: id } } })
  if (!docs[0]) return resultsError(404, 'not-found', 'Experiment not found')
  try {
    const result = await runResults(req.payload, { experimentId: docs[0].id, sweep: false })
    if (result.skipped || result.budgetExhausted) return resultsError(503, 'recompute-failed', 'Results could not be recomputed. Try again.')
    const latest = (await readSnapshots(req, [docs[0].id], { per: 'experiment' }))[0]
    if (!latest) return resultsError(422, 'recompute-failed', 'There is no round to analyse yet.')
    return Response.json({ snapshotId: latest.id }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return resultsError(503, 'recompute-failed', 'Results could not be recomputed. Try again.')
  }
}
