import { findNormalisedPathKey, normalisePath } from '../runtime/normalisePath.js'
import type { Metadata } from 'next'
import type { ExperimentsServerRuntime } from '../types/runtime.js'
import { headers } from 'next/headers.js'
import { serverRequest } from './request.js'
import { serverManifest } from './context.js'

/**
 * Reads the signed request context via `headers()`, so it decides from the URL the visitor requested, not the
 * rewritten route. Call it only from a dynamic `generateMetadata`, never inside `'use cache'`. `path` is the
 * fallback when the proxy did not run.
 */
export async function experimentMetadata<TUser extends { id: string | number } = { id: string | number }>(serverRuntime: ExperimentsServerRuntime<TUser>, path: string): Promise<Pick<Metadata, 'robots' | 'alternates'>> {
  const { request, hasContext } = serverRequest(new Headers(await headers()), serverRuntime.proxyRuntime.secrets)
  if (hasContext) path = request.nextUrl.pathname
  const manifest = await serverManifest(serverRuntime.proxyRuntime)
  const live = manifest?.experiments.find(e => e.kind === 'page' && e.arms.some(a => a.pageTarget !== undefined && normalisePath(a.pageTarget) === normalisePath(path)))
  if (live) {
    const controlPath = live.arms.find(a => a.kind === 'control')?.pageTarget
    if (!controlPath) return {}
    // The Original's URL may be served with a variant's route: its canonical must stay on the Original,
    // never the (noindexed) variant route the host would otherwise derive.
    return normalisePath(path) !== normalisePath(controlPath) ? { robots: { index: false }, alternates: { canonical: controlPath } } : { alternates: { canonical: controlPath } }
  }
  const archivedPath = manifest ? findNormalisedPathKey(manifest.archivedPages, path) : undefined
  const archived = archivedPath === undefined ? undefined : manifest?.archivedPages[archivedPath]
  return archived ? { alternates: { canonical: archived.winnerPath } } : {}
}
