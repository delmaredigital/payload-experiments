import type { Payload } from 'payload'
import type { DocId } from '../types/contracts.js'
import { XpNotImplemented } from '../errors.js'

export async function runResults(_payload: Payload, _opts: { budgetMs?: number; experimentId?: DocId } = {}): Promise<{ ran: number; skipped: number; swept: number }> {
  throw new XpNotImplemented('CORE-15b')
}
