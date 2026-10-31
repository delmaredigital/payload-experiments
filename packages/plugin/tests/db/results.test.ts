import { expect, test } from 'vitest'
import { armMismatchCount, identityRows, metricEventRows, phaseExposureRows, rolloutExposureRows } from '../../src/db/results.js'
import { createFakeExecutor } from '../_fakes/executor.js'

const from = new Date('2026-10-31T00:00:00Z')
const to = '2026-10-31T01:00:00.000Z'

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
  expect(await identityRows(identities, { anonymousIds: [...ids, ids[0]!] })).toEqual([0, 1, 2].map(n => ({ anonymousId: ids[n * 10_000], userId: String(n + 10) })))
  expect(identities.calls).toHaveLength(3)
  for (const [n, call] of identities.calls.entries()) {
    expect(call).toEqual({ text: 'SELECT "anonymous_id" AS "anonymousId", "user_id" AS "userId" FROM "xp_identities" WHERE "anonymous_id" = ANY($1::text[]) ORDER BY "anonymous_id"', params: [ids.slice(n * 10_000, (n + 1) * 10_000)] })
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
