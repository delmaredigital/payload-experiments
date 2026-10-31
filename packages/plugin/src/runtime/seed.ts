import { randomBytes } from 'node:crypto'

/** All assignment seeds include the stats engine's required separator. */
export function newSeed(): string {
  return `${randomBytes(16).toString('hex')}|`
}
