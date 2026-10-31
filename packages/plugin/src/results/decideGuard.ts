import type { Snapshot } from '../types/snapshot.js'

/** A true result means required: true: typed confirmation and a note are both required (plan §2.7). */
export function decideGuard(snapshot: Snapshot | null, chosenArm: string): boolean {
  return snapshot === null || snapshot.verdict.recommendedArm === null
    || chosenArm !== snapshot.verdict.recommendedArm
    || [1, 2, 3, 4].some(row => row === snapshot.verdict.row)
}
