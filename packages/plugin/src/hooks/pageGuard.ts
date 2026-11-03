import type { CollectionAfterOperationHook, CollectionBeforeChangeHook, CollectionBeforeDeleteHook, CollectionBeforeOperationHook, PayloadRequest } from 'payload'
import { previousPublishedContent } from '../db/appends.js'
import { XpRefusal } from '../errors.js'
import { pageGuardCopy, READINESS_COPY } from '../admin/copy/readiness.js'
import type { Arm, DocId, ResolvedOptions } from '../types/contracts.js'

// beforeChange has no draft argument. Each operation owns a frame, including
// nested same-collection updates and restores on a reused Local API request.
type Operations = Map<string, Array<{ draft: boolean; restore: boolean }>>
// createLocalReq replaces context with a shallow copy on nested calls. Keep
// the shared stack in that context so both the outer req and its proxies see it.
const operations = (req: PayloadRequest) => req.context.xpPageGuardOperations as Operations | undefined
export const pageGuardBeforeOperation: CollectionBeforeOperationHook = ({ args, operation }) => {
  if (operation !== 'update' && operation !== 'restoreVersion') return
  const call = args as { req: PayloadRequest; draft?: boolean; collection: { config: { slug: string } } }
  let collections = operations(call.req)
  if (!collections) call.req.context.xpPageGuardOperations = collections = new Map()
  const slug = call.collection.config.slug
  const stack = collections.get(slug) ?? []
  stack.push({ draft: call.draft === true, restore: operation === 'restoreVersion' })
  collections.set(slug, stack)
}
export const pageGuardAfterOperation: CollectionAfterOperationHook = ({ req, collection, operation, result }) => {
  if (operation === 'update' || operation === 'restoreVersion') {
    const collections = operations(req)
    const stack = collections?.get(collection.slug)
    stack?.pop()
    if (!stack?.length) collections?.delete(collection.slug)
  }
  return result
}

async function protect(req: PayloadRequest, path: string): Promise<void> {
  // page guard: the hook must see test placements regardless of the editor's access
  const tests = await req.payload.find({ collection: 'xp-experiments', req, overrideAccess: true,
    depth: 0, limit: 0, where: { and: [{ kind: { equals: 'page' } }, { status: { in: ['running', 'decided', 'archived'] } }] },
  })
  for (const test of tests.docs) {
    const decision = test.decision as { winnerArm?: string | null; discardedAt?: string | null } | undefined
    const archived = test.status === 'archived'
    if (archived && (!decision?.winnerArm || decision.discardedAt)) continue
    // page guard: the hook must see test placements regardless of the editor's access
    const phases = await req.payload.find({ collection: 'xp-phases', req, overrideAccess: true,
      depth: 0, limit: 1, sort: '-phase', where: { experiment: { equals: test.id }, phaseKind: { equals: 'test' } },
    })
    const phase = phases.docs[0]
    if (!phase) throw new XpRefusal('invalid-phase', READINESS_COPY.missingVersions, { experimentId: test.id }, 409)
    const arms = phase.arms as Arm[]
    const protectedArms = archived ? arms.filter(arm => arm.kind === 'control' || arm.key === decision!.winnerArm) : arms
    if (protectedArms.some(arm => arm.pageTarget === path)) {
      throw new XpRefusal('locked-placement', pageGuardCopy(String(test.name), test.status as 'running' | 'decided' | 'archived'), { experimentId: test.id }, 409)
    }
  }
}

function registration(req: PayloadRequest, slug: string) {
  return (req.payload.config.custom?.xp as ResolvedOptions).pages?.collections.find(entry => entry.slug === slug)
}

export const pageGuardBeforeDelete: CollectionBeforeDeleteHook = async ({ req, id, collection }) => {
  const page = registration(req, collection.slug)
  if (!page) return
  const published = await previousPublishedContent(req, collection.slug, id)
  if (!published || published._status === 'draft') return
  const path = page.pathOf(published)
  if (path !== null) await protect(req, path)
}

export const pageGuardBeforeChange: CollectionBeforeChangeHook = async ({ req, collection, originalDoc, operation, data }) => {
  if (operation !== 'update') return data
  const page = registration(req, collection.slug)
  if (!page) return data
  const drafts = Boolean(collection.versions && collection.versions.drafts)
  // updateDocument computes isSavingDraft from draftArg and _status before
  // beforeChange, and writes the main row only when !isSavingDraft.
  const call = operations(req)?.get(collection.slug)?.at(-1)
  if (drafts && call?.draft && (call.restore || data._status !== 'published')) return data
  const published = await previousPublishedContent(req, collection.slug, originalDoc.id as DocId)
  if (!published || published._status === 'draft') return data
  const path = page.pathOf(published)
  const unpublishing = drafts && data._status === 'draft'
  const trashing = collection.trash && data.deletedAt != null && !originalDoc.deletedAt
  if (path !== null && (trashing || unpublishing || page.pathOf({ ...originalDoc, ...data }) !== path)) await protect(req, path)
  return data
}
