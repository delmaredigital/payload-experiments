import type { CollectionBeforeDeleteHook } from 'payload'
import { XpNotImplemented } from '../../errors.js'

export const deleteGuard: CollectionBeforeDeleteHook = (_args) => {
  throw new XpNotImplemented('CORE-11')
}
