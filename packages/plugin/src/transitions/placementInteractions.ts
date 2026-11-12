import type { PayloadRequest } from 'payload'
import type { Arm, DocId, ResolvedOptions } from '../types/contracts.js'
import type { Executor } from '../db/executor.js'
import { placementPathContent, placementTests, type PlacementDoc, type PlacementTest } from '../db/placements.js'
import { lockPagePaths } from '../db/locks.js'
import { normalisePath } from '../runtime/normalisePath.js'
import { scanBlockPlacements, type BlockPlacement } from './placements.js'
import { interactingTestsCopy } from '../testSurface/copy/readiness.js'
import { XpRefusal } from '../errors.js'
import { pageTargetPaths } from './checkStart.js'

export async function detached<T>(req: PayloadRequest, fn: () => Promise<T>): Promise<T> {
  const transactionID = req.transactionID
  delete req.transactionID
  try { return await fn() } finally { req.transactionID = transactionID }
}
export function uniquePlacementDocs(placements: readonly Pick<BlockPlacement, 'collection' | 'id'>[]): PlacementDoc[] {
  return [...new Map(placements.map(p => [JSON.stringify([p.collection, String(p.id)]), { collection: p.collection, id: p.id }])).values()]
}
export function scanPlacements<TUser extends { id: DocId }>(req: PayloadRequest, options: ResolvedOptions<TUser>, slug: string) {
  return scanBlockPlacements(req, { slug, puckCollections: options.puck?.collections ?? [], blocksCollections: options.blocks?.collections ?? [] })
}
export async function placementPaths<TUser extends { id: DocId }>(req: PayloadRequest, options: ResolvedOptions<TUser>, docs: readonly PlacementDoc[]): Promise<string[]> {
  const paths = new Set<string>()
  for (const doc of docs) {
    const registration = options.pages?.collections.find(r => r.slug === doc.collection)
    if (!registration) continue
    const row = await placementPathContent(req, doc.collection, doc.id)
    if (!row || row._status === 'draft') continue
    const path = registration.pathOf(row)
    if (path !== null) paths.add(normalisePath(path))
  }
  return [...paths].sort()
}
export interface InteractionDetail { experimentId: DocId; slug: string; name: string; status: string; path: string; version: boolean }
const active = (test: PlacementTest) => test.status === 'running' || test.status === 'decided'
export async function placementInteractions<TUser extends { id: DocId }>(req: PayloadRequest, exec: Executor, options: ResolvedOptions<TUser>, experiment: { id: DocId; kind: string; arms: Arm[]; pageCollection?: string | null }, paths: string[]): Promise<InteractionDetail[]> {
  const result: InteractionDetail[] = []
  for (const test of await placementTests(exec)) {
    if (!active(test) || String(test.id) === String(experiment.id)) continue
    if (experiment.kind === 'block' && test.kind === 'page') {
      for (const path of paths.filter(path => pageTargetPaths(test.arms).includes(path))) result.push({ experimentId: test.id, slug: test.slug, name: test.name, status: test.status, path, version: test.arms.some(a => a.kind === 'variant' && a.pageTarget && normalisePath(a.pageTarget) === path) })
    } else if (experiment.kind === 'page' && test.kind === 'block') {
      const docs = test.placementDocs ?? uniquePlacementDocs(await detached(req, () => scanPlacements(req, options, test.slug)))
      const relevant = docs.filter(doc => !experiment.pageCollection || doc.collection === experiment.pageCollection)
      for (const path of (await placementPaths(req, options, relevant)).filter(path => paths.includes(path))) result.push({ experimentId: test.id, slug: test.slug, name: test.name, status: test.status, path, version: experiment.arms.some(a => a.kind === 'variant' && a.pageTarget && normalisePath(a.pageTarget) === path) })
    }
  }
  return result
}
export async function lockAndRescanPlacements<TUser extends { id: DocId }>(req: PayloadRequest, exec: Executor, options: ResolvedOptions<TUser>, experiment: { id: DocId; slug: string; kind: string; arms: Arm[] }, before: readonly BlockPlacement[]) {
  const paths = await placementPaths(req, options, uniquePlacementDocs(before))
  await lockPagePaths(exec, paths)
  const placements = await detached(req, () => scanPlacements(req, options, experiment.slug))
  const docs = uniquePlacementDocs(placements)
  const afterPaths = await placementPaths(req, options, docs)
  if (afterPaths.some(path => !paths.includes(path))) throw new XpRefusal('placements-changed', "This test's pages changed while it was starting. Try again.", undefined, 409)
  const conflicts = await placementInteractions(req, exec, options, experiment, paths)
  if (conflicts.length) throw new XpRefusal('interacting-tests', interactingTestsCopy(conflicts[0]!.path, conflicts[0]!.status, conflicts[0]!.name, conflicts[0]!.version), conflicts, 409)
  return { placements, docs }
}
