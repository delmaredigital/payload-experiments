import { findNormalisedPathKey, normalisePath } from '../runtime/normalisePath.js'
import type { Metadata } from 'next'
import type { ExperimentsServerRuntime } from '../types/runtime.js'
import { serverManifest } from './context.js'

export async function experimentMetadata<TUser extends { id: string | number } = { id: string | number }>(serverRuntime: ExperimentsServerRuntime<TUser>, path: string): Promise<Pick<Metadata, 'robots' | 'alternates'>> {
  const manifest = await serverManifest(serverRuntime.proxyRuntime)
  const live = manifest?.experiments.find(e => e.kind === 'page' && e.arms.some(a => a.pageTarget !== undefined && normalisePath(a.pageTarget) === normalisePath(path)))
  if (live) {
    const controlPath = live.arms.find(a => a.kind === 'control')?.pageTarget
    return controlPath && normalisePath(path) !== normalisePath(controlPath) ? { robots: { index: false }, alternates: { canonical: controlPath } } : {}
  }
  const archivedPath = manifest ? findNormalisedPathKey(manifest.archivedPages, path) : undefined
  const archived = archivedPath === undefined ? undefined : manifest?.archivedPages[archivedPath]
  return archived ? { alternates: { canonical: archived.winnerPath } } : {}
}
