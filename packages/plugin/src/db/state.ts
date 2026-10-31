import type { Executor } from './pgExecutor.js'
import { COLUMNS, TABLES } from './names.js'
import type { Manifest } from '../types/manifest.js'

const columns = COLUMNS.state
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`
function table(exec: Executor, options: { schemaName?: string } = {}) {
  const schemaName = options.schemaName ?? (exec as Executor & { schemaName?: string }).schemaName
  return `${schemaName ? `${quote(schemaName)}.` : ''}${quote(TABLES.state)}`
}

/** Always take this lock last: layer → flag point → experiment → state. */
export async function bumpRevision(exec: Executor): Promise<number> {
  await exec.query("SELECT pg_advisory_xact_lock(hashtext('xp:state'), 0)")
  const updated = await exec.query<{ revision: number }>(`UPDATE ${table(exec)} SET ${quote(columns.revision)} = COALESCE(${quote(columns.revision)}, 0) + 1, ${quote(columns.updatedAt)} = now() RETURNING ${quote(columns.revision)}`)
  if (updated.rows[0]) return updated.rows[0].revision
  const inserted = await exec.query<{ revision: number }>(`INSERT INTO ${table(exec)} (${quote(columns.revision)}, ${quote(columns.createdAt)}, ${quote(columns.updatedAt)}) VALUES (1, now(), now()) RETURNING ${quote(columns.revision)}`)
  return inserted.rows[0]!.revision
}

export async function writeManifest(exec: Executor, manifest: Manifest): Promise<void> {
  await exec.query(`UPDATE ${table(exec)} SET ${quote(columns.manifest)} = $1::jsonb, ${quote(columns.updatedAt)} = now()`, [JSON.stringify(manifest)])
}

export async function readState(exec: Executor, options: { schemaName?: string } = {}): Promise<{ revision: number; manifest: Manifest | null; flagDefaults: Manifest['flagDefaults'] } | null> {
  const result = await exec.query<{ revision: number; manifest: Manifest | null; flagDefaults: Manifest['flagDefaults'] | null }>(`SELECT ${quote(columns.revision)}, ${quote(columns.manifest)}, ${quote(columns.flagDefaults)} AS "flagDefaults" FROM ${table(exec, options)} LIMIT 1`)
  const row = result.rows[0]
  return row ? { ...row, flagDefaults: row.flagDefaults ?? {} } : null
}
