import type { PayloadRequest } from 'payload'
import { readState } from '../db/state.js'
import { XpRefusal } from '../errors.js'
import type { DocId, ResolvedOptions } from '../types/contracts.js'
import type { AddMetricBody } from '../types/endpoints.js'
import { relationshipId } from './checkStart.js'
import { withTransition } from './kernel.js'
import { readExperiment, refuse, updateExperiment } from './start.js'
import { resolveCaps, type MetricDefinition } from './resolveCaps.js'

export async function addMetric<TUser extends { id: DocId }>(req: PayloadRequest, { experimentId, metric, role, options }: AddMetricBody & { experimentId: DocId; options: ResolvedOptions<TUser> }) {
  if (role !== 'secondary' && role !== 'guardrail') refuse('invalid-body')
  const before = await readExperiment(req, experimentId)
  if (before.status !== 'running') refuse('invalid-status')
  const found = await req.payload.find({ collection: 'xp-metrics', req, overrideAccess: false, depth: 0, limit: 1, where: { id: { equals: metric } } })
  if (!found.docs[0]) throw new XpRefusal('not-found', 'Metric not found', undefined, 404)
  const metricId = found.docs[0].id as DocId
  const at = new Date()
  // §5.4: cap history ends at the phase start, never inside the running phase.
  const started = (before as unknown as { startedAt?: unknown }).startedAt
  const startedAt = typeof started === 'string' ? new Date(started) : at
  const caps = await resolveCaps([found.docs[0] as unknown as MetricDefinition], options.metricSources ?? [], startedAt)
  // Metrics are analysis-only; the assignment manifest is unchanged, so no bump.
  const { result } = await withTransition(req, { experimentId, bump: false }, async ({ req, exec }) => {
    const current = await readExperiment(req, experimentId)
    if (current.status !== 'running') refuse('invalid-status')
    const ids = [current.metrics?.primary, ...current.metrics?.secondary ?? [], ...current.metrics?.guardrails ?? []].map(relationshipId)
    if (ids.some(id => id !== undefined && String(id) === String(metric))) refuse('invalid-body', { message: 'This metric is already part of the experiment.' })
    const definition = caps.definitions[0]!
    if (current.unitType === 'user' && definition.keyedBy === 'visitor' && !definition.source.startsWith('events:')) refuse('unit-source-mismatch')
    // §7.8: phase lookup serves the access-authorised transition write.
    const phases = await req.payload.find({ collection: 'xp-phases', req, overrideAccess: true, depth: 0, limit: 1,
      where: { and: [{ experiment: { equals: experimentId } }, { phase: { equals: current.phase } }] } })
    const phase = phases.docs[0]
    if (!phase) throw new XpRefusal('not-found', 'The phase record was not found.', undefined, 404)
    // §7.8: append one frozen metric definition under the experiment lock.
    const analysis = phase.analysis as Record<string, unknown> | undefined
    await req.payload.update({ collection: 'xp-phases', req, overrideAccess: true, id: phase.id, data: {
      analysis: { ...analysis, minSampleSizes: { ...analysis?.minSampleSizes as Record<string, number>, [metricId]: definition.minSampleSize ?? 150 },
        ...(role === 'guardrail' ? { guardrailThresholds: { ...analysis?.guardrailThresholds as Record<string, number>, [metricId]: definition.guardrailThreshold ?? 0.05 } } : {}),
      },
      metricDefinitions: [...(phase.metricDefinitions as Array<Record<string, unknown>> ?? []), { ...definition, metricId, role, addedAt: at.toISOString() }],
    } })
    const field = role === 'guardrail' ? 'guardrails' : 'secondary'
    const doc = await updateExperiment(req, experimentId, { metrics: { ...current.metrics, [field]: [...current.metrics?.[field] ?? [], metricId] } })
    return { doc, revision: (await readState(exec))?.revision ?? 0 }
  })
  return { ...result, ...(caps.detail.length ? { detail: caps.detail } : {}) }
}
