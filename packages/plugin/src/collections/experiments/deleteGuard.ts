import type { CollectionBeforeOperationHook, CollectionAfterDeleteHook, CollectionBeforeDeleteHook } from 'payload'
import { deleteExperiment, deleteExperimentAfter, prepareBulkDelete } from '../../transitions/deleteExperiment.js'
import { xpOptionsFromReq } from '../../options/fromReq.js'

export const deleteGuard: CollectionBeforeDeleteHook = async ({ req, id }) => {
  await deleteExperiment(req, id)
}

export const deleteGuardAfter: CollectionAfterDeleteHook = async ({ req, id, doc }) => {
  await deleteExperimentAfter(req, id)
  return doc
}

export const deleteGuardBeforeOperation: CollectionBeforeOperationHook = async ({ operation, args, req }) => {
  if (operation === 'delete' && 'where' in args && args.where) {
    // Payload runs beforeOperation before access; only a manager, or an explicit overrideAccess call, may make the plugin discover and lock the delete scope.
    if (args.overrideAccess !== true && await xpOptionsFromReq(req).access.manage({ req }) !== true) return args
    await prepareBulkDelete(req, args.where)
  }
  return args
}
