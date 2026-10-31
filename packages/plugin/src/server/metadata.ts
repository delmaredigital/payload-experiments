import type { Metadata } from 'next'
import type { ExperimentsServerRuntime } from '../types/runtime.js'
import { serverManifest } from './context.js'

export async function experimentMetadata<TUser extends { id: string | number } = { id: string | number }>(serverRuntime: ExperimentsServerRuntime<TUser>, path: string): Promise<Pick<Metadata, 'robots' | 'alternates'>> {
  const manifest = await serverManifest(serverRuntime.proxyRuntime)
  const live = manifest?.experiments.find(e => e.kind === 'page' && e.arms.some(a => a.pageTarget === path))
  if (live) {
    const controlPath = live.arms.find(a => a.kind === 'control')?.pageTarget
    return controlPath && path !== controlPath ? { robots: { index: false }, alternates: { canonical: controlPath } } : {}
  }
  const archived = manifest && Object.hasOwn(manifest.archivedPages, path) ? manifest.archivedPages[path] : undefined
  return archived ? { alternates: { canonical: archived.winnerPath } } : {}
}
