import type { CollectionAfterChangeHook, CollectionBeforeChangeHook } from 'payload'
import { capturePublishedContent, recordContentChange } from '../server/recordContentChange.js'
import { neverThrow, neverThrowBefore } from './hostHook.js'

export const contentChangesHook: CollectionAfterChangeHook = neverThrow('contentChanges', async args => {
  await recordContentChange(args)
  return args.doc
})

export const contentChangesBeforeHook: CollectionBeforeChangeHook = neverThrowBefore('contentChanges baseline', async args => {
  await capturePublishedContent(args)
  return args.data
})
