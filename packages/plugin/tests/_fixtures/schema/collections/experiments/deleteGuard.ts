// Schema-only copy from main d292db4e74d036d15d012ce1b5892dc4ad1f5ba6; only external import paths adjusted.
import type { CollectionAfterDeleteHook, CollectionBeforeDeleteHook } from 'payload'
import { XpNotImplemented } from '../../../../../src/errors.js'

export const deleteGuard: CollectionBeforeDeleteHook = (_args) => {
  throw new XpNotImplemented('CORE-11')
}

export const deleteGuardAfter: CollectionAfterDeleteHook = (_args) => {
  throw new XpNotImplemented('CORE-11')
}
