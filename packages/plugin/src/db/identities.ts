import type { PostgresAdapter } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { ownConnection, type Executor } from './executor.js'
import { COLUMNS, TABLES } from './names.js'

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`

export type IdentityWriteOutcome = 'linked' | 'verified' | 'skipped'
type IdentityInput = { anonymousId: string; userId: string; verified: boolean }

export async function insertIdentity(exec: Executor, { anonymousId, userId, verified }: IdentityInput): Promise<IdentityWriteOutcome> {
  const schema = (exec as Executor & { schemaName?: string }).schemaName
  const table = `${schema ? `${quote(schema)}.` : ''}${quote(TABLES.identities)}`
  const c = COLUMNS.identities
  const { rows } = await exec.query<{ inserted: boolean }>(`INSERT INTO ${table} AS identity (${[c.anonymousId, c.userId, c.linkedAt, c.verifiedAt, c.createdAt, c.updatedAt].map(quote).join(', ')}) VALUES ($1, $2, now(), CASE WHEN $3 THEN now() END, now(), now()) ON CONFLICT (${quote(c.anonymousId)}) DO UPDATE SET ${quote(c.verifiedAt)} = now(), ${quote(c.updatedAt)} = now() WHERE identity.${quote(c.userId)} = EXCLUDED.${quote(c.userId)} AND identity.${quote(c.verifiedAt)} IS NULL AND $3 RETURNING (xmax = 0) AS inserted`, [anonymousId, userId, verified])
  return rows.length === 0 ? 'skipped' : rows[0]!.inserted ? 'linked' : 'verified'
}

/** §5.6 / §7.8: privileged insert/upgrade, isolated from the caller's sign-in transaction. */
export async function insertIdentityOnOwnConnection(payload: Payload, identity: IdentityInput): Promise<IdentityWriteOutcome> {
  const db = payload.db as Pick<PostgresAdapter, 'pool' | 'schemaName'>
  const exec = await ownConnection(db.pool)
  try { return await insertIdentity(Object.assign(exec, { schemaName: db.schemaName }), identity) }
  finally { exec.release() }
}
