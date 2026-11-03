import { safeError } from '../log.js'
import type { CollectionAfterChangeHook, CollectionBeforeChangeHook } from 'payload'

/** Host saves must survive synchronous and asynchronous plugin hook failures. */
export function neverThrow(name: string, hook: CollectionAfterChangeHook): CollectionAfterChangeHook {
  return async args => {
    try {
      return await hook(args)
    } catch (error) {
      console.error(`[payload-experiments] ${name} failed; the document was saved without it`, safeError(error))
      return args.doc
    }
  }
}

/** The baseline capture is also best effort and must return incoming save data. */
export function neverThrowBefore(name: string, hook: CollectionBeforeChangeHook): CollectionBeforeChangeHook {
  return async args => {
    try { return await hook(args) }
    catch (error) {
      console.error(`[payload-experiments] ${name} failed; the document was saved without it`, safeError(error))
      return args.data
    }
  }
}
