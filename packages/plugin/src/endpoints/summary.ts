import type { PayloadRequest } from 'payload'
import type { EndpointContext, SummaryResponse } from '../types/endpoints.js'
import { checkStart, type StartExperiment } from '../transitions/checkStart.js'
import { loadStartInputsBatch } from '../transitions/preflightData.js'
import { readSnapshots, resultsError } from './results.js'
import { experimentId } from './routeId.js'
import { sanitizeReadinessDetail } from './sanitizeReadinessDetail.js'
export async function handleSummary<TUser extends { id: string | number } = { id: string | number }>(req: PayloadRequest, { options }: EndpointContext<TUser>): Promise<Response> {
  let ids: string[]
  try {
    const url = new URL(req.url ?? 'http://localhost')
    // URLSearchParams tolerates malformed escapes; preserve the existing parse refusal.
    decodeURIComponent(url.search.replaceAll('+', ' '))
    const values = url.searchParams.getAll('ids')
    if (values.length === 0) return resultsError(400, 'invalid-body', 'Provide experiment ids')
    ids = values.flatMap(value => value.split(',')).map(id => id.trim()).filter(Boolean)
  } catch { return resultsError(400, 'invalid-body', 'Could not parse experiment ids') }
  if (ids.length > 100) return resultsError(422, 'too-many-ids', 'Request at most 100 experiments')
  if (ids.length === 0) return resultsError(422, 'invalid-ids', 'Experiment ids must be nonempty')
  const requested = ids.flatMap(key => {
    const id = experimentId(req, key)
    return id === undefined ? [] : [{ key, id }]
  })
  const uniqueIds = [...new Set(requested.map(({ id }) => id))]
  const snapshots = uniqueIds.length ? await readSnapshots(req, uniqueIds, { per: 'experiment' }) : []
  const response: SummaryResponse = Object.create(null)
  for (const { key, id } of requested) {
    const snapshot = snapshots.find(row => String(typeof row.experiment === 'object' ? row.experiment.id : row.experiment) === String(id))?.snapshot
    response[key] = snapshot ? { exposures: snapshot.exposures.total,
      days: Math.max(0, (Date.parse(snapshot.window.to) - Date.parse(snapshot.window.from)) / 86_400_000),
      verdict: { code: snapshot.verdict.code, headline: snapshot.verdict.headline },
      ...(snapshot.health ? { health: snapshot.health.slice(0, 100).map(({ code, path }) => ({ code, path: path.slice(0, 128) })) } : {}) } : { exposures: 0, days: 0, verdict: null }
  }
  try {
    if (uniqueIds.length && await options.access.manage({ req }) === true) {
      const found = await req.payload.find({ collection: 'xp-experiments', req, overrideAccess: false, depth: 0, pagination: false, limit: uniqueIds.length, where: { id: { in: uniqueIds } } })
      const drafts = (found.docs as unknown as StartExperiment[]).filter(e => e.status === 'draft' || e.status === 'stopped')
      const inputs = await loadStartInputsBatch(req, options, drafts, true)
      for (const { key, id } of requested) {
        // Payload normalises numeric ids (for example 01 to 1); preserve the requested response key.
        const experiment = drafts.find(e => String(e.id) === String(id))
        if (!experiment) continue
        const input = inputs.get(String(experiment.id))
        try {
          const checks = input ? checkStart(input) : []
          response[key]!.ready = !!input && checks.every(check => check.ok)
          const next = checks.find(check => !check.ok && !check.warning)
          if (next) {
            const detail = sanitizeReadinessDetail(next.code, next.detail)
            response[key]!.next = { code: next.code, ...(detail === undefined ? {} : { detail }) }
          }
        }
        catch { response[key]!.ready = false }
      }
    }
  } catch { /* Readiness is optional; setup failures must not hide the verdicts. */ }
  return Response.json(response, { headers: { 'Cache-Control': 'no-store' } })
}
