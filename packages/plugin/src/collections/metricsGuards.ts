import type { CollectionBeforeChangeHook, CollectionBeforeDeleteHook, PayloadRequest } from 'payload'
import { pooledExecutor, txExecutor } from '../db/executor.js'
import { findMetricUsage } from '../db/metricUsage.js'

/** Payload's REST formatter preserves public plugin errors and their 4xx status. */
export class XpGoalInUseError extends Error {
  override name = 'XpGoalInUseError'
  readonly status = 400
  readonly isPublic = true
}

async function executor(req: PayloadRequest) {
  return await req.transactionID != null ? txExecutor(req) : pooledExecutor(req.payload)
}

export const metricDeleteGuard: CollectionBeforeDeleteHook = async ({ req, id }) => {
  const usage = await findMetricUsage(await executor(req), id)
  if (usage) throw new XpGoalInUseError(`This goal is used by the test "${usage.name}". Remove it from the test first.`)
}

export const metricChangeGuard: CollectionBeforeChangeHook = async ({ req, data, originalDoc, operation }) => {
  if (operation !== 'update') return data
  const changed = ['slug', 'source'].some(field => field in data && data[field] !== originalDoc[field])
  if (changed && await findMetricUsage(await executor(req), originalDoc.id)) {
    throw new XpGoalInUseError("This goal is used by a test, so its short name and what it measures can't change. Create a new goal instead.")
  }
  return data
}
