import type { PreflightResult } from '../types/endpoints.js'

type Placement = PreflightResult['placements'][number]
type PreviewPage = Pick<Placement, 'collection' | 'id' | 'title' | 'url'> & { key: string; slotCount: number }

/** Preview URLs identify pages; counts use the most placements in any one version. */
export function previewPages(placements: readonly Placement[]): PreviewPage[] {
  const pages = new Map<string, { page: PreviewPage; versions: Map<Placement['detail'], number> }>()
  for (const placement of placements) {
    const key = `${placement.collection}\u0000${String(placement.id)}`
    const existing = pages.get(key)
    if (existing) {
      const { page, versions } = existing
      const count = (versions.get(placement.detail) ?? 0) + 1
      versions.set(placement.detail, count)
      page.slotCount = Math.max(page.slotCount, count)
      if (!page.url && placement.url) page.url = placement.url
    } else {
      pages.set(key, {
        page: { key, collection: placement.collection, id: placement.id, title: placement.title,
          url: placement.url, slotCount: 1 },
        versions: new Map([[placement.detail, 1]]),
      })
    }
  }
  return [...pages.values()].map(({ page }) => page)
}
