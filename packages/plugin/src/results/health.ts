import type { Snapshot, SnapshotHealth } from '../types/snapshot.js'

/** Refresh page health while retaining health produced by other checks. */
export function mergePageHealth(previous: readonly SnapshotHealth[], pages: readonly SnapshotHealth[]): SnapshotHealth[] {
  return [...previous.filter(row => row.code === 'goal-in-some-versions'), ...pages]
}
export function canonicalHealth(snapshot: Pick<Snapshot, 'health'>): string {
  return JSON.stringify((snapshot.health ?? []).map(row => JSON.stringify([row.code, 'path' in row ? row.path : '', 'metricId' in row ? row.metricId : ''])).sort())
}
