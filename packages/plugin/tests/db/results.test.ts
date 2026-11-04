import { expect, test, vi } from 'vitest'
import { armMismatchCount, identityRows, metricEventRows, phaseExposureRows, rolloutExposureRows } from '../../src/db/results.js'
import { createFakeExecutor } from '../_fakes/executor.js'
import type { Payload } from 'payload'
import { resultsExecutor } from '../../src/db/snapshots.js'

const from = new Date('2026-10-31T00:00:00Z')
const to = '2026-10-31T01:00:00.000Z'

test('results transport applies a timeout per query and recovers after an isolated SQL failure', async () => {
  const calls: string[] = [], releases: unknown[] = []
  let fail = true
  const pool = { connect: async () => ({
    query: async ({ text }: { text: string }) => {
      calls.push(text)
      if (text === 'SELECT broken' && fail) { fail = false; throw new Error('Query failed') }
      return { rows: [], rowCount: 0 }
    }, release: (error: unknown) => releases.push(error),
  }) }
  const exec = resultsExecutor({ db: { pool, schemaName: 'host' } } as unknown as Payload, () => 123)
  await expect(exec.query('SELECT broken')).rejects.toThrow('Query failed')
  await expect(exec.query('SELECT healthy')).resolves.toEqual({ rows: [], rowCount: 0 })
  expect(calls).toEqual(['BEGIN', expect.stringMatching(/^SET LOCAL statement_timeout = \d+$/), 'SELECT broken', 'ROLLBACK',
    'BEGIN', expect.stringMatching(/^SET LOCAL statement_timeout = \d+$/), 'SELECT healthy', 'COMMIT'])
  for (const call of calls.filter(text => text.startsWith('SET'))) expect(Number(call.split(' = ')[1])).toBeLessThanOrEqual(113)
  expect(releases).toHaveLength(2)
  expect(exec).toMatchObject({ schemaName: 'host' })
})

test.each(['57014', '23505'])('results transport rolls back SQL error %s without destroying its client', async code => {
  const release = vi.fn(), calls: string[] = []
  const error = Object.assign(new Error('SQL failed'), { code })
  const pool = { connect: async () => ({ release, query: async ({ text }: { text: string }) => {
    calls.push(text)
    if (text === 'SELECT broken') throw error
    return { rows: [], rowCount: 0 }
  } }) }
  const exec = resultsExecutor({ db: { pool } } as unknown as Payload, () => 1000)
  await expect(exec.query('SELECT broken')).rejects.toThrow(code === '57014' ? 'Results budget exhausted' : 'SQL failed')
  expect(calls.at(-1)).toBe('ROLLBACK')
  expect(release).toHaveBeenCalledExactlyOnceWith(undefined)
})

test.each(['BEGIN', 'SET', 'COMMIT'])('results transport bounds a hung %s and destroys its client', async hang => {
  const release = vi.fn(), calls: string[] = []
  const pool = { connect: async () => ({ release, query: async ({ text }: { text: string }) => {
    calls.push(text)
    if (text.startsWith(hang)) return new Promise(() => {})
    return { rows: [], rowCount: 0 }
  } }) }
  const exec = resultsExecutor({ db: { pool } } as unknown as Payload, () => 100)
  await expect(exec.query('SELECT healthy')).rejects.toThrow('Results budget exhausted')
  expect(release).toHaveBeenCalledWith(expect.any(Error))
  if (hang !== 'COMMIT') expect(calls).not.toContain('SELECT healthy')
})

test('results transport skips acquisition when only the timeout margin remains', async () => {
  const connect = vi.fn()
  const exec = resultsExecutor({ db: { pool: { connect } } } as unknown as Payload, () => 10)
  await expect(exec.query('SELECT healthy')).rejects.toThrow('Results budget exhausted')
  expect(connect).not.toHaveBeenCalled()
})

