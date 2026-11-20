import { DELETE_TEST as D } from '../copy/testPage.js'
import type { DocId } from '../../types/contracts.js'
import type { PreflightResult } from '../../types/endpoints.js'
import { formatAdminURL } from '../format/adminURL.js'

import { placementDetail } from './placementLabels.model.js'
export { placementDetailKey, placementDetail, fallbackPlacementLabel } from './placementLabels.model.js'
export type { PlacementLabel } from './placementLabels.model.js'
import type { PlacementLabel } from './placementLabels.model.js'
export function resolvedPlacementLabel(value: unknown, match: { id?: DocId | null; title?: string; editorUrl?: string; locales?: string[]; allLocales?: true } | undefined, adminRoute: string): PlacementLabel {
  const detail = placementDetail(value)
  const id = match?.id ?? detail.id
  return { title: `${match?.title?.trim() || detail.path || 'This page'}${match?.allLocales ? ` · ${D.allLocales}` : match?.locales?.length ? ` · ${D.locales(match.locales.join(', '))}` : ''}`,
    ...(id != null && detail.collection ? { href: match?.editorUrl || formatAdminURL({ adminRoute, path: `/collections/${encodeURIComponent(detail.collection)}/${encodeURIComponent(String(id))}` }) } : {}) }
}
export function preflightPlacementLabel(value: unknown, preflight: PreflightResult, adminRoute: string): PlacementLabel {
  const detail = placementDetail(value)
  const match = detail.collection ? detail.id != null
    ? preflight.placements.find(item => item.collection === detail.collection && String(item.id) === String(detail.id))
    : typeof detail.path === 'string' ? preflight.pagePlacements?.find(item => item.collection === detail.collection && item.path === detail.path) : undefined : undefined
  return resolvedPlacementLabel(value, match, adminRoute)
}
