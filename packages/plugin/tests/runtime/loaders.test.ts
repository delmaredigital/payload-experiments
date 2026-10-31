import type { Pool } from 'pg'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { createHttpManifestLoader, createPostgresManifestLoader } from '../../src/runtime/loaders.js'
import type { Manifest } from '../../src/types/manifest.js'

const manifest: Manifest = { v: 1, revision: 7, experiments: [], flagDefaults: {}, archivedWinners: {}, archivedPages: {} }
afterEach(() => { vi.unstubAllGlobals() })

describe('Postgres loader (fake pg pool)', () => {
  test('reads a schema-qualified single row, normalises revision and returns not-modified', async () => {
    const query = vi.fn(async () => ({ rows: [{ revision: '7', manifest, flagDefaults: {} }], rowCount: 1, fields: [{ name: 'revision', dataTypeID: 1700 }] }))
    const load = createPostgresManifestLoader({ pool: { query } as unknown as Pool, schemaName: 'xp_it_one' })
    expect(await load()).toEqual(manifest)
    expect(query).toHaveBeenCalledWith(expect.stringContaining('FROM "xp_it_one"."xp_state"'), [])
    expect(await load({ ifRevision: 7 })).toBe('not-modified')
    expect(await load({ ifRevision: 6 })).toEqual(manifest)
  })
  test.each([{ rows: [] }, { rows: [{ revision: '0', manifest: null, flagDefaults: null }] }])('returns null when no compiled manifest exists (%j)', async ({ rows }) => {
    const load = createPostgresManifestLoader({ pool: { query: vi.fn(async () => ({ rows })) } as unknown as Pool })
    expect(await load()).toBeNull()
  })
  test('propagates query failure to cache', async () => {
    const load = createPostgresManifestLoader({ pool: { query: vi.fn(async () => { throw new Error('offline') }) } as unknown as Pool })
    await expect(load()).rejects.toThrow('offline')
  })
})
describe('HTTP loader', () => {
  test('sends key and optional revision, including zero', async () => {
    const fetch = vi.fn(async () => Response.json(manifest))
    vi.stubGlobal('fetch', fetch)
    const load = createHttpManifestLoader({ url: 'https://host.test/api/xp/manifest', key: 'test-only' })
    expect(await load()).toEqual(manifest)
    expect(fetch).toHaveBeenLastCalledWith('https://host.test/api/xp/manifest', { headers: { 'x-xp-manifest-key': 'test-only' } })
    await load({ ifRevision: 0 })
    expect(fetch).toHaveBeenLastCalledWith('https://host.test/api/xp/manifest', { headers: { 'x-xp-manifest-key': 'test-only', 'if-none-match': '0' } })
  })
  test('returns not-modified on 304 without reading a body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 304 })))
    expect(await createHttpManifestLoader({ url: 'https://host.test', key: 'test-only' })({ ifRevision: 7 })).toBe('not-modified')
  })
  test.each([401, 404, 500])('throws for status %s', async status => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status })))
    await expect(createHttpManifestLoader({ url: 'https://host.test', key: 'test-only' })()).rejects.toThrow(String(status))
  })
})
