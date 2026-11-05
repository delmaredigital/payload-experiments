import type { PayloadRequest } from 'payload'
import type { DocId } from '../types/contracts.js'
import type { Executor } from './executor.js'
import { COLUMNS, TABLES } from './names.js'
import { qualifiedTable, quoteIdentifier as q } from './sql.js'

/** Defined click goals only; called on the pool by the public events endpoint. */
export async function definedClickKeys(exec: Executor): Promise<Set<string>> {
  const c = COLUMNS.metrics
  const { rows } = await exec.query<{ slug: string }>(`SELECT ${q(c.slug)} AS slug FROM ${qualifiedTable(exec, TABLES.metrics)} WHERE ${q(c.source)} = 'click:' || ${q(c.slug)}`)
  return new Set(rows.map(row => row.slug))
}

/** §7.8: click-goal fairness reads published content raw. Never read draft versions. */
export async function clickGoalContent(req: PayloadRequest, collection: string, id: DocId) {
  const doc = await req.payload.db.findOne<Record<string, unknown> & { id: DocId }>({ collection, req, where: { id: { equals: id } },
    // Adapter read: click-goal fairness reads published content raw.
    overrideAccess: true,
  } as Parameters<PayloadRequest['payload']['db']['findOne']>[0])
  const drafts = req.payload.config.collections?.find(c => c.slug === collection)?.versions
  return doc && (!(drafts && drafts.drafts) || doc._status === 'published') ? doc : undefined
}
