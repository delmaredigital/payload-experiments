import type { PreflightResult } from '../types/endpoints.js'
import { placementPages, type PreviewPage } from '../lib/placementPages.js'

type Placement = PreflightResult['placements'][number]

/** Pages that offer something to do: a preview or an editor link. The section is hidden when none do. */
export function actionablePreviewPages(placements: readonly Placement[], flagPoint?: string): PreviewPage[] {
  return placementPages(placements, flagPoint).filter(page => page.url || page.editorUrl)
}
