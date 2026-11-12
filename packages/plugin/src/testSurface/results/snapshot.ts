import type { Snapshot } from '../../types/snapshot.js'

type Core15aFields = Pick<Snapshot, 'winnerArm' | 'minExposuresPerArm'>

/** Immutable history written before CORE-15a, with at least one added field absent. */
export type LegacySnapshot = Omit<Snapshot, keyof Core15aFields> & (
  | { winnerArm?: undefined; minExposuresPerArm?: number }
  | { winnerArm?: string | null; minExposuresPerArm?: undefined }
)

export type DisplaySnapshot = Snapshot | LegacySnapshot

/** A stored null winner is current data; only missing CORE-15a fields mark history. */
export function isLegacySnapshot(snapshot: DisplaySnapshot): snapshot is LegacySnapshot {
  return snapshot.winnerArm === undefined || snapshot.minExposuresPerArm === undefined
}
