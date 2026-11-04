import type { CollectionBeforeOperationHook, CollectionAfterDeleteHook, CollectionBeforeDeleteHook } from 'payload'
import { deleteExperiment, deleteExperimentAfter, prepareBulkDelete } from '../../transitions/deleteExperiment.js'

export const deleteGuard: CollectionBeforeDeleteHook = async ({ req, id }) => {
  await deleteExperiment(req, id)
}

export const deleteGuardAfter: CollectionAfterDeleteHook = async ({ req, id, doc }) => {
  await deleteExperimentAfter(req, id)
  return doc
}

export const deleteGuardBeforeOperation: CollectionBeforeOperationHook = async ({ operation, args, req }) => {
  if (operation === 'delete' && 'where' in args && args.where) await prepareBulkDelete(req, args.where)
  return args
}
