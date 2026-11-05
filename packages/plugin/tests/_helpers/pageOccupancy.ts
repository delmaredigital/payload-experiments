import { PGlite } from '@electric-sql/pglite'
import type { Executor } from '../../src/db/executor.js'
import type { Arm, DocId } from '../../src/types/contracts.js'
import { defaultArms } from '../../src/collections/experiments/armInvariants.js'

export const pageArms = (path: string): Arm[] => defaultArms('page').map((arm, index) => ({ ...arm, pageTarget: index ? `${path}/variant` : path }))

/** Minimal occupancy projection of Payload's tables, with both adapter id types.
 * Document arms are array rows; frozen phase arms are JSON. The train exercises
 * these queries against the complete adapter-generated schema.
 */
export async function pageOccupancyDb(idType: 'serial' | 'uuid' = 'serial') {
  const client = new PGlite()
  const exec: Executor = { async query<R>(text: string, params: unknown[] = []) {
    const result = await client.query<R>(text, params)
    return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length }
  } }
  try {
    await client.exec(`
      CREATE TABLE xp_experiments (id ${idType} PRIMARY KEY, kind text, status text, slug text, name text, page_collection text,
        decision_winner_arm text, decision_discarded_at timestamptz, decision_pages_released_at timestamptz);
      CREATE TABLE xp_experiments_arms (_parent_id ${idType === 'serial' ? 'integer' : 'uuid'} REFERENCES xp_experiments(id),
        _order integer, key text, label text, kind text, weight numeric, page_target text);
      CREATE TABLE xp_phases (experiment_id ${idType === 'serial' ? 'integer' : 'uuid'} REFERENCES xp_experiments(id),
        phase numeric, phase_kind text, arms jsonb, placement_docs jsonb);
    `)
    const id = (value: number): DocId => idType === 'serial' ? value : `00000000-0000-0000-0000-${String(value).padStart(12, '0')}`
    async function addTest(value: number, status: string, documentPath: string,
      rounds: Array<{ phase: number; kind: 'test' | 'rollout'; arms: Arm[] }>, kind = 'page',
      decision: { winnerArm?: string; discardedAt?: string; pagesReleasedAt?: string } = {}) {
      const testId = id(value)
      await exec.query('INSERT INTO xp_experiments (id, kind, status, decision_winner_arm, decision_discarded_at, decision_pages_released_at) VALUES ($1, $2, $3, $4, $5, $6)',
        [testId, kind, status, decision.winnerArm ?? null, decision.discardedAt ?? null, decision.pagesReleasedAt ?? null])
      for (const [index, arm] of pageArms(documentPath).entries()) {
        await exec.query('INSERT INTO xp_experiments_arms (_parent_id, _order, key, label, kind, weight, page_target) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [testId, index + 1, arm.key, arm.label, arm.kind, arm.weight, arm.pageTarget])
      }
      for (const round of rounds) {
        await exec.query('INSERT INTO xp_phases (experiment_id, phase, phase_kind, arms) VALUES ($1, $2, $3, $4::jsonb)',
          [testId, round.phase, round.kind, JSON.stringify(round.arms)])
      }
      return testId
    }
    return { client, exec, id, addTest, close: () => client.close() }
  } catch (cause) { await client.close(); throw cause }
}
