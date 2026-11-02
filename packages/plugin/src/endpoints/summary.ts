import type { PayloadRequest } from 'payload'
import type { EndpointContext, SummaryResponse } from '../types/endpoints.js'
import { checkStart, type StartExperiment } from '../transitions/checkStart.js'
import { loadStartInputsBatch } from '../transitions/preflightData.js'
import { readSnapshots, resultsError } from './results.js'
export async function handleSummary<TUser extends { id: string | number } = { id: string | number }>(req: PayloadRequest, { options }: EndpointContext<TUser>): Promise<Response> {
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
  if (await options.access.manage({ req }) === true) {
    const found = await req.payload.find({ collection: 'xp-experiments', req, overrideAccess: false, depth: 0, pagination: false, limit: ids.length, where: { id: { in: [...new Set(ids)] } } })
    const drafts = (found.docs as unknown as StartExperiment[]).filter(e => e.status === 'draft' || e.status === 'stopped')
    const inputs = await loadStartInputsBatch(req, options, drafts, true)
    for (const id of ids) {
      // Payload normalises numeric ids (for example 01 to 1); preserve the requested response key.
      const experiment = drafts.find(e => String(e.id) === id || typeof e.id === 'number' && Number(id) === e.id)
      if (!experiment) continue
      const input = inputs.get(String(experiment.id))
      try { response[id]!.ready = !!input && checkStart(input).every(check => check.ok) }
      catch { response[id]!.ready = false }
    }
  }
  return Response.json(response, { headers: { 'Cache-Control': 'no-store' } })
}
