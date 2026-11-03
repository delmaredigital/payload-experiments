import type { PreflightResult } from '../types/endpoints.js'

type Placement = PreflightResult['placements'][number]
type PreviewPage = Pick<Placement, 'collection' | 'id' | 'title' | 'url'> & { key: string; slotCount: number }

/** Preview URLs identify pages; readiness still checks every placement separately. */
export function previewPages(placements: readonly Placement[]): PreviewPage[] {
  const pages = new Map<string, PreviewPage>()
  for (const placement of placements) {
    const key = `${placement.collection}\u0000${String(placement.id)}`
    const page = pages.get(key)
    if (page) {
      page.slotCount++
      if (!page.url && placement.url) page.url = placement.url
    } else {
      pages.set(key, { key, collection: placement.collection, id: placement.id, title: placement.title,
        url: placement.url, slotCount: 1 })
    }
  }
  return [...pages.values()]
}
