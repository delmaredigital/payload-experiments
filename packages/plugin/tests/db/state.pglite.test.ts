import type { Payload } from 'payload'
import { expect, test, vi } from 'vitest'
import { pooledExecutor, type Executor } from '../../src/db/executor.js'
import { bumpRevision, readState, writeManifest } from '../../src/db/state.js'
import { readManifestRow } from '../../src/db/manifest.js'
import { createPgliteDb } from '../_helpers/pglite.js'
import type { Manifest } from '../../src/types/manifest.js'

test('first bump inserts 1, next updates to 2, and stored manifest reads back', async () => {
  const { db, close } = await createPgliteDb()
  try {
    await db.transaction(async tx => {
      const raw = pooledExecutor({ db: { drizzle: tx } } as unknown as Payload)
      // Single-connection PGlite exercises state SQL; advisory locking/concurrency
      // is train-only. Record the lock request and delegate all other statements.
      const locks = vi.fn()
      const exec: Executor = { query<R>(text: string, params?: unknown[]) {
        if (text.includes('pg_advisory_xact_lock')) { locks(text); return Promise.resolve({ rows: [] as R[], rowCount: 1 }) }
        return raw.query<R>(text, params)
      } }
      expect(await readState(exec)).toBeNull()
      expect(await readManifestRow(exec)).toBeNull()
      expect(await bumpRevision(exec)).toBe(1)
      expect(await readState(exec)).toEqual({ revision: 1, manifest: null, flagDefaults: {} })
      expect(await bumpRevision(exec)).toBe(2)
      const manifest: Manifest = { v: 1, revision: 2, experiments: [], archivedWinners: {}, archivedPages: {}, flagDefaults: {} }
      await writeManifest(exec, manifest)
      expect(await readState(exec)).toEqual({ revision: 2, manifest, flagDefaults: {} })
      expect(await readManifestRow(exec)).toEqual({ revision: 2, manifest })
      expect(locks).toHaveBeenCalledTimes(2)
      expect(locks.mock.calls[0]![0]).toContain("hashtext('xp:state'), 0")
    })
  } finally { await close() }
}, 60_000)

test('state readers qualify and escape a supplied schema', async () => {
  const query = vi.fn(async () => ({ rows: [], rowCount: 0 }))
  await readManifestRow({ query } as Executor, { schemaName: 'tenant"one' })
  expect(query.mock.calls[0]).toBeDefined()
  expect(query).toHaveBeenCalledWith(expect.stringContaining('FROM "tenant""one"."xp_state" LIMIT 1'))
})
