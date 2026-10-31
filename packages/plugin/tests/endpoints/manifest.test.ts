import type { PayloadRequest } from 'payload'
import { expect, test, vi } from 'vitest'
import { handleManifest } from '../../src/endpoints/manifest.js'
import type { Manifest } from '../../src/types/manifest.js'
import { sampleOptions } from '../collections/fixtures.js'

const manifest: Manifest = { v: 1, revision: 3, experiments: [], flagDefaults: {}, archivedWinners: {}, archivedPages: {} }
function request(rows: unknown[], etag?: string) {
  const execute = vi.fn(async () => ({ rows, rowCount: rows.length, fields: [{ name: 'revision', dataTypeID: 1700 }] }))
  return { headers: new Headers(etag == null ? {} : { 'if-none-match': etag }), payload: { db: { drizzle: { execute } } } } as unknown as PayloadRequest
}
test('200 returns JSON, quoted ETag and no-store', async () => {
  const response = await handleManifest(request([{ revision: '3', manifest }]), { options: sampleOptions() })
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual(manifest)
  expect(response.headers.get('etag')).toBe('"3"')
  expect(response.headers.get('cache-control')).toBe('no-store')
})
test.each(['3', '"3"'])('304 for matching If-None-Match %s has no body', async etag => {
  const response = await handleManifest(request([{ revision: '3', manifest }], etag), { options: sampleOptions() })
  expect(response.status).toBe(304)
  expect(await response.text()).toBe('')
  expect(response.headers.get('etag')).toBe('"3"')
  expect(response.headers.get('cache-control')).toBe('no-store')
})
test('different revision returns 200', async () => {
  expect((await handleManifest(request([{ revision: '3', manifest }], '"2"'), { options: sampleOptions() })).status).toBe(200)
})
test.each([{ rows: [] }, { rows: [{ revision: 0, manifest: null }] }])('404 not-found when no compiled row (%j)', async ({ rows }) => {
  const response = await handleManifest(request(rows), { options: sampleOptions() })
  expect(response.status).toBe(404)
  expect(await response.json()).toEqual({ errors: [{ code: 'not-found', message: 'Manifest not found' }] })
  expect(response.headers.get('cache-control')).toBe('no-store')
})
