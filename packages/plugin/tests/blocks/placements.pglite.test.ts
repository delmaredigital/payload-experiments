import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, test, vi } from 'vitest'
import { createPgliteDb } from '../_helpers/pglite.js'
import { pooledExecutor, type Executor } from '../../src/db/executor.js'
import { appendPlacementDoc, placementTests, refreshPlacementDocs } from '../../src/db/placements.js'
import { lockPlacementScope } from '../../src/db/locks.js'
import { lockAndRescanPlacements, placementInteractions, placementPaths } from '../../src/transitions/placementInteractions.js'
import { sampleOptions } from '../collections/fixtures.js'
import { fakePayload } from '../_fakes/payload.js'
import { fakeReq } from '../_fakes/req.js'
import { writePhaseRecord } from '../../src/transitions/phaseRecord.js'
let store: Awaited<ReturnType<typeof createPgliteDb>>
let raw: Executor
beforeAll(async () => { store = await createPgliteDb(); raw = pooledExecutor({ db: { drizzle: store.db } } as unknown as Payload) }, 60_000) // Local bootstrap <6.54 s (entire six-file focused run: 6.54 s); 60 s cap.
afterAll(async () => { await store?.close() })
async function insert(slug: string, kind: string, docs: unknown, status = 'running', arms: unknown[] = []) {
  const id = (await raw.query<{ id: number }>(`INSERT INTO xp_experiments (slug,name,status,kind,unit_type,allocation,exposure_policy,created_at,updated_at)
    VALUES ($1,$1,$2,$3,'visitor',100,'render',now(),now()) RETURNING id`, [slug, status, kind])).rows[0]!.id
  await raw.query(`INSERT INTO xp_phases (experiment_id,phase,phase_kind,started_at,seed,arms,placement_docs,created_at,updated_at)
    VALUES ($1,1,'test',now(),'seed|',$2::jsonb,$3::jsonb,now(),now())`, [id, JSON.stringify(arms), docs === null ? null : JSON.stringify(docs)])
  return id
}
test('append skips null legacy lists and deduplicates serial/string document ids', async () => {
  const old = await insert('legacy-placement', 'block', null)
  const modern = await insert('modern-placement', 'block', [])
  const doc = { collection: 'pages', id: 7 }
  await appendPlacementDoc(raw, old, 1, doc)
  await appendPlacementDoc(raw, modern, 1, doc)
  await appendPlacementDoc(raw, modern, 1, { ...doc, id: '7' })
  await refreshPlacementDocs(raw, old, 1, [{ collection: 'pages', id: 99 }])
  await refreshPlacementDocs(raw, modern, 1, [doc, { collection: 'pages', id: 8 }])
  const tests = await placementTests(raw)
  expect(tests.find(t => t.id === old)?.placementDocs).toBeNull()
  expect(tests.find(t => t.id === modern)?.placementDocs).toEqual([doc, { collection: 'pages', id: 8 }])
})
test('guard acquires sorted E locks before sorted paths and restores the session timeout', async () => {
  const calls: Array<{ sql: string; params: unknown[] }> = []
  const exec: Executor = { async query<R>(sql: string, params: unknown[] = []) {
    calls.push({ sql, params })
    // PGlite does not implement advisory locks. Observe the actual production helper's
    // order on this real transaction; all SET LOCAL/current_setting calls execute in Postgres.
    if (sql.includes('pg_advisory_xact_lock')) return { rows: [] as R[], rowCount: 1 }
    return raw.query<R>(sql, params)
  } }
  await raw.query('BEGIN')
  try {
    await raw.query("SELECT set_config('lock_timeout','37ms',true)")
    await lockPlacementScope(exec, ['9', '2', '2'], ['/z', '/a'])
    expect(calls.filter(c => c.sql.includes('pg_advisory_xact_lock')).map(c => [c.sql.includes('xp:experiment') ? 'E' : 'P', c.params[0]])).toEqual([['E', '2'], ['E', '9'], ['P', '/a'], ['P', '/z']])
    expect((await raw.query<{ timeout: string }>("SELECT current_setting('lock_timeout') AS timeout")).rows[0]?.timeout).toBe('37ms')
  } finally { await raw.query('ROLLBACK') }
})
test('detached rescan freezes document ids only and current published paths detect interactions', async () => {
  const options = sampleOptions()
  options.puck = { enabled: true, collections: ['pages'] }
  options.pages = { collections: [{ slug: 'pages', pathOf: doc => String(doc.path), findByPath: async () => null }] }
  const payload = fakePayload({ config: { collections: [{ slug: 'pages', fields: [] }] }, collections: { pages: [{ id: 21, path: '/current', puckData: { content: [{ type: 'ExperimentSlot', props: { experiment: 'freeze', control: [{}], variantA: [{}] } }] } }] } })
  Object.assign(payload.db, { findOne: vi.fn(async () => ({ id: 21, path: '/current' })) })
  const req = fakeReq({ payload }); req.transactionID = 'outer'
  const noLocks: Executor = { query<R>(sql: string, params?: unknown[]) { return sql.includes('pg_advisory_xact_lock') ? Promise.resolve({ rows: [] as R[], rowCount: 1 }) : raw.query<R>(sql, params) } }
  const own = await insert('freeze', 'block', [])
  const result = await lockAndRescanPlacements(req, noLocks, options, { id: own, slug: 'freeze', kind: 'block', arms: [] }, [{ collection: 'pages', id: 21, slots: { control: 1, variantA: 1, variantB: 0, variantC: 0 }, title: 'Page', published: true }])
  expect(req.transactionID).toBe('outer')
  expect(result.docs).toEqual([{ collection: 'pages', id: 21 }])
  const create = vi.spyOn(payload, 'create').mockImplementation(async args => {
    await raw.query('UPDATE xp_phases SET placement_docs = $1::jsonb WHERE experiment_id = $2', [JSON.stringify(args.data?.placementDocs), own])
    return { id: 1 } as never
  })
  await writePhaseRecord(req, { experiment: own, phase: 1, phaseKind: 'test', seed: 's|', startedAt: new Date().toISOString(), arms: [], allocation: 100, targeting: [], placementDocs: result.docs, analysis: { sequentialTuningParameter: 5000 } })
  expect(create).toHaveBeenCalledWith(expect.objectContaining({ overrideAccess: true, req }))
  expect((await placementTests(raw)).find(t => t.id === own)?.placementDocs).toEqual(result.docs)
  expect(await placementPaths(req, options, result.docs)).toEqual(['/current'])
  const page = await insert('page-interaction', 'page', null, 'running', [{ key: 'control', kind: 'control', pageTarget: '/current' }])
  expect(await placementInteractions(req, raw, options, { id: own, kind: 'block', arms: [] }, ['/current'])).toContainEqual(expect.objectContaining({ experimentId: page }))
  expect(await placementInteractions(req, raw, options, { id: page, kind: 'page', arms: [] }, ['/current'])).toContainEqual(expect.objectContaining({ experimentId: own }))
  await raw.query("UPDATE xp_experiments SET status='archived' WHERE id=$1", [own])
  expect(await placementInteractions(req, raw, options, { id: page, kind: 'page', arms: [] }, ['/current'])).not.toContainEqual(expect.objectContaining({ experimentId: own }))
  const legacy = await insert('legacy-freeze', 'block', null)
  payload.documents.pages![0]!.puckData = { content: [{ type: 'ExperimentSlot', props: { experiment: 'legacy-freeze', control: [{}], variantA: [{}] } }] }
  expect(await placementInteractions(req, raw, options, { id: page, kind: 'page', arms: [] }, ['/current'])).toContainEqual(expect.objectContaining({ experimentId: legacy }))
  // A hand-made copy (Payload's Duplicate) used as a version page carries another test's slot: Start's check names it as the version.
  const versionArms = [{ key: 'control', kind: 'control', pageTarget: '/original' }, { key: 'variantA', kind: 'variant', pageTarget: '/current' }] as never
  expect(await placementInteractions(req, raw, options, { id: page, kind: 'page', arms: versionArms }, ['/current'])).toContainEqual(expect.objectContaining({ experimentId: legacy, path: '/current', version: true }))
  expect(req.transactionID).toBe('outer')
  vi.spyOn(payload.db, 'findOne').mockResolvedValueOnce(Object.assign({ id: 21 }, { path: '/current' })).mockResolvedValueOnce(Object.assign({ id: 21 }, { path: '/unlocked' }))
  await expect(lockAndRescanPlacements(req, noLocks, options, { id: own, slug: 'legacy-freeze', kind: 'block', arms: [] }, [{ collection: 'pages', id: 21, title: 'Page', published: true, slots: { control: 1, variantA: 1, variantB: 0, variantC: 0 } }])).rejects.toMatchObject({ code: 'placements-changed' })
})