test('a delayed SET that consumes the margin never starts the data query', async () => {
  const start = Date.now(), clock = vi.spyOn(Date, 'now').mockReturnValue(start), calls: string[] = []
  try {
    const pool = { connect: async () => ({ release: vi.fn(), query: async ({ text }: { text: string }) => {
      calls.push(text)
      if (text.startsWith('SET')) clock.mockReturnValue(start + 95)
      return { rows: [], rowCount: 0 }
    } }) }
    const exec = resultsExecutor({ db: { pool } } as unknown as Payload, () => 100)
    await expect(exec.query('SELECT healthy')).rejects.toThrow('Results budget exhausted')
    expect(calls).not.toContain('SELECT healthy')
  } finally { clock.mockRestore() }
})

test('userIds filters stored user_id, batches independently, and never filters unit_id', async () => {
  const exec = createFakeExecutor()
  const userIds = Array.from({ length: 10_001 }, (_, n) => String(n))
  await metricEventRows(exec, { eventName: 'signup', from, to, userIds: [...userIds, '0'] })
  expect(exec.calls).toHaveLength(2)
  expect(exec.calls.every(call => call.text.includes('"user_id" = ANY($5::text[])') && !call.text.includes('"unit_id" = ANY'))).toBe(true)
  expect(exec.calls[0]!.params[4]).toHaveLength(10_000)
  expect(exec.calls[1]!.params[4]).toEqual(['10000'])
  await metricEventRows(exec, { eventName: 'signup', from, to, userIds: [] })
  expect(exec.calls).toHaveLength(2)
  await expect(metricEventRows(exec, { eventName: 'signup', from, to, userIds: [], unitIds: [] })).rejects.toThrow('Choose unitIds or userIds')
})

test('phase exposure SQL binds values in order, quotes identifiers and uses strict endedAt', async () => {
  const exec = Object.assign(createFakeExecutor({ results: [{ rows: [{ unitId: 'v', arm: 'control', ts: String(+from) }] }] }), { schemaName: 'host"schema' })
  expect(await phaseExposureRows(exec, { experimentId: 'opaque-id', phase: 2, endedAt: to })).toEqual([{ unitId: 'v', arm: 'control', ts: +from }])
  expect(exec.calls).toEqual([{
    text: 'SELECT "unit_id" AS "unitId", "arm" AS "arm", round(extract(epoch from "ts") * 1000)::bigint AS "ts" FROM "host""schema"."xp_events" WHERE "experiment_id" = $1 AND "phase" = $2 AND "type" = $3 AND "ts" < $4 ORDER BY "ts", "unit_id"',
    params: ['opaque-id', 2, 'exposure', to],
  }])
  await phaseExposureRows(exec, { experimentId: 7, phase: 1 })
  expect(exec.calls[1]!.params).toEqual([7, 1, 'exposure'])
  expect(exec.calls[1]!.text).not.toContain('"ts" <')
  expect(exec.calls[0]!.text).not.toMatch(/DISTINCT|GROUP BY/)
})

test('mismatches count distinct units separately, with the same optional phase cut-off', async () => {
  const exec = createFakeExecutor({ results: [{ rows: [{ unitCount: '2' }] }, { rows: [{ unitCount: 0 }] }] })
  expect(await armMismatchCount(exec, { experimentId: 1, phase: 3, endedAt: +from })).toBe(2)
  expect(exec.calls[0]).toEqual({ text: 'SELECT count(DISTINCT "unit_id") AS "unitCount" FROM "xp_events" WHERE "experiment_id" = $1 AND "phase" = $2 AND "type" = $3 AND "ts" < $4', params: [1, 3, 'arm-mismatch', from.toISOString()] })
  expect(await armMismatchCount(exec, { experimentId: 1, phase: 3 })).toBe(0)
  expect(exec.calls[1]!.params).toEqual([1, 3, 'arm-mismatch'])
})

test('rollout SQL reads exposures across every phase, in timestamp/unit/phase order', async () => {
  const exec = createFakeExecutor({ results: [{ rows: [{ unitId: 'old', phase: '1', ts: String(+from) }] }] })
  expect(await rolloutExposureRows(exec, { experimentId: 4 })).toEqual([{ unitId: 'old', phase: 1, ts: +from }])
  expect(exec.calls).toEqual([{ text: 'SELECT "unit_id" AS "unitId", "phase" AS "phase", round(extract(epoch from "ts") * 1000)::bigint AS "ts" FROM "xp_events" WHERE "experiment_id" = $1 AND "type" = $2 ORDER BY "ts", "unit_id", "phase"', params: [4, 'exposure'] }])
})

