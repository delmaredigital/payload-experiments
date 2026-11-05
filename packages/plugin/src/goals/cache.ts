import type { Payload } from 'payload'
import { definedClickKeys } from '../db/clickGoals.js'
import { pooledExecutor } from '../db/executor.js'
import { safeError } from '../log.js'
import { CLICK_KEY } from './key.js'

type Entry = { keys?: ReadonlySet<string>; until: number; pending?: Promise<ReadonlySet<string> | undefined> }
const caches = new WeakMap<Payload, Entry>()
/** Cache failures too, retaining the last good set and bounding retry traffic. */
export async function clickKeys(payload: Payload): Promise<ReadonlySet<string> | undefined> {
  let entry = caches.get(payload)
  if (!entry) { entry = { until: 0 }; caches.set(payload, entry) }
  if (entry.pending) return entry.pending
  if (Date.now() < entry.until) return entry.keys
  const current = entry
  current.pending = (async () => {
    try { current.keys = new Set([...(await definedClickKeys(pooledExecutor(payload)))].filter(key => CLICK_KEY.test(key))) }
    catch (error) {
      try { payload.logger.error({ err: safeError(error) }, 'Experiments: click goal lookup failed') } catch { /* Logging cannot break a beacon. */ }
    } finally { current.until = Date.now() + 30_000; current.pending = undefined }
    return current.keys
  })()
  return current.pending
}
