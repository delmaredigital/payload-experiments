import { XpAnalysisError } from '../errors.js'

export type Timestamp = Date | string | number
export interface ExposedUnit { arm: string; firstTs: Timestamp }
export interface MetricEvent { unitId: string; value: number; ts: Timestamp }

/** Accept Date, timestamp text, or epoch milliseconds; reject invalid dates. */
export function timestampMs(ts: Timestamp): number {
  if (!(ts instanceof Date) && typeof ts !== 'string' && typeof ts !== 'number') {
    throw new XpAnalysisError('invalid-timestamp')
  }
  const ms = ts instanceof Date ? ts.getTime() : new Date(ts).getTime()
  if (!Number.isFinite(ms)) throw new XpAnalysisError('invalid-timestamp')
  return ms
}

/** Attribution windows must have a finite, positive length in hours. */
export function windowMs(windowHours: number): number {
  if (!Number.isFinite(windowHours) || windowHours <= 0) {
    throw new XpAnalysisError('window-hours')
  }
  return windowHours * 3_600_000
}

/** Spec §7.6/§8.2: first exposure in a phase, excluding units seen in multiple arms. */
export function firstExposures(
  rows: readonly { unitId: string; arm: string; ts: Timestamp }[],
  { endedAt }: { endedAt?: Timestamp } = {},
): { units: Map<string, { arm: string; firstTs: Date }>; excludedMultiArm: number } {
  const first = new Map<string, { arm: string; firstTs: number }>()
  const excluded = new Set<string>()
  const end = endedAt === undefined ? Infinity : timestampMs(endedAt)
  for (const row of rows) {
    const ts = timestampMs(row.ts)
    if (ts >= end || excluded.has(row.unitId)) continue
    const unit = first.get(row.unitId)
    if (!unit) first.set(row.unitId, { arm: row.arm, firstTs: ts })
    else if (unit.arm !== row.arm) {
      first.delete(row.unitId)
      excluded.add(row.unitId)
    } else if (ts < unit.firstTs) {
      first.set(row.unitId, { arm: row.arm, firstTs: ts })
    }
  }
  const units = new Map<string, { arm: string; firstTs: Date }>()
  for (const [unitId, unit] of first) {
    units.set(unitId, { arm: unit.arm, firstTs: new Date(unit.firstTs) })
  }
  return { units, excludedMultiArm: excluded.size }
}

/** Spec §7.6/§8.2: zero-filled outcomes over each exposed unit's half-open window. */
export function perUnitValues(
  units: ReadonlyMap<string, ExposedUnit>,
  events: readonly MetricEvent[],
  { kind, windowHours, endedAt }: {
    kind: 'binomial' | 'count' | 'revenue'; windowHours: number; endedAt?: Timestamp
  },
): Map<string, number> {
  const values = new Map<string, number>()
  const starts = new Map<string, number>()
  const duration = windowMs(windowHours)
  const phaseEnd = endedAt === undefined ? Infinity : timestampMs(endedAt)
  for (const [unitId, unit] of units) {
    starts.set(unitId, timestampMs(unit.firstTs))
    values.set(unitId, 0)
  }
  for (const event of events) {
    const ts = timestampMs(event.ts)
    const start = starts.get(event.unitId)
    if (start === undefined) continue
    if (ts < start || ts >= Math.min(start + duration, phaseEnd)) continue
    values.set(event.unitId, kind === 'binomial' ? 1
      : values.get(event.unitId)! + (kind === 'count' ? 1 : event.value))
  }
  return values
}
