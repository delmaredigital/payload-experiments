import type { Payload } from 'payload'
import { eq } from 'drizzle-orm'
import { expect, test } from 'vitest'
import { sweepEvents } from '../../src/db/sweep.js'
import { insertEvents, type EventRow } from '../../src/db/events.js'
import { pooledExecutor } from '../../src/db/executor.js'
import { createFakeExecutor } from '../_fakes/executor.js'
import { createPgliteDb } from '../_helpers/pglite.js'
import { xp_events, xp_experiments, xp_phases } from '../_fixtures/generated-schema.js'

test('sweep checks budget before every statement and batches each predicate separately', async () => {
  const exec = createFakeExecutor({ results: [
    { rows: [], rowCount: 2 }, { rows: [], rowCount: 2 }, { rows: [], rowCount: 1 },
    { rows: [], rowCount: 1 }, { rows: [{ experimentId: 7 }] },
    { rows: [], rowCount: 2 }, { rows: [], rowCount: 0 }, { rows: [], rowCount: 1 },
  ] })
  const now = new Date('2026-10-31'), cutoff = '2026-05-04T00:00:00.000Z'
  expect(await sweepEvents(exec, { now, batchSize: 2 })).toBe(9)
  expect(exec.calls).toHaveLength(8)
  expect(exec.calls[0]!.params).toEqual([2])
  expect(exec.calls[4]!.params).toEqual([cutoff])
  expect(exec.calls[5]!.params).toEqual([[7], cutoff, 2])
  expect(exec.calls[7]!.params).toEqual([cutoff, 2])
  for (let allowed = 0; allowed < 5; allowed++) {
    let queries = 0
    const limited = createFakeExecutor({ results: [{ rows: [] }, { rows: [] }, { rows: [{ experimentId: 7 }] }] })
    const query = limited.query.bind(limited)
    limited.query = (...args) => { queries++; return query(...args) }
    await sweepEvents(limited, { now, shouldContinue: () => queries < allowed })
    expect(queries).toBe(allowed)
  }
  await expect(sweepEvents(exec, { now, batchSize: 0 })).rejects.toThrow('Invalid retention')
})

test('PGlite: an old stopped test plus open rollout keeps all rows until final endedAt + 180 days', async () => {
  const database = await createPgliteDb()
  try {
    const exec = pooledExecutor({ db: { drizzle: database.db } } as unknown as Payload)
    const [experiment] = await database.db.insert(xp_experiments).values({ name: 'Sweep', slug: 'sweep', kind: 'code', exposurePolicy: 'manual' }).returning()
    const id = experiment!.id, now = new Date('2026-10-31T00:00:00Z')
    for (const [phase, endedAt] of [[1, '2026-01-02T00:00:00Z'], [2, null]] as const) {
      await database.db.insert(xp_phases).values({ experiment: id, phase, phaseKind: phase === 1 ? 'test' : 'rollout', seed: 'sweep|', startedAt: '2026-01-01T00:00:00Z', endedAt })
    }
    let serial = 0
    const event = (overrides: Partial<EventRow>): EventRow => ({ type: 'exposure', experimentId: id, phase: 1, arm: 'control', unitId: 'a', unitType: 'visitor', ts: '2026-01-01T00:00:00Z', dedupeKey: `sweep-${++serial}`, ...overrides })
    await insertEvents(exec, [event({}), event({}), event({ phase: 2 }),
      event({ experimentId: undefined }), event({ experimentId: undefined, type: 'arm-mismatch' }),
      event({ experimentId: undefined, type: 'conversion', eventName: 'signup', value: 1 }),
      event({ experimentId: undefined, type: 'conversion', eventName: 'signup', value: 1, ts: '2025-12-31T00:00:00Z' })])
    expect(await sweepEvents(exec, { now, batchSize: 2 })).toBe(2)
    const remaining = await database.db.select().from(xp_events)
    expect(remaining.map(row => row.phase).sort()).toEqual([1, 1, 1, 1, 2])
    expect(remaining.filter(row => row.type === 'conversion')).toHaveLength(2)
    // Release holdout: the final end starts the clock for every event, including
    // the old test history needed by rollout's first-ever exposure rule.
    await database.db.update(xp_phases).set({ endedAt: now.toISOString() }).where(eq(xp_phases.phase, 2))
    const expires = new Date(+now + 180 * 86_400_000)
    expect(await sweepEvents(exec, { now: expires, batchSize: 2 })).toBe(0)
    expect(await sweepEvents(exec, { now: new Date(+expires + 1), batchSize: 2 })).toBe(5)
    expect(await database.db.select().from(xp_events)).toEqual([])
  } finally { await database.close() }
}, 60_000)


