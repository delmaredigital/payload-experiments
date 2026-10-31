import { normalisePath } from '../runtime/normalisePath.js'
import type { Manifest } from '../types/manifest.js'

/** Build-time filter: pass a server-loaded manifest when generating the sitemap. */
export function experimentSitemapFilter(path: string, manifest: Manifest): boolean {
  const live = manifest.experiments.find(e => e.kind === 'page' && e.arms.some(a => a.pageTarget !== undefined && normalisePath(a.pageTarget) === normalisePath(path)))
  if (live) return live.arms.some(a => a.kind === 'control' && a.pageTarget !== undefined && normalisePath(a.pageTarget) === normalisePath(path))
  return !Object.hasOwn(manifest.archivedPages, path)
}
