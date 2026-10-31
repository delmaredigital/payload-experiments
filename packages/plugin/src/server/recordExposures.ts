import type { Payload } from 'payload'
import type { ExperimentsServerRuntime } from '../types/runtime.js'
import type { Assignments, RenderedExposure } from '../types/assignments.js'
import { pooledExecutor } from '../db/executor.js'
import { insertEvents, type EventRow } from '../db/events.js'
import { exposureDimensions } from '../events/dimensions.js'
import { requestAttributesOf } from './context.js'
import type { ExperimentsPluginOptions } from '../types/contracts.js'
import { readManifestRow } from '../db/manifest.js'

export async function recordExposures<TUser extends { id: string | number } = { id: string | number }>(serverRuntime: ExperimentsServerRuntime<TUser>, rendered: RenderedExposure[], ctx: Assignments): Promise<void> {
  let payload: Payload | undefined
  try {
    if (ctx.bot || ctx.staff || ctx.preview || ctx.method === 'HEAD') return
    const candidates = rendered.flatMap(entry => {
      const assignment = ctx.bySlug[entry.slug]
      return assignment?.exposable && (assignment.policy === 'render' || assignment.policy === 'manual') && assignment.arm === entry.arm && assignment.phase === entry.phase ? [{ ...assignment }] : []
    })
    if (!candidates.length) return
    const { visitorId, userId } = ctx
    const ts = new Date().toISOString()
    payload = await serverRuntime.getPayload()
    const options = payload.config?.custom?.xp as ExperimentsPluginOptions<TUser> | undefined
    const dimensions = exposureDimensions(requestAttributesOf(ctx), options?.events?.dimensions)
    const exec = pooledExecutor(payload)
    // Assignments intentionally omit unitType; the immutable manifest field selects the unit.
    const manifest = await readManifestRow(exec)
    const rows: EventRow[] = candidates.flatMap(assignment => {
      const experiment = manifest?.manifest.experiments.find(exp => exp.id === assignment.experimentId && exp.slug === assignment.slug)
      if (!experiment) return []
      const unitId = experiment.unitType === 'visitor' ? visitorId : userId
      if (!unitId) return []
      return [{ type: 'exposure', experimentId: assignment.experimentId, phase: assignment.phase, arm: assignment.arm,
        unitType: experiment.unitType, unitId, userId, ts, dimensions,
        dedupeKey: `exposure:${assignment.experimentId}:${assignment.phase}:${assignment.arm}:${unitId}:${ts.slice(0, 10)}` }]
    })
    await insertEvents(exec, rows, message => payload!.logger.error(message))
  } catch (error) {
    try { payload?.logger.error({ err: error, msg: 'Experiments: recordExposures failed' }) } catch { /* Logging must not break a page. */ }
  }
}
