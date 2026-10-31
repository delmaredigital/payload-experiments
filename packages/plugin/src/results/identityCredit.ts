import type { ExposedUnit, MetricEvent, Timestamp } from './aggregate.js'
import { timestampMs } from './aggregate.js'

/**
 * Spec §8.3: credit once to the earliest exposed linked visitor; conflicts are diagnostic only.
 * Callers must pass user ids through String() for both identities and user-keyed source events.
 */
export function creditUserEvents(
  units: ReadonlyMap<string, ExposedUnit>,
  identities: readonly { anonymousId: string; userId: string }[],
  userEvents: readonly { userId: string; value: number; ts: Timestamp }[],
): { events: MetricEvent[]; conflicts: number } {
  const users = new Map<string, { unitId: string; firstTs: number; arms: Set<string> }>()
  const starts = new Map<string, number>()
  for (const [unitId, unit] of units) starts.set(unitId, timestampMs(unit.firstTs))
  for (const { anonymousId, userId } of identities) {
    const unit = units.get(anonymousId)
    if (!unit) continue
    const firstTs = starts.get(anonymousId)!
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
    timestampMs(event.ts)
    const user = users.get(event.userId)
    if (user) events.push({ unitId: user.unitId, value: event.value, ts: event.ts })
  }
  return { events, conflicts }
}
