import type { PayloadRequest } from 'payload'
import { XpNoTransactionError } from '../errors.js'
import type { DocId } from '../types/contracts.js'
import type { Executor } from './executor.js'
import { COLUMNS, TABLES } from './names.js'
import { qualifiedTable, quoteIdentifier as quote } from './sql.js'

interface DeleteState {
  tail: Promise<void>
  retiredSlugs: Set<string>
  excludedIds: Map<string, DocId>
  pruneFlagDefaultIds: Map<string, DocId>
}

// Key by the actual session: borrowed requests in one transaction share a queue,
// different Payload instances do not, and commit/rollback permits GC of state.
const transactions = new WeakMap<object, DeleteState>()

/** Payload bulk delete runs hooks concurrently on a shared transaction. Queue
 * each hook body, including the full manifest read/modify/write, on that session.
 * Successful beforeDelete bodies retain exclusions until the transaction ends:
 * another row can be between hooks with its children gone but its row present.
 */
export async function serializeDelete<T>(req: PayloadRequest, fn: (state: DeleteState) => Promise<T>): Promise<T> {
  const id = await req.transactionID
  const session = id == null ? undefined : req.payload.db.sessions?.[id]
  if (!session) throw new XpNoTransactionError()
  let state = transactions.get(session)
  if (!state) {
    state = { tail: Promise.resolve(), retiredSlugs: new Set(), excludedIds: new Map(), pruneFlagDefaultIds: new Map() }
    transactions.set(session, state)
  }
  const current = state
  const work = current.tail.then(() => fn(current))
  current.tail = work.then(() => undefined, () => undefined)
  return work
}

/** Select only snapshot ids and delete the entire set in one SQL statement. */
export async function deleteExperimentSnapshots(exec: Executor, experimentId: DocId): Promise<void> {
  const table = qualifiedTable(exec, TABLES.resultsSnapshots)
  const c = COLUMNS.resultsSnapshots
  await exec.query(`DELETE FROM ${table} WHERE ${quote(c.id)} IN (SELECT ${quote(c.id)} FROM ${table} WHERE ${quote(c.experimentId)} = $1)`, [experimentId])
}
