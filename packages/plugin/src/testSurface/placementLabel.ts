import type { PreflightResult } from '../types/endpoints.js'
import { PLACEMENT_LANGUAGES } from './copy/languages.js'

/** Shared row identity. Legacy previews and edit links omit publication state;
 * Binding already showed it on single-language sites. */
export function placementLabel(placement: PreflightResult['placements'][number], showState = Boolean(placement.allLocales || placement.locales?.length)): string {
  return `${placement.title}${showState ? ` (${placement.detail === 'Published' ? 'Published' : 'Draft'})` : ''}${placement.allLocales ? ` · ${PLACEMENT_LANGUAGES.allLocales}` : placement.locales?.length ? ` · ${PLACEMENT_LANGUAGES.locales(placement.locales.join(', '))}` : ''}`
}
