import { commitTransaction, initTransaction, killTransaction, type PayloadRequest } from 'payload'
import { pooledExecutor, txExecutor, type Executor } from '../db/executor.js'
import { lockTransitionScope } from '../db/locks.js'
import { currentTxid, txidStatus } from '../db/txid.js'
import { contentChangeSavepoint } from '../db/appends.js'
import { isPageBusy } from '../db/pageBusy.js'
import { XpRefusal } from '../errors.js'
import { buildAndStoreManifest } from '../manifest/compile.js'
import type { DocId } from '../types/contracts.js'

export interface TransitionScope {
  experimentId: DocId
  layerId?: DocId | null
  flagPointId?: string | null
  /** Defaults to true; content-change audit appends opt out. */
  bump?: boolean
  /** Best-effort content audit only; a borrowed transaction must never be killed here. */
  audit?: boolean
  excludeIds?: DocId[]
}

/** Runs transition writes on the request's transaction under ordered locks.
 * Returns the callback result and, unless bump is false, the stored manifest's
 * revision. Only the transaction owner commits and verifies that transaction's
 * status on the pool (even without a bump); a caller-owned transaction still
 * needs its caller to commit. The explicit borrowed audit path takes only lock E
 * inside a savepoint. ROLLBACK TO SAVEPOINT releases that transaction advisory
 * lock (Postgres §13.3); after RELEASE it remains held until the host commits.
 * Audit failures never kill the host transaction, even if savepoint recovery
 * itself fails: the host must observe its own failed commit. Other failures kill
 * even a borrowed transaction. Owned audits follow the ordinary owned path.
 */
export async function withTransition<T>(
  req: PayloadRequest,
  scope: TransitionScope,
  fn: (ctx: { exec: Executor; req: PayloadRequest }) => Promise<T>,
): Promise<{ result: T; revision?: number }> {
  const hadTransition = Object.prototype.hasOwnProperty.call(req.context, 'xpTransition')
  const previousTransition = req.context.xpTransition
  let borrowedAudit = scope.audit === true && req.transactionID != null
  try {
    const owns = await initTransaction(req)
    borrowedAudit = scope.audit === true && !owns
    const exec = txExecutor(req)
    req.context.xpTransition = true
    const work = async () => {
      await lockTransitionScope(exec, scope)
      return fn({ exec, req })
    }
    let result: T
    if (borrowedAudit) {
      const audit = await contentChangeSavepoint(exec, work)
      if (!audit.ok) {
        throw audit.error
      }
      result = audit.result
    } else result = await work()
    const revision = scope.bump === false ? undefined
      : (await buildAndStoreManifest(req, { excludeIds: scope.excludeIds })).revision
    if (owns) {
      const xid = await currentTxid(exec)
      await commitTransaction(req)
      const status = await txidStatus(pooledExecutor(req.payload), xid)
      if (status !== 'committed') {
        throw new XpRefusal('commit-unverified', 'The transition commit could not be verified.', { xid, status }, 500)
      }
    }
    return revision === undefined ? { result } : { result, revision }
  } catch (error) {
    if (!borrowedAudit) await killTransaction(req)
    if (!scope.audit && isPageBusy(error)) throw new XpRefusal('page-busy', "One of this test's pages is being saved right now. Try again in a moment.", undefined, 409, { cause: error })
    throw error
  } finally {
    if (hadTransition) req.context.xpTransition = previousTransition
    else delete req.context.xpTransition
  }
}
