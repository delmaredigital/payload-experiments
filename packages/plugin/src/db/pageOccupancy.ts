import type { Arm, DocId } from '../types/contracts.js'
import type { Executor } from './executor.js'
import { COLUMNS, TABLES } from './names.js'
import { qualifiedTable, quoteIdentifier as q } from './sql.js'

/** Page tests that occupy paths, with the arms the runtime routes on (`compileManifest`):
 * - running or decided: the latest round's arms, or for a rollout the latest test round's;
 * - archived with a standing result (winner, not discarded, pages not released): the latest test
 *   round's arms whose paths are rewritten to the winner (archivedPages), so a new test cannot
 *   silently take them over.
 * Documents' arms may have been edited while stopped, so occupancy never reads them. */
export async function routedPageTests(exec: Executor): Promise<Array<{ id: DocId; arms: Arm[] }>> {
  const e = COLUMNS.experiments, p = COLUMNS.phases
  const experiments = qualifiedTable(exec, TABLES.experiments), phases = qualifiedTable(exec, TABLES.phases)
  const testRound = `LEFT JOIN LATERAL (SELECT ${q(p.arms)} AS arms FROM ${phases}
      WHERE ${q(p.experimentId)} = x.${q(e.id)} AND ${q(p.phaseKind)} = 'test' ORDER BY ${q(p.phase)} DESC LIMIT 1) test ON true`
  const { rows } = await exec.query<{ id: DocId; arms: Arm[] | null; winnerArm?: string | null }>(`
    SELECT x.${q(e.id)} AS "id", CASE WHEN latest.kind = 'rollout' THEN test.arms ELSE latest.arms END AS "arms", NULL::text AS "winnerArm"
    FROM ${experiments} x
    JOIN LATERAL (SELECT ${q(p.phaseKind)} AS kind, ${q(p.arms)} AS arms FROM ${phases}
      WHERE ${q(p.experimentId)} = x.${q(e.id)} ORDER BY ${q(p.phase)} DESC LIMIT 1) latest ON true
    ${testRound}
    WHERE x.${q(e.kind)} = 'page' AND x.${q(e.status)} IN ('running', 'decided')
    UNION ALL
    SELECT x.${q(e.id)} AS "id", test.arms AS "arms", x.${q(e.decisionWinnerArm)} AS "winnerArm"
    FROM ${experiments} x
    ${testRound}
    WHERE x.${q(e.kind)} = 'page' AND x.${q(e.status)} = 'archived' AND x.${q(e.decisionWinnerArm)} IS NOT NULL
      AND x.${q(e.decisionDiscardedAt)} IS NULL AND x.${q(e.decisionPagesReleasedAt)} IS NULL
    ORDER BY "id"`, [])
  const occupied: Array<{ id: DocId; arms: Arm[] }> = []
  for (const row of rows) {
    const arms = Array.isArray(row.arms) ? row.arms : []
    if (row.winnerArm == null) { occupied.push({ id: row.id, arms }); continue }
    // compileManifest's archivedPages rule: every arm path other than the winner's.
    const winnerPath = arms.find(arm => arm.key === row.winnerArm)?.pageTarget
    if (winnerPath) occupied.push({ id: row.id, arms: arms.filter(arm => arm.pageTarget && arm.pageTarget !== winnerPath) })
  }
  return occupied
}
