import type { CollectionBeforeChangeHook } from 'payload'
import { pickSlug } from '../../db/slugs.js'
import { pooledExecutor, txExecutor } from '../../db/executor.js'

export const pickExperimentSlug: CollectionBeforeChangeHook = async ({ req, data, operation }) => {
  if (operation !== 'create' || typeof data.slug !== 'string' || !data.slug) return data
  const transactional = await req.transactionID != null
  data.slug = await pickSlug(transactional ? txExecutor(req) : pooledExecutor(req.payload), data.slug, transactional)
  return data
}
