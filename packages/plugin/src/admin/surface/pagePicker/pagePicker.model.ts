import type { Arm, DocId } from '../../../types/contracts.js'
import type { PagesResult, PreflightResult } from '../../../types/endpoints.js'
import type { TestsSurfaceProps } from '../../../types/surface.js'
import { normalisePath } from '../../../runtime/normalisePath.js'
import { PAGE_COPY, usedAddressCopy, usedPageCopy } from '../../copy/pages.js'
import { actionGroupLabel } from '../../actions/actions.model.js'

export type PageRow = PagesResult['docs'][number]
export type PageCollection = NonNullable<TestsSurfaceProps['pageCollections']>[number]
export type PageSelections = Partial<Record<Arm['key'], { id: DocId; path: string }>>
/** The server resolves legacy collections; the client consumes its placements verbatim. */
export function testPageCollection(collections: readonly PageCollection[] | undefined, doc: { pageCollection?: string | null }, placements: PreflightResult['pagePlacements']) {
  const slug = doc.pageCollection || placements?.find(entry => entry.collection)?.collection
  return collections?.find(entry => entry.slug === slug)
}
export const controlFirst = (arms: readonly Arm[]) => [...arms].sort((a, b) => Number(b.kind === 'control') - Number(a.kind === 'control'))
/** Identity wins over address, so distinct documents sharing an address get actionable copy. */
export function disabledPageReason(row: PageRow, ownKey: string, arms: readonly Arm[], placements: PreflightResult['pagePlacements'], chosen: PageSelections, collection: string, collectionSlug?: string): string | null {
  if (row.path === null || row.pathKey === null) return PAGE_COPY.noPath
  const others = controlFirst(arms).filter(arm => arm.key !== ownKey && arm.kind !== 'holdout')
  for (const arm of others) {
    const selection = chosen[arm.key]
    const remembered = selection && arm.pageTarget && normalisePath(selection.path) === normalisePath(arm.pageTarget) ? selection.id : undefined
    const id = remembered ?? placements?.find(entry => entry.arm === arm.key && (!collectionSlug || entry.collection === collectionSlug))?.id
    if (id != null ? String(id) === String(row.id) : Boolean(arm.pageTarget && normalisePath(arm.pageTarget) === row.pathKey)) {
      return usedPageCopy(actionGroupLabel(arm.key, arm.label))
    }
  }
  const same = others.find(arm => arm.pageTarget && normalisePath(arm.pageTarget) === row.pathKey)
  return same ? usedAddressCopy(actionGroupLabel(same.key, same.label), row.path, collection) : null
}
/** Pure request revision comparison, also used after an aborted transport resolves. */
export const isLatestPageRequest = (response: number, latest: number) => response === latest
