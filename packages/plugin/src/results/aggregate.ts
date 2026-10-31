export interface ExposedUnit { arm: string; firstTs: Date }
export interface MetricEvent { unitId: string; value: number; ts: Date }

/** Spec §7.6/§8.2: first exposure in a phase, excluding units seen in multiple arms. */
export function firstExposures(
  rows: readonly { unitId: string; arm: string; ts: Date }[],
  { endedAt }: { endedAt?: Date } = {},
): { units: Map<string, ExposedUnit>; excludedMultiArm: number } {
  const units = new Map<string, ExposedUnit>()
  const excluded = new Set<string>()
  const end = endedAt?.getTime() ?? Infinity
  for (const row of rows) {
    if (row.ts.getTime() >= end || excluded.has(row.unitId)) continue
    const unit = units.get(row.unitId)
    if (!unit) units.set(row.unitId, { arm: row.arm, firstTs: row.ts })
    else if (unit.arm !== row.arm) {
      units.delete(row.unitId)
      excluded.add(row.unitId)
    } else if (row.ts.getTime() < unit.firstTs.getTime()) {
      units.set(row.unitId, { arm: row.arm, firstTs: row.ts })
    }
  }
  return { units, excludedMultiArm: excluded.size }
}

/** Spec §7.6/§8.2: zero-filled outcomes over each exposed unit's half-open window. */
export function perUnitValues(
  units: ReadonlyMap<string, ExposedUnit>,
  events: readonly MetricEvent[],
  { kind, windowHours, endedAt }: {
    kind: 'binomial' | 'count' | 'revenue'; windowHours: number; endedAt?: Date
  },
): Map<string, number> {
  const values = new Map<string, number>()
  for (const unitId of units.keys()) values.set(unitId, 0)
  const duration = windowHours * 60 * 60 * 1000
  const phaseEnd = endedAt?.getTime() ?? Infinity
  for (const event of events) {
    const unit = units.get(event.unitId)
    if (!unit) continue
    const start = unit.firstTs.getTime()
    const ts = event.ts.getTime()
    if (ts < start || ts >= Math.min(start + duration, phaseEnd)) continue
    values.set(event.unitId, kind === 'binomial' ? 1
      : values.get(event.unitId)! + (kind === 'count' ? 1 : event.value))
  }
  return values
}
