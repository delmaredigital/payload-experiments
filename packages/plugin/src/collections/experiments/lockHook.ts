import type { CollectionBeforeChangeHook } from 'payload'
import { XpNotImplemented } from '../../errors.js'

export const lockHook: CollectionBeforeChangeHook = (_args) => {
  throw new XpNotImplemented('CORE-03')
}
