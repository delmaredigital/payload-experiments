import type { Manifest } from '../types/manifest.js'
import { sign } from '../runtime/signing.js'
import { normalisePath } from '../runtime/normalisePath.js'

export interface PageKindSeoContractOptions {
  secret: string; original: string; versions: string[]; state: 'running' | 'decided' | 'archived'; winner?: string
}
export interface PageKindSeoContractRow {
  requestPath: string; servedPath: string; headers: { 'x-xp-request': string }
  expect: { robots?: { index: false }; canonical?: string; inSitemap: boolean }
}

/** Host-test fixture: use this manifest in the runtime that serves the signed row headers. */
export function pageKindSeoContract({ secret, original, versions, state, winner }: PageKindSeoContractOptions): { manifest: Manifest; rows: PageKindSeoContractRow[] } {
  const paths = [original, ...versions]
  if (!secret || paths.some(path => !path.startsWith('/') || /[\\\r\n#|]/.test(path)) || new Set(paths.map(normalisePath)).size !== paths.length
    || !versions.length || versions.length > 3 || state !== 'running' && (!winner || !paths.includes(winner))) throw new Error('Invalid page SEO contract')
  const manifest: Manifest = { v: 1, revision: 1, experiments: [], flagDefaults: {}, archivedWinners: {}, archivedPages: {} }
  if (state === 'archived') {
    for (const path of paths) if (path !== winner) manifest.archivedPages[path] = { slug: 'page-seo-contract', winnerPath: winner! }
  } else {
    manifest.experiments.push({ id: 'page-seo-contract', slug: 'page-seo-contract', kind: 'page', unitType: 'visitor', status: state,
      phase: 1, phaseKind: 'test', seed: 'page-seo-contract|', coverage: 1, targeting: [], exposurePolicy: 'pageview', deferrable: false,
      arms: paths.map((path, index) => ({ key: index === 0 ? 'control' : `variant${String.fromCharCode(64 + index)}` as 'variantA' | 'variantB' | 'variantC',
        kind: index === 0 ? 'control' : 'variant', weight: index === paths.length - 1 ? 100 - Math.floor(100 / paths.length) * index : Math.floor(100 / paths.length), pageTarget: path })),
      ...(winner ? { winnerArm: paths.indexOf(winner) === 0 ? 'control' : `variant${String.fromCharCode(64 + paths.indexOf(winner))}` } : {}) })
  }
  const rows: PageKindSeoContractRow[] = []
  for (const requestPath of paths) {
    const servedPaths = state === 'running' ? paths : [winner!]
    for (const servedPath of servedPaths) {
      const canonical = state === 'archived' ? requestPath === winner ? undefined : winner : original
      rows.push({ requestPath, servedPath, headers: { 'x-xp-request': `GET|${requestPath}|c1|${sign(`xp:request:GET|${requestPath}|c1`, [secret])}` },
        expect: { ...(state !== 'archived' && requestPath !== original ? { robots: { index: false as const } } : {}),
          ...(canonical ? { canonical } : {}), inSitemap: state === 'archived' ? requestPath === winner : requestPath === original } })
    }
  }
  return { manifest, rows }
}
