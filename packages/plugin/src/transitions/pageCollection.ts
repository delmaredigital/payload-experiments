import { safeError } from '../log.js'
import type { PayloadRequest } from 'payload'
import type { ExperimentsPageCollection, ResolvedOptions } from '../types/contracts.js'

/** A stored collection is authoritative. Legacy tests fall back by the Original's path. */
export async function resolvePageCollection(req: PayloadRequest, options: Pick<ResolvedOptions, 'pages'>,
  experiment: { pageCollection?: string | null; arms: readonly { kind?: string; pageTarget?: string }[] }, propagateErrors = false): Promise<ExperimentsPageCollection | undefined> {
  const collections = options.pages?.collections ?? []
  if (experiment.pageCollection) return collections.find(entry => entry.slug === experiment.pageCollection)
  if (collections.length === 1) return collections[0]
  const path = experiment.arms.find(arm => arm.kind === 'control')?.pageTarget
  if (!path) return undefined
  for (const entry of collections) {
    try { if (await entry.findByPath(path, req)) return entry }
    catch (cause) { if (propagateErrors) throw cause; req.payload.logger.error({ err: safeError(cause), collection: entry.slug }, 'Experiment page lookup failed') }
  }
  return undefined
}
