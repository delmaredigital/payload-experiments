import type { PreflightResult } from '../types/endpoints.js'

type Placement = PreflightResult['placements'][number]
export type PreviewPage = Placement & { key: string; slotCount: number }

/** Localized responses are already grouped by the server. Legacy single-language
 * responses contain occurrences; preserve their page grouping and version counts. */
export function placementPages(placements: readonly Placement[], flagPoint?: string): PreviewPage[] {
  if (placements.some(placement => placement.allLocales || placement.locales?.length)) {
    return placements.map((placement, index) => ({ ...placement, key: String(index), slotCount: placement.slotCount ?? 1 }))
  }
  const pages = new Map<string, { page: PreviewPage; versions: Map<Placement['detail'], number> }>()
  for (const [index, placement] of placements.entries()) {
    const key = `${placement.collection}\u0000${String(placement.id)}${placement.collection === flagPoint ? `\u0000${index}` : ''}`
    const existing = pages.get(key)
    if (existing) {
      const { page, versions } = existing
      if (!page.editorUrl && placement.editorUrl) page.editorUrl = placement.editorUrl
      const count = (versions.get(placement.detail) ?? 0) + 1
      versions.set(placement.detail, count)
      page.slotCount = Math.max(page.slotCount, count)
      if (!page.url && placement.url) page.url = placement.url
    } else {
      pages.set(key, {
        page: { ...placement, key, slotCount: placement.slotCount ?? 1 },
        versions: new Map([[placement.detail, 1]]),
      })
    }
  }
  return [...pages.values()].map(({ page }) => page)
}

