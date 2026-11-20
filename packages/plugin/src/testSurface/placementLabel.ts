import type { PreflightResult } from '../types/endpoints.js'
import { placementLanguageSuffix } from './copy/languages.js'

type Placement = PreflightResult['placements'][number]
/** Shared row identity. Legacy previews and edit links omit publication state;
 * Binding already showed it on single-language sites. */
export function placementLabel(placement: Placement, showState = Boolean(placement.allLocales || placement.locales?.length), states = [placement.detail === 'Published' ? 'Published' : 'Draft']): string {
  return `${placement.title}${showState ? ` (${states.join(', ')})` : ''}${placementLanguageSuffix(placement)}`
}

/** A shared editor link describes the union of its rows, retaining their first page title. */
export function placementGroupLabel(placements: readonly Placement[], configuredLanguages?: readonly string[]): string {
  const first = placements[0]!
  const locales = [...new Set(placements.flatMap(row => row.locales ?? []))]
  const allLocales = placements.some(row => row.allLocales) || Boolean(configuredLanguages?.length && configuredLanguages.every(name => locales.includes(name)))
  const states = [...new Set(placements.map(row => row.detail === 'Published' ? 'Published' : 'Draft'))]
  return placementLabel({ ...first, locales, ...(allLocales ? { allLocales: true } : {}) }, true, states)
}
