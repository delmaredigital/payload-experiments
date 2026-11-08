import type { PayloadRequest } from 'payload'
import { definedClickKeys } from '../db/clickGoals.js'
import { pooledExecutor } from '../db/executor.js'
import type { ResolvedOptions } from '../types/contracts.js'
import { clickKeys } from './cache.js'
import { CLICK_KEY } from './key.js'
import { CLICK_GOAL_COPY } from './picker/copy.js'

/** Shared publish validation for Payload fields and Puck JSON props. */
export async function validateClickGoal(value: string | null | undefined, req: PayloadRequest): Promise<true | string> {
  if (!value) return true
  if (!CLICK_KEY.test(value)) return CLICK_GOAL_COPY.invalidKey
  const options = req.payload.config.custom?.xp as ResolvedOptions | undefined
  if (!options || await options.access.manage({ req }) !== true) return true
  const keys = await clickKeys(req.payload)
  return !keys || keys.has(value) || (await definedClickKeys(pooledExecutor(req.payload))).has(value) || CLICK_GOAL_COPY.undefinedKey
}
