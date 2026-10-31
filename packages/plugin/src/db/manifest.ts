import type { Executor } from './executor.js'
import { readState } from './state.js'
import type { Manifest } from '../types/manifest.js'

export async function readManifestRow(exec: Executor, options: { schemaName?: string } = {}): Promise<{ revision: number; manifest: Manifest } | null> {
  const row = await readState(exec, options)
  return row?.manifest ? { revision: row.revision, manifest: row.manifest } : null
}
