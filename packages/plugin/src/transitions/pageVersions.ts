import { isDeepStrictEqual } from 'node:util'
import type { PayloadRequest } from 'payload'
import type { Arm, ExperimentsPageCollection } from '../types/contracts.js'
import { pageVersionContent } from '../db/pageContent.js'

/** Page copies have fresh nested row ids and editor labels; neither is rendered content. */
export function comparableContent(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(comparableContent)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key]) => key !== 'id' && key !== 'blockName').map(([key, nested]) => [key, comparableContent(nested)]))
  return value
}

export async function identicalPageVersions(req: PayloadRequest, collection: ExperimentsPageCollection | undefined, arms: Arm[]) {
  if (!collection?.contentOf) return []
  const content = await Promise.all(arms.filter(arm => arm.kind !== 'holdout' && arm.pageTarget).map(async arm => {
    const page = await collection.findByPath(arm.pageTarget!, req)
    if (!page?.published) return null
    const raw = await pageVersionContent(req, collection.slug, page.id)
    if (!raw || raw._status === 'draft') return null
    return { arm, id: page.id, value: comparableContent(collection.contentOf!(raw)) }
  }))
  const control = content.find(row => row?.arm.kind === 'control')
  if (!control) return []
  return content.flatMap(row => row && row.arm.kind === 'variant' && isDeepStrictEqual(row.value, control.value)
    ? [{ arm: row.arm.key, path: row.arm.pageTarget!, collection: collection.slug, id: row.id }] : [])
}