test('PGlite EXPLAIN: every retention branch selects batches through a non-primary event index', async () => {
  const database = await createPgliteDb()
  try {
    const exec = pooledExecutor({ db: { drizzle: database.db } } as unknown as Payload)
    const ids = await exec.query<{ id: number }>(`INSERT INTO xp_experiments (name, slug, kind, exposure_policy, created_at, updated_at)
      VALUES ('Active', 'active', 'code', 'manual', now(), now()), ('Ended', 'ended', 'code', 'manual', now(), now()) RETURNING id`)
    const active = ids.rows[0]!.id, ended = ids.rows[1]!.id
    await exec.query(`INSERT INTO xp_phases (experiment_id, phase, phase_kind, seed, started_at, ended_at, created_at, updated_at)
      VALUES ($1, 1, 'test', 'a|', '2026-06-01', NULL, now(), now()), ($2, 1, 'test', 'b|', '2025-01-01', '2025-02-01', now(), now())`, [active, ended])
    await exec.query(`INSERT INTO xp_events (type, experiment_id, unit_id, unit_type, ts, dedupe_key, created_at, updated_at)
      SELECT CASE WHEN n % 100 = 0 THEN 'conversion' ELSE 'exposure' END::enum_xp_events_type,
        CASE WHEN n % 100 IN (0, 1) THEN NULL WHEN n % 4 = 2 THEN $2::integer ELSE $1::integer END,
        'unit-' || n, 'visitor', '2025-01-01'::timestamptz + n * interval '1 second', 'plan-' || n, now(), now()
      FROM generate_series(1, 30000) n`, [active, ended])
    await exec.query('ANALYZE xp_events')
    await exec.query('ANALYZE xp_phases')
    const calls: Array<{ text: string; params: unknown[] }> = []
    // Capture the exact production statements without deleting the plan dataset.
    await sweepEvents({ query: async <R>(text: string, params: unknown[] = []) => {
      if (!text.startsWith('DELETE')) return exec.query<R>(text, params)
      calls.push({ text, params })
      return { rows: [], rowCount: 0 }
    } }, { now: new Date('2026-10-31'), batchSize: 20 })
    expect(calls).toHaveLength(4)
    type Plan = { 'Node Type': string; 'Alias'?: string; 'Index Name'?: string; Plans?: Plan[] }
    const nodes = (plan: Plan): Plan[] => [plan, ...(plan.Plans ?? []).flatMap(nodes)]
    const indexes: string[][] = []
    for (const call of calls) {
      const result = await exec.query<{ 'QUERY PLAN': Array<{ Plan: Plan }> }>(`EXPLAIN (FORMAT JSON) ${call.text}`, call.params)
      const planNodes = nodes(result.rows[0]!['QUERY PLAN'][0]!.Plan)
      const candidateScans = planNodes.filter(node => node.Alias === 'v')
      expect(candidateScans, JSON.stringify(result.rows)).not.toHaveLength(0)
      const candidateNodes = candidateScans.flatMap(nodes)
      const names = candidateNodes.flatMap(node => node['Index Name'] ? [node['Index Name']] : [])
      expect(candidateScans.every(node => node['Node Type'] !== 'Seq Scan') && names.length > 0
        && names.every(name => name !== 'xp_events_pkey'), JSON.stringify(result.rows)).toBe(true)
      indexes.push(names)
    }
    expect(indexes[2]).toContain('experiment_ts_idx')
    // A new open phase between the phase-id read and delete must protect history.
    let reopened = false
    await sweepEvents({ query: async <R>(text: string, params: unknown[] = []) => {
      const result = await exec.query<R>(text, params)
      if (text.startsWith('SELECT') && !reopened) {
        reopened = true
        await exec.query(`INSERT INTO xp_phases (experiment_id, phase, phase_kind, seed, started_at, created_at, updated_at)
          VALUES ($1, 2, 'test', 'new|', '2026-10-31', now(), now())`, [ended])
      }
      return result
    } }, { now: new Date('2026-10-31'), batchSize: 20 })
    expect((await exec.query<{ count: number }>('SELECT count(*)::integer AS count FROM xp_events WHERE experiment_id = $1', [ended])).rows[0]!.count).toBe(7500)
  } finally { await database.close() }
}, 60_000)
