import type { PostgresAdapter } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { ownConnection, type Executor } from './executor.js'
import { COLUMNS, TABLES } from './names.js'

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`

export async function insertIdentity(exec: Executor, { anonymousId, userId }: { anonymousId: string; userId: string }): Promise<void> {
  const schema = (exec as Executor & { schemaName?: string }).schemaName
  const table = `${schema ? `${quote(schema)}.` : ''}${quote(TABLES.identities)}`
  const c = COLUMNS.identities
  await exec.query(`INSERT INTO ${table} (${[c.anonymousId, c.userId, c.linkedAt, c.createdAt, c.updatedAt].map(quote).join(', ')}) VALUES ($1, $2, now(), now(), now()) ON CONFLICT (${quote(c.anonymousId)}) DO NOTHING`, [anonymousId, userId])
}

/** §5.6 / §7.8: privileged insert, isolated from the caller's sign-in transaction. */
export async function insertIdentityOnOwnConnection(payload: Payload, identity: { anonymousId: string; userId: string }): Promise<void> {
  const db = payload.db as Pick<PostgresAdapter, 'pool' | 'schemaName'>
  const exec = await ownConnection(db.pool)
  try { await insertIdentity(Object.assign(exec, { schemaName: db.schemaName }), identity) }
  finally { exec.release() }
}
