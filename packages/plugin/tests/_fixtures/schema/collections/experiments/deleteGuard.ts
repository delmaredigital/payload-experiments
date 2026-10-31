// Schema-only copy of CORE-02a ba8d1c703430d8908f13a3669a31f8e3bfb8a9b5; only external import paths adjusted.
import type { CollectionAfterDeleteHook, CollectionBeforeDeleteHook } from 'payload'
import { XpNotImplemented } from '../../../../../src/errors.js'

export const deleteGuard: CollectionBeforeDeleteHook = (_args) => {
  throw new XpNotImplemented('CORE-11')
}

export const deleteGuardAfter: CollectionAfterDeleteHook = (_args) => {
  throw new XpNotImplemented('CORE-11')
}
