import type { CollectionAfterChangeHook } from 'payload'

/** Host saves must survive synchronous and asynchronous plugin hook failures. */
export function neverThrow(name: string, hook: CollectionAfterChangeHook): CollectionAfterChangeHook {
  return async args => {
    try {
      return await hook(args)
    } catch (error) {
      console.error(`[payload-experiments] ${name} failed; the document was saved without it`, error)
      return args.doc
    }
  }
}
