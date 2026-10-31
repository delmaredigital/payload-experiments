import type { CollectionAfterDeleteHook, CollectionBeforeDeleteHook } from 'payload'
import { deleteExperiment, deleteExperimentAfter } from '../../transitions/deleteExperiment.js'

export const deleteGuard: CollectionBeforeDeleteHook = async ({ req, id }) => {
  await deleteExperiment(req, id)
}

export const deleteGuardAfter: CollectionAfterDeleteHook = async ({ req, id, doc }) => {
  await deleteExperimentAfter(req, id)
  return doc
}
