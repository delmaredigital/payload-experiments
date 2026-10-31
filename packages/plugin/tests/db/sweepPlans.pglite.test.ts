import { PGlite } from '@electric-sql/pglite'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { expect, test } from 'vitest'
import type { Executor } from '../../src/db/executor.js'
import { sweepEvents } from '../../src/db/sweep.js'
import { xp_events } from '../_fixtures/generated-schema.js'

const eventIndexes = getTableConfig(xp_events).indexes.map(index => ({
  name: index.config.name,
  columns: index.config.columns.map(column => {
    if (!('name' in column)) throw new Error('Expected a simple generated event index')
    return column.name
  }),
  unique: index.config.unique,
}))
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`
const batchSize = 256
const now = new Date('2026-10-31')
type Plan = {
  'Node Type': string; Alias?: string; 'Index Name'?: string; 'Index Cond'?: string
  'Actual Rows'?: number; 'Actual Loops'?: number; 'Rows Removed by Filter'?: number; Plans?: Plan[]
}
const nodes = (plan: Plan): Plan[] => [plan, ...(plan.Plans ?? []).flatMap(nodes)]

/** 400k-row EXPLAIN ANALYZE harness, for both relationship id representations.
 * Index definitions come from the pushed-schema fixture, never test-only indexes.
 * Each ANALYZE DELETE is rolled back so each measurement sees the same data. */
test.each(['integer', 'uuid'] as const)('%s: selective retention plans and flat conversion batches at 1x/2x/4x', async idType => {
  const client = new PGlite()
  const exec: Executor = { query: async <R>(text: string, params: unknown[] = []) => {
    const result = await client.query(text, params)
    return { rows: result.rows as R[], rowCount: result.affectedRows ?? result.rows.length }
  } }
  try {
    await client.exec(`
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
        'unit-' || n, 'plan-' || n, n FROM generate_series(1, 400000) n`)
    const physicalIndexes = await exec.query<{ indexname: string; indexdef: string }>("SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'xp_events'")
    expect(physicalIndexes.rows.map(row => row.indexname).sort()).toEqual(['xp_events_pkey', ...eventIndexes.map(index => index.name)].sort())
    await exec.query('ANALYZE xp_phases')
    const examined: number[] = [], emptyExamined: number[] = []
    const branchIndexes: string[][] = []
    let previous = 80000
    for (const oldConversions of [80000, 160000, 320000]) {
      if (oldConversions > previous) {
        await exec.query(`INSERT INTO xp_events (id, type, ts, unit_id, dedupe_key, series)
          SELECT ${idOf('n')}, 'conversion', '2025-03-01'::timestamptz + (n % 1000) * interval '1 second',
            'unit-' || n, 'plan-' || n, n FROM generate_series($1::integer, $2::integer) n`, [400001 + previous - 80000, 400000 + oldConversions - 80000])
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
      expect(calls).toHaveLength(4)
      expect(windowReads).toBe(1)
      for (const [branch, call] of calls.entries()) {
        await exec.query('BEGIN')
        try {
          const result = await exec.query<{ 'QUERY PLAN': Array<{ Plan: Plan }> }>(`EXPLAIN (ANALYZE, FORMAT JSON) ${call.text}`, call.params)
          const candidates = nodes(result.rows[0]!['QUERY PLAN'][0]!.Plan).filter(node => node.Alias === 'v')
          expect(candidates).not.toHaveLength(0)
          expect(candidates.every(node => node['Node Type'] !== 'Seq Scan')).toBe(true)
          const indexNodes = candidates.flatMap(nodes).filter(node => node['Index Name'])
          expect(indexNodes.every(node => node['Index Name'] !== 'xp_events_pkey')).toBe(true)
          const conditions = indexNodes.map(node => node['Index Cond'] ?? '').join(' ')
          // Check the selective predicates, not just the physical scan label.
          expect(conditions).toContain('experiment_id')
          if (branch < 2) expect(conditions, JSON.stringify(result.rows)).toContain('type')
          if (branch === 2) expect(conditions).toContain('ANY')
          if (branch === 3) {
            expect(conditions).toMatch(/ts < /)
            expect(call.text).not.toContain('xp_phases')
          }
          const scanWork = candidates.reduce((sum, node) => sum + ((node['Actual Rows'] ?? 0) + (node['Rows Removed by Filter'] ?? 0)) * (node['Actual Loops'] ?? 0), 0)
          expect(scanWork).toBeLessThanOrEqual(batchSize * 4)
          if (oldConversions === 80000) branchIndexes.push(indexNodes.map(node => node['Index Name']!))
          if (branch === 3) examined.push(scanWork)
        } finally { await exec.query('ROLLBACK') }
      }
      // An exhausted batch must also avoid scanning all protected old rows.
      await exec.query('BEGIN')
      try {
        const call = calls[3]!
        await exec.query("DELETE FROM xp_events WHERE experiment_id IS NULL AND type = 'conversion' AND ts < $1", [call.params[0]])
        const result = await exec.query<{ 'QUERY PLAN': Array<{ Plan: Plan }> }>(`EXPLAIN (ANALYZE, FORMAT JSON) ${call.text}`, call.params)
        const scans = nodes(result.rows[0]!['QUERY PLAN'][0]!.Plan).filter(node => node.Alias === 'v')
        emptyExamined.push(scans.reduce((sum, node) => sum + ((node['Actual Rows'] ?? 0) + (node['Rows Removed by Filter'] ?? 0)) * (node['Actual Loops'] ?? 0), 0))
      } finally { await exec.query('ROLLBACK') }
    }
    expect(Math.max(...examined)).toBeLessThanOrEqual(Math.max(1, Math.min(...examined)) * 2)
    expect(Math.max(...emptyExamined)).toBeLessThanOrEqual(batchSize)
    process.stdout.write(`S2 ${idType}: old conversions 80000/160000/320000; examined ${examined.join('/')}; empty ${emptyExamined.join('/')}; branch indexes ${JSON.stringify(branchIndexes)}\n`)
  } finally { await client.close() }
}, 180_000)
