import type { CollectionAfterChangeHook } from 'payload'
import { recordContentChange } from '../server/recordContentChange.js'
import { neverThrow } from './hostHook.js'

export const contentChangesHook: CollectionAfterChangeHook = neverThrow('contentChanges', async args => {
  await recordContentChange(args)
  return args.doc
})
