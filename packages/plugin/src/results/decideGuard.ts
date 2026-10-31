import type { Snapshot } from '../types/snapshot.js'
import { XpNotImplemented } from '../errors.js'

/** A true result means required: true: typed confirmation and a note are both required (plan §2.7). */
export function decideGuard(_snapshot: Snapshot | null, _chosenArm: string): boolean {
  throw new XpNotImplemented('CORE-13')
}
