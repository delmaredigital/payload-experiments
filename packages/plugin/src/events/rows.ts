import { validClickSource, isClickSource } from '../goals/key.js'
import { exposureDimensions } from './dimensions.js'
import type { EventRow } from '../db/events.js'
import type { AssignmentResult } from '../runtime/assign.js'
import type { ResolvedOptions } from '../types/contracts.js'
import type { Manifest } from '../types/manifest.js'

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Only declared primitive attributes can enter telemetry; never accept arbitrary browser objects. */
function attributes(value: unknown, keys: ResolvedOptions['attributeKeys']): Record<string, unknown> | undefined {
  if (!record(value)) return undefined
  return Object.fromEntries(Object.entries(value).filter(([key, item]) => {
    const definition = keys && Object.hasOwn(keys, key) ? keys[key] : undefined
    return definition && typeof item === definition.type && (typeof item !== 'number' || Number.isFinite(item))
      && (!definition.values || (typeof item === 'string' && definition.values.includes(item)))
  }))
}

export function eventRows<TUser extends { id: string | number }>(events: unknown[], manifest: Manifest, assignments: AssignmentResult,
  options: ResolvedOptions<TUser>, visitorId: string, userId: string | undefined, ts: string, requestAttributes: Readonly<Record<string, unknown>> = {}, clickKeys?: ReadonlySet<string>): EventRow[] {
  const rows = new Map<string, EventRow>()
  for (const event of events) {
    if (!record(event)) continue
    let row: EventRow
    if (event.type === 'exposure') {
      if (typeof event.experiment !== 'string' || typeof event.arm !== 'string'
        || !['manual', 'viewport', 'pageview'].includes(String(event.policy))) continue
      const experiment = manifest.experiments.find(exp => exp.slug === event.experiment)
      const assigned = assignments.bySlug[event.experiment]
      if (!experiment || !assigned?.exposable || event.phase !== experiment.phase || event.policy !== experiment.exposurePolicy) continue
      const unitId = experiment.unitType === 'visitor' ? visitorId : userId
      if (!unitId) continue
      const mismatch = event.arm !== assigned.arm
      row = { type: mismatch ? 'arm-mismatch' : 'exposure', experimentId: experiment.id, phase: experiment.phase,
        arm: event.arm, unitId, unitType: experiment.unitType, userId, ts,
        dimensions: mismatch ? null : exposureDimensions(requestAttributes, options.events?.dimensions),
        // §5.5 / §11: diagnostics are separate rows, never exposure denominators or multi-arm counts.
        dedupeKey: mismatch ? `mismatch:${experiment.id}:${experiment.phase}:${unitId}:${ts.slice(0, 10)}`
          : `exposure:${experiment.id}:${experiment.phase}:${event.arm}:${unitId}:${ts.slice(0, 10)}` }
    } else if (event.type === 'conversion') {
      if (typeof event.eventName !== 'string' || typeof event.idempotencyKey !== 'string' || !event.idempotencyKey.trim()
        || (event.value !== undefined && (typeof event.value !== 'number' || !Number.isFinite(event.value)))) continue
      const source = options.metricSources?.find(source => source.id === event.eventName)
      const click = isClickSource(event.eventName)
      if (click ? !validClickSource(event.eventName) || !clickKeys?.has(event.eventName.slice(6)) : source ? source.clientWritable !== true || source.kind === 'revenue' : !options.eventSources?.some(source => source.name === event.eventName && source.clientWritable)) continue
      row = { type: 'conversion', eventName: event.eventName, value: 1, unitId: visitorId, unitType: 'visitor', userId, ts,
        dimensions: null, attributes: click ? undefined : attributes(event.attributes, options.attributeKeys),
        // §5.5: scoped by unit and event so one client can never pre-claim another's key.
        dedupeKey: `conversion:c:${visitorId}:${event.eventName}:${event.idempotencyKey}` }
    } else continue
    rows.set(row.dedupeKey, row)
  }
  return [...rows.values()]
}
