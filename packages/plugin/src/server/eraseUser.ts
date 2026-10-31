import type { Payload } from 'payload'
import { eraseUserInTransaction } from '../db/erase.js'

export async function eraseUser(payload: Payload, opts: { userId: string }): Promise<{ identities: number; events: number }> {
  return eraseUserInTransaction(payload, String(opts.userId))
}
