import type { Manifest } from '../types/manifest.js'

/** Build-time filter: pass a server-loaded manifest when generating the sitemap. */
export function experimentSitemapFilter(path: string, manifest: Manifest): boolean {
  const live = manifest.experiments.find(e => e.kind === 'page' && e.arms.some(a => a.pageTarget === path))
  if (live) return live.arms.find(a => a.kind === 'control')?.pageTarget === path
  return !Object.hasOwn(manifest.archivedPages, path)
}
