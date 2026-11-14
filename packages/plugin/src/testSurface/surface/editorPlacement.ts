import type { PreflightResult } from '../../types/endpoints.js'
import type { SurfaceProps } from './contracts.js'

export const SAVE_PAGE = 'Save this page to put the test on it.'
export const PUBLISH_PAGE = 'Publish this page to start the test.'

/** Editor context is a hint for guidance only; Start still runs server preflight. */
export function editorPlacementMessage(placements: PreflightResult['placements'] | undefined, page: SurfaceProps['editorPage']): string | undefined {
  if (!page || !placements) return
  const here = placements.filter(p => p.collection === page.collection && String(p.id) === String(page.id))
  if (!here.length) return SAVE_PAGE
  if (!here.some(p => p.detail === 'Published')) return PUBLISH_PAGE
}
