import type { PreflightResult } from '../../types/endpoints.js'
import type { Status } from '../../types/contracts.js'
import { SAVE_PAGE, PUBLISH_PAGE, RUNNING_PUBLISH_PAGE, RUNNING_SAVE_PAGE } from '../copy/readiness.js'
import { blockingSteps, pageReadinessContext } from './readiness/readiness.model.js'
import { READINESS_COPY } from '../copy/readiness.js'
import type { TestDocApi, SurfaceProps } from './contracts.js'
export { SAVE_PAGE, PUBLISH_PAGE, RUNNING_PUBLISH_PAGE, RUNNING_SAVE_PAGE } from '../copy/readiness.js'

/** Replace only the guidance represented by this page's local notice. */
export function editorPlacementChecks(checks: PreflightResult['checks'], page: NonNullable<SurfaceProps['editorPage']>): PreflightResult['checks'] {
  return checks.flatMap(check => {
    if (check.code === 'no-placements') return []
    if (check.code !== 'placement-unpublished' || check.ok) return [check]
    const detail = (Array.isArray(check.detail) ? check.detail : [check.detail]).filter(value => {
      if (!value || typeof value !== 'object') return true
      const row = value as { collection?: unknown; id?: unknown }
      return row.collection !== page.collection || String(row.id) !== String(page.id)
    })
    return detail.length ? [{ ...check, detail }] : []
  })
}

/** Editor context is a hint for guidance only; Start still runs server preflight. */
export function editorPlacementMessage(placements: PreflightResult['placements'] | undefined, page: SurfaceProps['editorPage'], status: Status | undefined): string | undefined {
  if (!page || !placements || !status || status === 'decided' || status === 'archived') return
  const here = placements.filter(p => p.collection === page.collection && String(p.id) === String(page.id))
  if (!here.length) return status === 'running' ? RUNNING_SAVE_PAGE : SAVE_PAGE
  if (!here.some(p => p.detail === 'Published')) return status === 'running' ? RUNNING_PUBLISH_PAGE : PUBLISH_PAGE
}

/** Replace this page's checks once, retaining every other page's blocker. */
export function editorPreflight(answer: PreflightResult | null, surface: SurfaceProps, includeLocalBlocker = true) {
  return answer && surface.editorPlacementMessage && surface.editorPage ? { ...answer, checks: [
    ...editorPlacementChecks(answer.checks, surface.editorPage),
    ...(includeLocalBlocker ? [{ code: 'no-placements' as const, ok: false }] : []),
  ] } : answer
}

/** Shared sidebar policy; the bounded list renders these steps verbatim. */
export function sidebarReadinessBlockers(test: TestDocApi, surface: SurfaceProps) {
  const answer = editorPreflight(test.preflight, surface, false)
  const blockers = test.doc ? blockingSteps(answer, pageReadinessContext(test.doc, test.preflight, surface)) : []
  const notice = test.preflightRead?.message ?? surface.editorPlacementMessage
  return test.hasUnsaved ? [{ sentence: READINESS_COPY.saveFirst }, ...blockers]
    : !answer && !notice ? [{ sentence: READINESS_COPY.checking }] : blockers.filter(step => step.sentence !== notice)
}
