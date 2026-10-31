import type { Payload, PayloadRequest } from 'payload'
import { pooledExecutor, txExecutor, type Executor } from './executor.js'
import { COLUMNS, TABLES } from './names.js'

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`
const i = COLUMNS.identities
const e = COLUMNS.events
function table(exec: Executor, name: string) {
  const schema = (exec as Executor & { schemaName?: string }).schemaName
  return `${schema ? `${quote(schema)}.` : ''}${quote(name)}`
}
const eventPredicate = `${quote(e.userId)} = $1 OR (${quote(e.unitType)} = 'user' AND ${quote(e.unitId)} = $1) OR ${quote(e.unitId)} = ANY($2::text[])`

async function erase(exec: Executor, userId: string) {
  const linked = await exec.query<{ anonymousId: string }>(`SELECT ${quote(i.anonymousId)} AS "anonymousId" FROM ${table(exec, TABLES.identities)} WHERE ${quote(i.userId)} = $1`, [userId])
  const anonymousIds = linked.rows.map(row => row.anonymousId)
  const events = await exec.query(`DELETE FROM ${table(exec, TABLES.events)} WHERE ${eventPredicate} RETURNING ${quote(e.id)}`, [userId, anonymousIds])
  const identities = await exec.query(`DELETE FROM ${table(exec, TABLES.identities)} WHERE ${quote(i.userId)} = $1 RETURNING ${quote(i.id)}`, [userId])
  return { counts: { identities: identities.rows.length, events: events.rows.length }, anonymousIds }
}

/** The caller owns the transaction spanning the read and both deletes. */
export async function eraseUserRows(exec: Executor, userId: string): Promise<{ identities: number; events: number }> {
  return (await erase(exec, userId)).counts
}

/** Own a Payload transaction, then verify on the pool: Payload can swallow COMMIT errors. */
export async function eraseUserInTransaction(payload: Payload, userId: string): Promise<{ identities: number; events: number }> {
  const transactionID = await payload.db.beginTransaction()
  if (transactionID == null) throw new Error('Experiments: eraseUser requires a transaction')
  let result: Awaited<ReturnType<typeof erase>>
  try {
    result = await erase(txExecutor({ payload, transactionID } as PayloadRequest), userId)
    await payload.db.commitTransaction(transactionID)
  } catch (error) {
    await payload.db.rollbackTransaction(transactionID)
    throw error
  }
  const exec = pooledExecutor(payload)
  const verified = await exec.query<{ remaining: boolean }>(`SELECT EXISTS (SELECT 1 FROM ${table(exec, TABLES.events)} WHERE ${eventPredicate}) OR EXISTS (SELECT 1 FROM ${table(exec, TABLES.identities)} WHERE ${quote(i.userId)} = $1) AS remaining`, [userId, result.anonymousIds])
  if (verified.rows[0]?.remaining !== false) throw new Error('Experiments: eraseUser commit unverified')
  return result.counts
}
