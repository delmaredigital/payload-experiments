import type { CollectionBeforeChangeHook, CollectionBeforeDeleteHook, PayloadRequest } from 'payload'
import { pooledExecutor, txExecutor } from '../db/executor.js'
import { findMetricUsage, lockMetricRow } from '../db/metricUsage.js'

/** Payload's REST formatter preserves public plugin errors and their 4xx status. */
export class XpGoalInUseError extends Error {
  override name = 'XpGoalInUseError'
  readonly status = 400
  readonly isPublic = true
}

async function executor(req: PayloadRequest, id: string | number, mode: 'delete' | 'change') {
  const transactionID = await req.transactionID
  if (transactionID != null) {
    const exec = txExecutor(req)
    await lockMetricRow(exec, id, mode)
    return exec
  }
  // With no transaction a pooled row lock would expire before the usage read;
  // retain the existing best-effort usage check without taking a lock.
  return pooledExecutor(req.payload)
}

export const metricDeleteGuard: CollectionBeforeDeleteHook = async ({ req, id }) => {
  const usage = await findMetricUsage(await executor(req, id, 'delete'), id)
  if (usage) throw new XpGoalInUseError(`This goal is used by the test "${usage.name}". Remove it from the test first.`)
}

export const metricChangeGuard: CollectionBeforeChangeHook = async ({ req, data, originalDoc, operation }) => {
  if (operation !== 'update') return data
  const changed = ['slug', 'source'].some(field => field in data && data[field] !== originalDoc[field])
  if (changed && await findMetricUsage(await executor(req, originalDoc.id, 'change'), originalDoc.id)) {
    throw new XpGoalInUseError("This goal is used by a test, so its short name and what it measures can't change. Create a new goal instead.")
  }
  return data
}
