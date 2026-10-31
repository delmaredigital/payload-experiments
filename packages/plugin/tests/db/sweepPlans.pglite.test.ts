import { PGlite } from '@electric-sql/pglite'
import { expect, test } from 'vitest'
import type { Executor } from '../../src/db/executor.js'
import { batchSize, eventIndexes, measureSweepPlans } from '../_helpers/sweepPlans.js'

/** Original 400k-row gate, for both relationship id representations. */
test.each(['integer', 'uuid'] as const)('%s: selective retention plans and flat conversion batches at 1x/2x/4x', async idType => {
  const client = new PGlite()
  const exec: Executor = { query: async <R>(text: string, params: unknown[] = []) => {
    const result = await client.query(text, params)
    return { rows: result.rows as R[], rowCount: result.affectedRows ?? result.rows.length }
  } }
  try {
    const { physicalIndexes, measurements } = await measureSweepPlans(exec, sql => client.exec(sql), idType)
    expect(physicalIndexes).toEqual(['xp_events_pkey', ...eventIndexes.map(index => index.name)].sort())
    for (const measurement of measurements) {
      expect(measurement.branches).toHaveLength(4)
      expect(measurement.windowReads).toBe(1)
      for (const { branch, scanTypes, indexName, indexCond, examined, sql, plan } of measurement.branches) {
        expect(scanTypes).not.toHaveLength(0)
        expect(scanTypes.every(type => type !== 'Seq Scan')).toBe(true)
        expect(indexName.every(name => name !== 'xp_events_pkey')).toBe(true)
        expect(indexCond).toContain('experiment_id')
        if (branch < 2) expect(indexCond, JSON.stringify(plan)).toContain('type')
        if (branch === 2) expect(indexCond).toContain('ANY')
        if (branch === 3) {
          expect(indexCond).toMatch(/ts < /)
          expect(sql).not.toContain('xp_phases')
        }
        expect(examined).toBeLessThanOrEqual(batchSize * 4)
      }
    }
    const examined = measurements.map(measurement => measurement.branches[3]!.examined)
    const emptyExamined = measurements.map(measurement => measurement.emptyExamined)
    const branchIndexes = measurements[0]!.branches.map(branch => branch.indexName)
    expect(Math.max(...examined)).toBeLessThanOrEqual(Math.max(1, Math.min(...examined)) * 2)
    expect(Math.max(...emptyExamined)).toBeLessThanOrEqual(batchSize)
    process.stdout.write(`S2 ${idType}: old conversions 80000/160000/320000; examined ${examined.join('/')}; empty ${emptyExamined.join('/')}; branch indexes ${JSON.stringify(branchIndexes)}\n`)
  } finally { await client.close() }
}, 180_000)
