import type { GlobalBeforeChangeHook } from 'payload'
import { pooledExecutor, txExecutor, type Executor } from './executor.js'
import { lockSlug } from './locks.js'
import { COLUMNS, TABLES } from './names.js'
import { qualifiedTable, quoteIdentifier as q } from './sql.js'

/** Each candidate is locked before its live and retired checks, including suffix collisions. */
export async function pickSlug(exec: Executor, stem: string, transactional: boolean): Promise<string> {
  const e = COLUMNS.experiments, s = COLUMNS.state
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? '' : `-${n}`
    const candidate = stem.slice(0, 64 - suffix.length) + suffix
    if (transactional) await lockSlug(exec, candidate)
    const { rows } = await exec.query<{ used: boolean }>(`SELECT EXISTS (SELECT 1 FROM ${qualifiedTable(exec, TABLES.experiments)} WHERE ${q(e.slug)} = $1)
      OR EXISTS (SELECT 1 FROM ${qualifiedTable(exec, TABLES.state)} WHERE coalesce(${q(s.retiredSlugs)}, '[]'::jsonb) ? $1) AS used`, [candidate])
    if (!rows[0]?.used) return candidate
  }
}

/** Delete owns the experiment lock; state is always acquired last. */
export async function retireSlug(exec: Executor, slug: string): Promise<void> {
  await exec.query("SELECT pg_advisory_xact_lock(hashtext('xp:state'), 0)")
  const s = COLUMNS.state, table = qualifiedTable(exec, TABLES.state)
  await exec.query(`INSERT INTO ${table} (${q(s.revision)}, ${q(s.retiredSlugs)}, ${q(s.createdAt)}, ${q(s.updatedAt)})
    SELECT 0, '[]'::jsonb, now(), now() WHERE NOT EXISTS (SELECT 1 FROM ${table})`)
  await exec.query(`UPDATE ${table} SET ${q(s.retiredSlugs)} = coalesce(${q(s.retiredSlugs)}, '[]'::jsonb) || $1::jsonb
    WHERE NOT (coalesce(${q(s.retiredSlugs)}, '[]'::jsonb) ? $2)`, [JSON.stringify([slug]), slug])
}

/** Payload merges the previous global into writes. Refresh the append-only column under its lock. */
export const preserveRetiredSlugs: GlobalBeforeChangeHook = async ({ req, data }) => {
  const transactional = await req.transactionID != null
  const exec = transactional ? txExecutor(req) : pooledExecutor(req.payload)
  if (transactional) await exec.query("SELECT pg_advisory_xact_lock(hashtext('xp:state'), 0)")
  const { rows } = await exec.query<{ retired: string[] | null }>(`SELECT ${q(COLUMNS.state.retiredSlugs)} AS retired FROM ${qualifiedTable(exec, TABLES.state)} LIMIT 1`)
  data.retiredSlugs = rows[0]?.retired ?? null
  return data
}
