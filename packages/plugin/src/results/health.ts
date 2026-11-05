import type { Snapshot, SnapshotHealth } from '../types/snapshot.js'

const healthKey = (row: SnapshotHealth): string => JSON.stringify(row.code === 'placement-unchecked'
  ? [row.code, row.detail.collection ?? '', row.detail.id ?? '', row.detail.path ?? '']
  : [row.code, 'path' in row ? row.path : '', 'metricId' in row ? row.metricId : ''])

/** Refresh page health while retaining health produced by other checks. */
export function mergePageHealth(previous: readonly SnapshotHealth[], pages: readonly SnapshotHealth[]): SnapshotHealth[] {
  return [...new Map([...previous.filter(row => row.code === 'goal-in-some-versions' || row.code === 'placement-unchecked'), ...pages].map(row => [healthKey(row), row])).values()]
}
export function canonicalHealth(snapshot: Pick<Snapshot, 'health' | 'goalFairnessNotice'>, ignoreUncheckedPlacements = false): string {
  return JSON.stringify([snapshot.goalFairnessNotice ?? '', ...(snapshot.health ?? [])
    .filter(row => !ignoreUncheckedPlacements || row.code !== 'placement-unchecked').map(healthKey).sort()])
}
