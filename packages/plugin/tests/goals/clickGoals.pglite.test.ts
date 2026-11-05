import type { Payload } from 'payload'
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest'
import { createPgliteDb } from '../_helpers/pglite.js'
import { pooledExecutor, type Executor } from '../../src/db/executor.js'
import { definedClickKeys } from '../../src/db/clickGoals.js'
import { clickKeys } from '../../src/goals/cache.js'
import { asymmetricGoal, goalContent } from '../../src/goals/fairness.js'
import { handleEvents } from '../../src/endpoints/events.js'
import { encodeUnitCookie } from '../../src/runtime/cookie.js'
import { runtime, manifest } from '../rsc/helpers.js'
import { defaultArms } from '../../src/collections/experiments/armInvariants.js'
import { fakePayload } from '../_fakes/payload.js'
import { fakeReq } from '../_fakes/req.js'
import { sampleOptions } from '../collections/fixtures.js'

let store: Awaited<ReturnType<typeof createPgliteDb>>, exec: Executor
beforeAll(async () => { store = await createPgliteDb(); exec = pooledExecutor({ db: { drizzle: store.db } } as unknown as Payload) }, 60_000) // Local focused file (including bootstrap): 0.877 s; 60 s hook cap exceeds 3×.
afterAll(async () => { await store?.close() })
afterEach(() => vi.restoreAllMocks())

function pooledPayload() {
  const payload = fakePayload()
  Object.assign(payload.db, { drizzle: store.db })
  return payload
}
async function metric(slug: string, source = `click:${slug}`) {
  await exec.query('INSERT INTO xp_metrics (slug,name,source,direction,created_at,updated_at) VALUES ($1,$1,$2,\'increase\',now(),now())', [slug, source])
}

test('events check defined keys on the pool, cache for 30 s, retain the last good set and drop undefined keys', async () => {
  let now = Date.now(); vi.spyOn(Date, 'now').mockImplementation(() => now)
  await metric('join'); await metric('ordinary', 'events:signup')
  expect(await definedClickKeys(exec)).toEqual(new Set(['join']))
  const payload = pooledPayload(), { rt } = runtime(manifest())
  const options = { ...sampleOptions(), runtime: rt }
  const request = (key: string, id = key) => fakeReq({ payload, body: JSON.stringify({ events: [{ type: 'conversion', eventName: `click:${key}`, idempotencyKey: id, attributes: { country: 'US' } }] }),
    headers: { cookie: `xp_id=${encodeUnitCookie('click-visitor', ['current', 'old'])}` } })
  expect((await handleEvents(request('join'), { options })).status).toBe(202)
  expect((await handleEvents(request('undefined'), { options })).status).toBe(202)
  expect((await handleEvents(request('BAD'), { options })).status).toBe(202)
  const rows = await exec.query<{ eventName: string; attributes: unknown }>('SELECT event_name AS "eventName", attributes FROM xp_events WHERE unit_id = $1', ['click-visitor'])
  expect(rows.rows).toEqual([{ eventName: 'click:join', attributes: null }])
  await metric('new-key')
  now += 29_999
  expect(await clickKeys(payload)).not.toContain('new-key')
  now += 1
  expect(await clickKeys(payload)).toContain('new-key')
  const execute = vi.spyOn(store.db, 'execute').mockRejectedValue(new Error('read unavailable'))
  now += 30_000
  expect(await clickKeys(payload)).toEqual(new Set(['join', 'new-key']))
  expect(payload.logs).toContainEqual(expect.objectContaining({ level: 'error' }))
  const cold = pooledPayload()
  expect((await handleEvents(fakeReq({ payload: cold, body: JSON.stringify({ events: [{ type: 'conversion', eventName: 'click:join', idempotencyKey: 'cold' }] }), headers: { cookie: `xp_id=${encodeUnitCookie('cold', ['current'])}` } }), { options })).status).toBe(202)
  expect(await clickKeys(cold)).toBeUndefined()
  execute.mockRestore()
  expect((await exec.query('SELECT id FROM xp_events WHERE unit_id = $1', ['cold'])).rows).toEqual([])
})

test('fairness reads published main rows; draft-only keys never count, holdout uses control', async () => {
  const main = { _status: 'published', layout: [{ blockType: 'xpExperiment', experiment: 'fair', slots: [
    { slot: 'control', blocks: [{ blockType: 'cta', xpGoal: 'join' }] }, { slot: 'variantA', blocks: [{ blockType: 'cta', xpGoal: 'join' }] },
  ] }] }
  const draft = { ...main, layout: [{ blockType: 'xpExperiment', experiment: 'fair', slots: [{ slot: 'variantA', blocks: [{ blockType: 'cta', xpGoal: 'draft-only' }] }] }] }
  await exec.query('INSERT INTO xp_experiments (slug,name,status,kind,unit_type,allocation,exposure_policy,decision_content_report,created_at,updated_at) VALUES ($1,$1,\'draft\',\'block\',\'visitor\',100,\'render\',$2::jsonb,now(),now())', ['fair', JSON.stringify({ main, draft })])
  const payload = fakePayload({ config: { collections: [{ slug: 'pages', versions: { drafts: true }, fields: [{ name: 'layout', type: 'blocks', blocks: [{ slug: 'cta', labels: { singular: 'Call to action' }, fields: [] }] }] }] } })
  const read = async () => (await exec.query<{ content: { main: typeof main; draft: typeof draft } }>('SELECT decision_content_report AS content FROM xp_experiments WHERE slug=$1', ['fair'])).rows[0]!.content
  Object.assign(payload.db, { findOne: vi.fn(async () => ({ id: 1, ...(await read()).main })), findVersions: vi.fn(async () => ({ docs: [{ version: (await read()).draft }] })) })
  const req = fakeReq({ payload }), options = { ...sampleOptions(), blocks: { collections: [{ slug: 'pages', field: 'layout' }] } }
  const arms = [...defaultArms('block').map(a => ({ ...a, weight: 45 })), { key: 'holdout' as const, label: 'Holdout', kind: 'holdout' as const, weight: 10 }]
  const experiment = { id: 1, slug: 'fair', kind: 'block', arms }
  const content = await goalContent(req, options, experiment, [{ collection: 'pages', id: 1 }])
  expect(content.keys).toEqual([{ key: 'join', arms: ['control', 'variantA', 'holdout'], label: 'Call to action' }])
  expect(asymmetricGoal(content, 'click:join', arms)).toBe(false)
  expect(content.keys.some(row => row.key === 'draft-only')).toBe(false)
  expect(payload.db.findVersions).not.toHaveBeenCalled()
  await exec.query("UPDATE xp_experiments SET decision_content_report = jsonb_set(decision_content_report, '{main,layout,0,slots,1,blocks}', '[]'::jsonb) WHERE slug=$1", ['fair'])
  const changed = await goalContent(req, options, experiment, [{ collection: 'pages', id: 1 }])
  expect(asymmetricGoal(changed, 'click:join', arms)).toBe(true)
  expect(changed.keys[0]!.arms).toEqual(['control', 'holdout'])
})
