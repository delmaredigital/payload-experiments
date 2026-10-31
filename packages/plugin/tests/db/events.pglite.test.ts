import type { Payload } from 'payload'
import { expect, test, vi } from 'vitest'
import { insertEvents, type EventRow } from '../../src/db/events.js'
import { pooledExecutor } from '../../src/db/executor.js'
import { createPgliteDb } from '../_helpers/pglite.js'

const row = (key: string): EventRow => ({ type: 'conversion', unitId: 'visitor', unitType: 'visitor', value: 1, eventName: 'event', dedupeKey: key, ts: '2026-10-31T00:00:00.000Z' })

test('multi-row insert counts only new keys and drops non-finite values', async () => {
  const { db, close } = await createPgliteDb()
  try {
    const exec = pooledExecutor({ db: { drizzle: db } } as unknown as Payload)
    const log = vi.fn()
    expect(await insertEvents(exec, [row('a'), row('b'), row('a')])).toBe(2)
    expect(await insertEvents(exec, [row('a'), row('c')])).toBe(1)
    expect(await insertEvents(exec, [NaN, Infinity, -Infinity].map((value, index) => ({ ...row(`bad${index}`), value })), log)).toBe(0)
    expect(log).toHaveBeenCalledTimes(3)
    expect(await insertEvents(exec, [])).toBe(0)
    expect((await exec.query('SELECT count(*)::integer AS count FROM xp_events')).rows).toEqual([{ count: 3 }])
  } finally { await close() }
}, 60_000)

test('FK 23503 retries individually and drops an exposure whose experiment was deleted', async () => {
  const { db, close } = await createPgliteDb()
  try {
    const exec = pooledExecutor({ db: { drizzle: db } } as unknown as Payload)
    const experiment = await exec.query<{ id: number }>(`INSERT INTO xp_experiments (name, slug, kind, unit_type, exposure_policy, created_at, updated_at) VALUES ('Deleted', 'deleted', 'block', 'visitor', 'render', now(), now()) RETURNING id`)
    const experimentId = experiment.rows[0]!.id
    await exec.query('DELETE FROM xp_experiments WHERE id = $1', [experimentId])
    const log = vi.fn()
    expect(await insertEvents(exec, [row('good1'), { ...row('deleted'), type: 'exposure', experimentId, arm: 'control', phase: 1 }, row('good2')], log)).toBe(2)
    expect(log).toHaveBeenCalledOnce()
    expect((await exec.query('SELECT dedupe_key FROM xp_events ORDER BY dedupe_key')).rows).toEqual([{ dedupe_key: 'good1' }, { dedupe_key: 'good2' }])
  } finally { await close() }
}, 60_000)


test('dimensions round-trip JSON only on exposures and the sweep index exists after push', async () => {
  const { db, close } = await createPgliteDb()
  try {
    const exec = pooledExecutor({ db: { drizzle: db } } as unknown as Payload)
    const dimensions = { path: '/article', loggedIn: false, amount: 42, campaign: 's'.repeat(64) }
    await insertEvents(exec, [
      { ...row('exposure'), type: 'exposure', dimensions },
      { ...row('conversion'), dimensions },
      { ...row('mismatch'), type: 'arm-mismatch', dimensions },
      { ...row('default'), type: 'exposure' },
    ])
    expect((await exec.query('SELECT dedupe_key, dimensions FROM xp_events ORDER BY dedupe_key')).rows).toEqual([
      { dedupe_key: 'conversion', dimensions: null }, { dedupe_key: 'default', dimensions: null },
      { dedupe_key: 'exposure', dimensions }, { dedupe_key: 'mismatch', dimensions: null },
    ])
    const indexes = await exec.query<{ indexdef: string }>("SELECT indexdef FROM pg_indexes WHERE tablename = 'xp_events'")
    expect(indexes.rows.some(row => /\(experiment_id, ts\)/.test(row.indexdef))).toBe(true)
  } finally { await close() }
}, 60_000)
