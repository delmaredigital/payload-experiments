import type { DocId } from '../../types/contracts.js'
import { RESULTS_COPY } from '../copy/results.js'

export interface PageReleaseDecision {
  winnerArm?: string | null
  discardedAt?: string | null
  pagesReleasedAt?: string | null
  pagesReleasedBy?: string | null
}

/** Mirrors the release-pages transition's gate; permission is checked by the caller. */
export function canReleasePages(doc: { kind?: string; status: string; decision?: PageReleaseDecision | null }): boolean {
  const decision = doc.decision
  return doc.kind === 'page' && doc.status === 'archived' && Boolean(decision?.winnerArm)
    && !decision?.discardedAt && !decision?.pagesReleasedAt
}

export function pagesReleasedBy(by: string | null | undefined, currentUserId?: DocId | null,
  author?: { name?: string | null; email?: string | null } | null): string | undefined {
  if (by == null) return undefined
  if (currentUserId != null && by === String(currentUserId)) return RESULTS_COPY.you
  return author?.name ?? author?.email ?? undefined
}
