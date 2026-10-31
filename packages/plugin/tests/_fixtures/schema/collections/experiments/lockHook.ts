// Schema-only copy of CORE-02a ba8d1c703430d8908f13a3669a31f8e3bfb8a9b5; only external import paths adjusted.
import type { CollectionBeforeChangeHook } from 'payload'
import { XpNotImplemented } from '../../../../../src/errors.js'

export const lockHook: CollectionBeforeChangeHook = (_args) => {
  throw new XpNotImplemented('CORE-03')
}
