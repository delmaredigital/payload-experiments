import type { DocId } from '../../types/contracts.js'
export type PlacementDetail = { collection?: string; id?: DocId; path?: string }
export type PlacementLabel = { title: string; href?: string }
export const placementDetail = (detail: unknown): PlacementDetail => detail && typeof detail === 'object' && !Array.isArray(detail) ? detail as PlacementDetail : {}
export function placementDetailKey(value: unknown): string {
  const detail = placementDetail(value)
  return JSON.stringify([detail.collection, detail.id == null ? null : String(detail.id), detail.path])
}
export const fallbackPlacementLabel = (value: unknown): PlacementLabel => ({ title: placementDetail(value).path || 'This page' })
