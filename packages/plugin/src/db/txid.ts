import type { Executor } from './executor.js'

/** Capture on the transaction executor before committing; keep the bigint as text. */
export async function currentTxid(exec: Executor): Promise<string> {
  const { rows } = await exec.query<{ xid: string }>('SELECT txid_current()::text AS xid')
  return rows[0]!.xid
}

/** Verify on the pool after commit, so another transaction's revision cannot
 * masquerade as this transaction's success. Null means its status is unavailable.
 */
export async function txidStatus(exec: Executor, xid: string): Promise<'committed' | 'aborted' | 'in progress' | null> {
  const { rows } = await exec.query<{ status: 'committed' | 'aborted' | 'in progress' | null }>(
    'SELECT txid_status($1::bigint) AS status', [xid],
  )
  return rows[0]?.status ?? null
}
