import { getTableConfig } from 'drizzle-orm/pg-core'
import type { Executor } from '../../src/db/executor.js'
import { sweepEvents } from '../../src/db/sweep.js'
import { xp_events } from '../_fixtures/generated-schema.js'

export const eventIndexes = getTableConfig(xp_events).indexes.map(index => ({
  name: index.config.name,
  columns: index.config.columns.map(column => {
    if (!('name' in column)) throw new Error('Expected a simple generated event index')
    return column.name
  }),
  unique: index.config.unique,
}))
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`
export const batchSize = 256
const now = new Date('2026-10-31')
type Plan = {
  'Node Type': string; Alias?: string; 'Index Name'?: string; 'Index Cond'?: string
  Filter?: string; 'Actual Rows'?: number; 'Actual Loops'?: number; 'Rows Removed by Filter'?: number; Plans?: Plan[]
}
const nodes = (plan: Plan): Plan[] => [plan, ...(plan.Plans ?? []).flatMap(nodes)]

export type SweepBranchPlan = {
  branch: number; indexName: string[]; indexCond: string; rowsRemovedByFilter: number; examined: number
  filters: string[]; scanTypes: string[]; bitmapIndexes: string[][]; sql: string; plan: unknown
}
export type SweepPlanScale = {
  scale: 1 | 2 | 4; oldConversions: number; branches: SweepBranchPlan[]; windowReads: number; emptyExamined: number
}
const examinedRows = (scans: Plan[]) => scans.reduce((sum, node) => sum +
  ((node['Actual Rows'] ?? 0) + (node['Rows Removed by Filter'] ?? 0)) * (node['Actual Loops'] ?? 0), 0)

/** Uses only fixture indexes, with every ANALYZE DELETE rolled back to a savepoint.
 * The outer transaction also rolls back the minimal schema and data. rawExec runs
 * after BEGIN, so a pg caller can SET LOCAL search_path before creating tables.
 * Defaults to the original 400k events; CI's Postgres gate starts with 50k.
 */
export async function measureSweepPlans(exec: Executor, rawExec: (sql: string) => Promise<unknown>,
  idType: 'integer' | 'uuid', baseEvents = 400_000) {
  await exec.query('BEGIN')
  try {
    await rawExec(`
      CREATE TYPE enum_xp_events_type AS ENUM ('exposure', 'conversion', 'arm-mismatch');
      CREATE TABLE xp_experiments (id ${idType} PRIMARY KEY);
      CREATE TABLE xp_phases (id serial PRIMARY KEY, experiment_id ${idType} REFERENCES xp_experiments(id) ON DELETE SET NULL, started_at timestamptz NOT NULL, ended_at timestamptz);
      CREATE INDEX xp_phases_experiment_idx ON xp_phases(experiment_id);
      CREATE TABLE xp_state (revision numeric);
      INSERT INTO xp_state VALUES (1);
      CREATE TABLE xp_events (id ${idType} PRIMARY KEY, experiment_id ${idType} REFERENCES xp_experiments(id) ON DELETE SET NULL,
        type enum_xp_events_type, phase numeric, ts timestamptz, unit_id text, event_name text, dedupe_key text,
        updated_at timestamptz, created_at timestamptz, series integer);
      ${eventIndexes.map(index => `CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX ${quote(index.name!)} ON xp_events (${index.columns.map(column => quote(column!)).join(', ')})`).join(';\n')};
    `)
    // Adapted from the review's scratchpad/c18r/s.test.ts: 100 experiments,
    // the first 50 open since March 2025, the other 50 ended in January 2025.
    const idOf = (expression: string) => idType === 'integer' ? expression
      : `('00000000-0000-0000-0000-' || lpad((${expression})::text, 12, '0'))::uuid`
    await exec.query(`INSERT INTO xp_experiments SELECT ${idOf('n')} FROM generate_series(1, 100) n`)
    await exec.query(`INSERT INTO xp_phases (experiment_id, started_at, ended_at)
      SELECT ${idOf('n')}, CASE WHEN n <= 50 THEN '2025-03-01'::timestamptz ELSE '2024-10-01'::timestamptz END,
        CASE WHEN n <= 50 THEN NULL ELSE '2025-01-01'::timestamptz END FROM generate_series(1, 100) n`)
    await exec.query(`INSERT INTO xp_events (id, experiment_id, type, phase, ts, unit_id, dedupe_key, series)
      SELECT ${idOf('n')}, CASE WHEN n % 5 = 0 OR n % 401 = 0 THEN NULL ELSE ${idOf('(n % 100) + 1')} END,
        CASE WHEN n % 5 = 0 THEN 'conversion' WHEN n % 401 = 0 AND n % 2 = 0 THEN 'arm-mismatch'
          ELSE 'exposure' END::enum_xp_events_type,
        1, '2024-10-01'::timestamptz + n * interval '2 minutes',
        'unit-' || n, 'plan-' || n, n FROM generate_series(1, ${baseEvents}) n`)
    const physicalIndexes = await exec.query<{ indexname: string; indexdef: string }>("SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = current_schema() AND tablename = 'xp_events'")
    await exec.query('ANALYZE xp_phases')
    const measurements: SweepPlanScale[] = []
    const initialConversions = baseEvents / 5
    let previous = initialConversions
    for (const scale of [1, 2, 4] as const) {
      const oldConversions = initialConversions * scale
      const branches: SweepBranchPlan[] = []
      if (oldConversions > previous) {
        await exec.query(`INSERT INTO xp_events (id, type, ts, unit_id, dedupe_key, series)
          SELECT ${idOf('n')}, 'conversion', '2025-03-01'::timestamptz + (n % 1000) * interval '1 second',
            'unit-' || n, 'plan-' || n, n FROM generate_series($1::integer, $2::integer) n`, [baseEvents + 1 + previous - initialConversions, baseEvents + oldConversions - initialConversions])
      }
      previous = oldConversions
      await exec.query('ANALYZE xp_events')
      const calls: Array<{ text: string; params: unknown[] }> = []
      let windowReads = 0
      await sweepEvents({ query: async <R>(text: string, params: unknown[] = []) => {
        if (text.includes('min(w."from")')) windowReads++
        if (!text.startsWith('DELETE')) return exec.query<R>(text, params)
        calls.push({ text, params })
        return { rows: [], rowCount: 0 }
      } }, { now, batchSize })
      for (const [branch, call] of calls.entries()) {
        await exec.query('SAVEPOINT sweep_plan')
        try {
          const result = await exec.query<{ 'QUERY PLAN': Array<{ Plan: Plan }> }>(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${call.text}`, call.params)
          const candidates = nodes(result.rows[0]!['QUERY PLAN'][0]!.Plan).filter(node => node.Alias === 'v')
          const indexNodes = candidates.flatMap(nodes).filter(node => node['Index Name'])
          branches.push({
            branch, indexName: indexNodes.map(node => node['Index Name']!),
            indexCond: indexNodes.map(node => node['Index Cond'] ?? '').join(' '),
            rowsRemovedByFilter: candidates.reduce((sum, node) => sum + (node['Rows Removed by Filter'] ?? 0) * (node['Actual Loops'] ?? 0), 0),
            examined: examinedRows(candidates),
            // The correlated phase subplan legitimately filters experiment_id;
            // only the event scan's Filter can hide a missing index probe.
            filters: candidates.flatMap(node => node.Filter ? [node.Filter] : []),
            scanTypes: candidates.map(node => node['Node Type']),
            // Each Bitmap Heap Scan's child Bitmap Index Scan indexes, so a gate can accept a
            // bitmap path only when it is driven by the expected index.
            bitmapIndexes: candidates.filter(node => node['Node Type'] === 'Bitmap Heap Scan')
              .map(node => nodes(node).filter(child => child['Node Type'] === 'Bitmap Index Scan').map(child => child['Index Name'] ?? '')),
            sql: call.text, plan: result.rows,
          })
        } finally {
          await exec.query('ROLLBACK TO SAVEPOINT sweep_plan')
          await exec.query('RELEASE SAVEPOINT sweep_plan')
        }
      }
      // An exhausted batch must also avoid scanning all protected old rows.
      let emptyExamined = 0
      await exec.query('SAVEPOINT sweep_plan')
      try {
        const call = calls[3]!
        if (!call) throw new Error('Sweep did not produce the conversion branch')
        await exec.query("DELETE FROM xp_events WHERE experiment_id IS NULL AND type = 'conversion' AND ts < $1", [call.params[0]])
        const result = await exec.query<{ 'QUERY PLAN': Array<{ Plan: Plan }> }>(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${call.text}`, call.params)
        const scans = nodes(result.rows[0]!['QUERY PLAN'][0]!.Plan).filter(node => node.Alias === 'v')
        emptyExamined = examinedRows(scans)
      } finally {
        await exec.query('ROLLBACK TO SAVEPOINT sweep_plan')
        await exec.query('RELEASE SAVEPOINT sweep_plan')
      }
      measurements.push({ scale, oldConversions, branches, windowReads, emptyExamined })
    }
    return { physicalIndexes: physicalIndexes.rows.map(row => row.indexname).sort(), measurements }
  } finally { await exec.query('ROLLBACK') }
}
