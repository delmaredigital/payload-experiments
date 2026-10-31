import type { PayloadRequest } from 'payload'
import type { EndpointContext, ErrorEnvelope } from '../types/endpoints.js'
import { pooledExecutor } from '../db/executor.js'
import { readManifestRow } from '../db/manifest.js'
export async function handleManifest<TUser extends { id: string | number } = { id: string | number }>(req: PayloadRequest, _ctx: EndpointContext<TUser>): Promise<Response> {
  const row = await readManifestRow(pooledExecutor(req.payload))
  if (!row) return Response.json({ errors: [{ code: 'not-found', message: 'Manifest not found' }] } satisfies ErrorEnvelope, { status: 404, headers: { 'Cache-Control': 'no-store' } })
  const headers = { ETag: `"${row.revision}"`, 'Cache-Control': 'no-store' }
  const ifRevision = req.headers.get('if-none-match')
  if (ifRevision === String(row.revision) || ifRevision === headers.ETag) return new Response(null, { status: 304, headers })
  return Response.json(row.manifest, { headers })
}
