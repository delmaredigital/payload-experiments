import type { Payload } from 'payload'
import { XpNotImplemented } from '../errors.js'

export async function eraseUser(_payload: Payload, _opts: { userId: string }): Promise<{ identities: number; events: number }> {
  throw new XpNotImplemented('CORE-08a')
}
