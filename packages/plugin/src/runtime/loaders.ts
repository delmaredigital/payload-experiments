import type { Pool } from 'pg'
import type { ExperimentsProxyRuntimeOptions } from '../types/runtime.js'
import { pgPoolExecutor } from '../db/pgExecutor.js'
import { readManifestRow } from '../db/manifest.js'
import type { Manifest } from '../types/manifest.js'

export type ManifestLoader = NonNullable<ExperimentsProxyRuntimeOptions['loadManifest']>
export interface PostgresManifestLoaderOptions { pool: Pool; schemaName?: string }
export interface HttpManifestLoaderOptions { url: string; key: string; refreshTimeoutMs?: number }

/** Hosts must set connectionTimeoutMillis on their pg pool to bound connection
 * acquisition; the manifest cache's refresh ceiling does not cancel pg work.
 */
export function createPostgresManifestLoader({ pool, schemaName }: PostgresManifestLoaderOptions): ManifestLoader {
  return async ({ ifRevision } = {}) => {
    const row = await readManifestRow(pgPoolExecutor(pool), { schemaName })
    return row ? row.revision === ifRevision ? 'not-modified' : row.manifest : null
  }
}
export function createHttpManifestLoader({ url, key, refreshTimeoutMs = 5_000 }: HttpManifestLoaderOptions): ManifestLoader {
  return async ({ ifRevision } = {}) => {
    const response = await fetch(url, { headers: {
      'x-xp-manifest-key': key,
      ...(ifRevision != null ? { 'if-none-match': String(ifRevision) } : {}),
    }, signal: AbortSignal.timeout(refreshTimeoutMs), cache: 'no-store' })
    if (response.status === 304) return 'not-modified'
    if (!response.ok) throw new Error(`Manifest request failed (${response.status})`)
    return await response.json() as Manifest
  }
}
