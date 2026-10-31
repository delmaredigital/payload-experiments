import type { ExposedUnit, MetricEvent } from './aggregate.js'

/** Spec §8.3: credit once to the earliest exposed linked visitor; conflicts are diagnostic only. */
export function creditUserEvents(
  units: ReadonlyMap<string, ExposedUnit>,
  identities: readonly { anonymousId: string; userId: string }[],
  userEvents: readonly { userId: string; value: number; ts: Date }[],
): { events: MetricEvent[]; conflicts: number } {
  const users = new Map<string, { unitId: string; firstTs: number; arms: Set<string> }>()
  for (const { anonymousId, userId } of identities) {
    const unit = units.get(anonymousId)
    if (!unit) continue
    const firstTs = unit.firstTs.getTime()
    const user = users.get(userId)
    if (!user) users.set(userId, { unitId: anonymousId, firstTs, arms: new Set([unit.arm]) })
    else {
      user.arms.add(unit.arm)
      // Stable tie-break for simultaneous exposures, independent of identity row order.
      if (firstTs < user.firstTs || (firstTs === user.firstTs && anonymousId < user.unitId)) {
        user.unitId = anonymousId
        user.firstTs = firstTs
      }
    }
  }
  let conflicts = 0
  for (const user of users.values()) if (user.arms.size > 1) conflicts++
  const events: MetricEvent[] = []
  for (const event of userEvents) {
    const user = users.get(event.userId)
    if (user) events.push({ unitId: user.unitId, value: event.value, ts: event.ts })
  }
  return { events, conflicts }
}
