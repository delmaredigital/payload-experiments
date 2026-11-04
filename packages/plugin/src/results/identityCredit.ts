import type { ExposedUnit, MetricEvent, Timestamp } from './aggregate.js'
import { timestampMs } from './aggregate.js'

export interface IdentityLink {
  anonymousId: string
  userId: string
  verifiedAt: Timestamp | null
  /** Earliest verification across all the user's browsers, exposed or not. */
  ownedAt: Timestamp | null
}

/** Unverified links credit only events before anyone proves account ownership.
 * Never-verified accounts keep crediting without a time limit.
 */
export function eligibleIdentityLinks<T extends IdentityLink>(links: readonly T[], ts: Timestamp): T[] {
  const t = timestampMs(ts)
  return links.filter(link => link.verifiedAt !== null || link.ownedAt === null || t < timestampMs(link.ownedAt))
}

/** Credit each event to the earliest exposed eligible visitor, with a stable ID
 * tie-break. A user counts once if eligible links span arms for a credited event.
 * Callers must normalize user IDs with String().
 */
export function creditUserEvents(
  units: ReadonlyMap<string, ExposedUnit>,
  identities: readonly IdentityLink[],
  userEvents: readonly { userId: string; value: number; ts: Timestamp }[],
  onConflict?: (userId: string) => void,
): { events: MetricEvent[]; conflicts: number } {
  const starts = new Map([...units].map(([id, unit]) => [id, timestampMs(unit.firstTs)]))
  const users = new Map<string, IdentityLink[]>()
  for (const link of identities) {
    if (!units.has(link.anonymousId)) continue
    const links = users.get(link.userId) ?? []
    links.push(link)
    users.set(link.userId, links)
  }
  for (const links of users.values()) links.sort((a, b) => starts.get(a.anonymousId)! - starts.get(b.anonymousId)! || (a.anonymousId < b.anonymousId ? -1 : a.anonymousId > b.anonymousId ? 1 : 0))
  const conflicts = new Set<string>()
  const events: MetricEvent[] = []
  for (const event of userEvents) {
    const eligible = eligibleIdentityLinks(users.get(event.userId) ?? [], event.ts)
    if (!eligible.length) continue
    events.push({ unitId: eligible[0]!.anonymousId, value: event.value, ts: event.ts })
    if (new Set(eligible.map(link => units.get(link.anonymousId)!.arm)).size > 1) {
      conflicts.add(event.userId)
      onConflict?.(event.userId)
    }
  }
  return { events, conflicts: conflicts.size }
}
