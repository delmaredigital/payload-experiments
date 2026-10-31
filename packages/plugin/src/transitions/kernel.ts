import { commitTransaction, initTransaction, killTransaction, type PayloadRequest } from 'payload'
import { pooledExecutor, txExecutor, type Executor } from '../db/executor.js'
import { lockTransitionScope } from '../db/locks.js'
import { readState } from '../db/state.js'
import { XpRefusal } from '../errors.js'
import { buildAndStoreManifest } from '../manifest/compile.js'
import type { DocId } from '../types/contracts.js'

export interface TransitionScope {
  experimentId: DocId
  layerId?: DocId | null
  flagPointId?: string | null
  /** Defaults to true; content-change audit appends opt out. */
  bump?: boolean
  excludeIds?: DocId[]
}

/** Runs transition writes on the request's transaction under ordered locks.
 * Returns the callback result and, unless bump is false, the stored manifest's
 * revision. Only the transaction owner commits and verifies the revision on the
 * pool; a caller-owned transaction still needs its caller to commit. Any failure
 * kills even a borrowed transaction because aborted sessions cannot be reused.
 */
export async function withTransition<T>(
  req: PayloadRequest,
  scope: TransitionScope,
  fn: (ctx: { exec: Executor; req: PayloadRequest }) => Promise<T>,
): Promise<{ result: T; revision?: number }> {
  const hadTransition = Object.prototype.hasOwnProperty.call(req.context, 'xpTransition')
  const previousTransition = req.context.xpTransition
  try {
    const owns = await initTransaction(req)
    const exec = txExecutor(req)
    req.context.xpTransition = true
    await lockTransitionScope(exec, scope)
    const result = await fn({ exec, req })
    const revision = scope.bump === false ? undefined
      : (await buildAndStoreManifest(req, { excludeIds: scope.excludeIds })).revision
    if (owns) {
      await commitTransaction(req)
      if (revision !== undefined) {
        const state = await readState(pooledExecutor(req.payload))
        if (!state || !(state.revision >= revision)) {
          throw new XpRefusal('commit-unverified', 'The transition commit could not be verified.', { revision }, 500)
        }
      }
    }
    return revision === undefined ? { result } : { result, revision }
  } catch (error) {
    await killTransaction(req)
    throw error
  } finally {
    if (hadTransition) req.context.xpTransition = previousTransition
    else delete req.context.xpTransition
  }
}
