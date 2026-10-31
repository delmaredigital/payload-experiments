import type { Snapshot } from '../types/snapshot.js'
import { XpNotImplemented } from '../errors.js'

export function decideGuard(_snapshot: Snapshot | null, _chosenArm: string): boolean {
  throw new XpNotImplemented('CORE-13')
}
