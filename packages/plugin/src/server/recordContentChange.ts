import type { CollectionAfterChangeHook } from 'payload'
import { XpNotImplemented } from '../errors.js'

export async function recordContentChange(_args: Pick<Parameters<CollectionAfterChangeHook>[0], 'doc' | 'previousDoc' | 'req' | 'collection'>): Promise<void> {
  throw new XpNotImplemented('CORE-12')
}
