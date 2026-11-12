import type { PayloadRequest } from 'payload'
import type { Arm, DocId } from '../types/contracts.js'
import type { Executor } from './executor.js'
import { COLUMNS, TABLES } from './names.js'
import { qualifiedTable, quoteIdentifier as q } from './sql.js'

export interface PlacementDoc { collection: string; id: DocId }
export interface PlacementTest {
  id: DocId; slug: string; name: string; status: string; kind: string; pageCollection: string | null
  phase: number; winnerArm?: string | null; discardedAt?: string | null; pagesReleasedAt?: string | null; arms: Arm[]; placementDocs: PlacementDoc[] | null
}
/** Raw reads only: guard discovery includes every status, interaction checks filter under the locks. */
export async function placementTests(exec: Executor): Promise<PlacementTest[]> {
  const e = COLUMNS.experiments, p = COLUMNS.phases
  const { rows } = await exec.query<PlacementTest>(`SELECT x.${q(e.id)} AS id, x.${q(e.slug)} AS slug, x.${q(e.name)} AS name,
    x.${q(e.status)} AS status, x.${q(e.kind)} AS kind, x.${q(e.pageCollection)} AS "pageCollection",
    x.${q(e.decisionWinnerArm)} AS "winnerArm", x.${q(e.decisionDiscardedAt)} AS "discardedAt", x.${q(e.decisionPagesReleasedAt)} AS "pagesReleasedAt", p.${q(p.phase)} AS phase, p.${q(p.arms)} AS arms, p.${q(p.placementDocs)} AS "placementDocs"
    FROM ${qualifiedTable(exec, TABLES.experiments)} x
    LEFT JOIN LATERAL (SELECT * FROM ${qualifiedTable(exec, TABLES.phases)} WHERE ${q(p.experimentId)} = x.${q(e.id)}
      AND ${q(p.phaseKind)} = 'test' ORDER BY ${q(p.phase)} DESC LIMIT 1) p ON true`, [])
  return rows.map(row => ({ ...row, arms: Array.isArray(row.arms) ? row.arms : [], placementDocs: row.placementDocs ?? null }))
}

/** Indexed slug lookup for the removal guard; startable tests share E with Start before status is rechecked. */
export async function removableBlockTests(exec: Executor, slugs: readonly string[]): Promise<Array<Pick<PlacementTest, 'id' | 'slug' | 'name' | 'status'>>> {
  const e = COLUMNS.experiments
  const { rows } = await exec.query<Pick<PlacementTest, 'id' | 'slug' | 'name' | 'status'>>(`SELECT ${q(e.id)} AS id, ${q(e.slug)} AS slug, ${q(e.name)} AS name, ${q(e.status)} AS status
    FROM ${qualifiedTable(exec, TABLES.experiments)} WHERE ${q(e.slug)} = ANY($1::text[]) AND ${q(e.kind)} = 'block' AND ${q(e.status)} IN ('draft', 'stopped', 'running')`, [slugs])
  return rows
}

/** §7.8: interacting-tests computes placement paths from published rows. */
export async function placementPathContent(req: PayloadRequest, collection: string, id: DocId) {
  return req.payload.db.findOne<Record<string, unknown> & { id: DocId }>({ collection, req, where: { id: { equals: id } },
    // Adapter read: interacting-tests computes placement paths from published rows.
    overrideAccess: true,
  } as Parameters<PayloadRequest['payload']['db']['findOne']>[0])
}

/** Caller holds E. Never coalesce null: old rounds must continue to scan. */
export async function appendPlacementDoc(exec: Executor, experimentId: DocId, phase: number, doc: PlacementDoc): Promise<void> {
  const p = COLUMNS.phases, column = q(p.placementDocs)
  await exec.query(`UPDATE ${qualifiedTable(exec, TABLES.phases)} SET ${column} = ${column} || $1::jsonb
    WHERE ${q(p.experimentId)} = $2 AND ${q(p.phase)} = $3 AND ${column} IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(${column}) entry WHERE entry->>'collection' = $4 AND entry->>'id' = $5)`,
  [JSON.stringify([doc]), experimentId, phase, doc.collection, String(doc.id)])
}

/** Deciding a stopped modern round restores routing on its detached rescan.
 * Legacy null rounds retain scan-on-every-check semantics. Caller holds E.
 */
export async function refreshPlacementDocs(exec: Executor, experimentId: DocId, phase: number, docs: readonly PlacementDoc[]): Promise<void> {
  const p = COLUMNS.phases
  await exec.query(`UPDATE ${qualifiedTable(exec, TABLES.phases)} SET ${q(p.placementDocs)} = $1::jsonb
    WHERE ${q(p.experimentId)} = $2 AND ${q(p.phase)} = $3 AND ${q(p.placementDocs)} IS NOT NULL`, [JSON.stringify(docs), experimentId, phase])
}