test('metric SQL quotes type/value, binds untrusted event names, and preserves nullable user IDs', async () => {
  const eventName = "name'; DROP TABLE xp_events; --"
  const exec = createFakeExecutor({ results: [{ rows: [
    { unitId: 'v', userId: 42, value: '1', ts: String(+from) },
    { unitId: 'w', userId: null, value: 1, ts: +from },
  ] }] })
  expect(await metricEventRows(exec, { eventName, from, to })).toEqual([
    { unitId: 'v', userId: '42', value: 1, ts: +from },
    { unitId: 'w', userId: null, value: 1, ts: +from },
  ])
  expect(exec.calls).toEqual([{
    text: 'SELECT "unit_id" AS "unitId", "user_id" AS "userId", "value" AS "value", round(extract(epoch from "ts") * 1000)::bigint AS "ts" FROM "xp_events" WHERE "type" = $1 AND "event_name" = $2 AND "ts" >= $3 AND "ts" < $4 ORDER BY "ts", "unit_id"',
    params: ['conversion', eventName, from.toISOString(), to],
  }])
})

test('25,000 IDs use disjoint 10,000/10,000/5,000 ANY batches, with repeated IDs deduplicated', async () => {
  const ids = Array.from({ length: 25_000 }, (_, n) => `unit-${n}`)
  const exec = createFakeExecutor({ results: [0, 1, 2].map(n => ({ rows: [{ unitId: ids[n * 10_000], userId: null, value: 1, ts: +from }] })) })
  expect(await metricEventRows(exec, { eventName: 'signup', from, to, unitIds: [...ids, ids[0]!] })).toHaveLength(3)
  expect(exec.calls).toHaveLength(3)
  for (const [n, call] of exec.calls.entries()) {
    expect(call.text).toContain('"unit_id" = ANY($5::text[])')
    expect(call.params).toEqual(['conversion', 'signup', from.toISOString(), to, ids.slice(n * 10_000, (n + 1) * 10_000)])
  }
  const identities = createFakeExecutor({ results: [0, 1, 2].map(n => ({ rows: [{ anonymousId: ids[n * 10_000], userId: n + 10 }] })) })
  expect(await identityRows(identities, { anonymousIds: [...ids, ids[0]!] })).toEqual([0, 1, 2].map(n => ({ anonymousId: ids[n * 10_000], userId: String(n + 10), verifiedAt: null, ownedAt: null })))
  expect(identities.calls).toHaveLength(3)
  for (const [n, call] of identities.calls.entries()) {
    expect(call.params).toEqual([ids.slice(n * 10_000, (n + 1) * 10_000)])
    expect(call.text).toContain('link."anonymous_id" = ANY($1::text[])')
    expect(call.text).toContain('owner."user_id" = link."user_id"')
    expect(call.text).toContain('min(owner."verified_at")')
  }
})

test('explicit empty ID filters issue no queries', async () => {
  const exec = createFakeExecutor()
  expect(await metricEventRows(exec, { eventName: 'signup', unitIds: [], from, to })).toEqual([])
  expect(await identityRows(exec, { anonymousIds: [] })).toEqual([])
  expect(exec.calls).toEqual([])
})

test('a history scan with 150,000 conversion rows does not exceed the JS argument limit', async () => {
  const rows = Array.from({ length: 150_000 }, (_, n) => ({ unitId: `v-${n}`, userId: null, value: 1, ts: +from }))
  const exec = createFakeExecutor({ results: [{ rows }] })
  const events = await metricEventRows(exec, { eventName: 'history', from, to })
  expect(events).toHaveLength(rows.length)
  expect(events.at(-1)).toEqual(rows.at(-1))
  expect(exec.calls).toHaveLength(1)
})
