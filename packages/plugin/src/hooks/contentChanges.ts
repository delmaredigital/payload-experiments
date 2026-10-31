import type { CollectionAfterChangeHook } from 'payload'
import { XpNotImplemented } from '../errors.js'

export const contentChangesHook: CollectionAfterChangeHook = (_args) => {
  throw new XpNotImplemented('CORE-12')
}
