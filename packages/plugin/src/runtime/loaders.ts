import type { Pool } from 'pg'
import type { ExperimentsProxyRuntimeOptions } from '../types/runtime.js'
import { XpNotImplemented } from '../errors.js'

export type ManifestLoader = NonNullable<ExperimentsProxyRuntimeOptions['loadManifest']>
export interface PostgresManifestLoaderOptions { pool: Pool; schemaName?: string }
export interface HttpManifestLoaderOptions { url: string; key: string }

export function createPostgresManifestLoader(_options: PostgresManifestLoaderOptions): ManifestLoader {
  throw new XpNotImplemented('CORE-05')
}
export function createHttpManifestLoader(_options: HttpManifestLoaderOptions): ManifestLoader {
  throw new XpNotImplemented('CORE-05')
}
