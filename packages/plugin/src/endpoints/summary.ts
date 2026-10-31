import type { PayloadRequest } from 'payload'
import type { EndpointContext, SummaryResponse } from '../types/endpoints.js'
import { readSnapshots, resultsError } from './results.js'
export async function handleSummary<TUser extends { id: string | number } = { id: string | number }>(req: PayloadRequest, _ctx: EndpointContext<TUser>): Promise<Response> {
  let ids: string[]
  try {
    // Split before decoding: an opaque id can itself contain a comma.
    const raw = new URL(req.url ?? 'http://localhost').search.slice(1).split('&').find(part => part.split('=')[0] === 'ids')?.slice(4)
    if (raw === undefined) return resultsError(400, 'invalid-body', 'Provide experiment ids')
    ids = raw.split(',').map(id => decodeURIComponent(id.replaceAll('+', ' ')))
  } catch { return resultsError(400, 'invalid-body', 'Could not parse experiment ids') }
  if (ids.length > 100) return resultsError(422, 'too-many-ids', 'Request at most 100 experiments')
  if (ids.some(id => !id.trim())) return resultsError(422, 'invalid-ids', 'Experiment ids must be nonempty')
  const snapshots = await readSnapshots(req, [...new Set(ids)], { per: 'experiment' })
  const response: SummaryResponse = Object.create(null)
  for (const id of ids) {
    const snapshot = snapshots.find(row => String(typeof row.experiment === 'object' ? row.experiment.id : row.experiment) === id)?.snapshot
    response[id] = snapshot ? { exposures: snapshot.exposures.total,
      days: Math.max(0, (Date.parse(snapshot.window.to) - Date.parse(snapshot.window.from)) / 86_400_000),
      verdict: { code: snapshot.verdict.code, headline: snapshot.verdict.headline } } : { exposures: 0, days: 0, verdict: null }
  }
  return Response.json(response, { headers: { 'Cache-Control': 'no-store' } })
}
