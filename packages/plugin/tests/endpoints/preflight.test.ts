import { afterEach, expect, test, vi } from 'vitest'
import { handlePreflight } from '../../src/endpoints/preflight.js'
import { buildEndpoints } from '../../src/endpoints/index.js'
import { fakePayload } from '../_fakes/payload.js'
import { fakeReq } from '../_fakes/req.js'
import { sampleOptions } from '../collections/fixtures.js'
import { defaultArms } from '../../src/collections/experiments/armInvariants.js'
import type { PreflightResult } from '../../src/types/endpoints.js'

afterEach(() => { vi.useRealTimers() })

function setup(kind: 'flag' | 'code' = 'code') {
  const options = sampleOptions()
  const payload = fakePayload({ overrides: { findGlobal: vi.fn(async () => ({ flagDefaults: {} })) }, collections: {
    'xp-experiments': [{ id: 'one', slug: 'hero', status: 'draft', kind, unitType: 'visitor', allocation: 100, flagPoint: 'cta', arms: defaultArms(kind),
      exposurePolicy: 'manual', analysis: { plannedDurationDays: 14, reachPerDay: 100 }, metrics: { primary: 2 } }],
    'xp-metrics': [{ id: 2, source: 'binomial' }],
  } })
  const req = fakeReq({ payload, user: { id: 1 }, routeParams: { id: 'one' } })
  return { options, payload, req }
}
test('GET preflight has the frozen shape, does not cache, and performs no writes', async () => {
  const { options, payload, req } = setup()
  const route = buildEndpoints({ options }).find(route => route.path === '/xp/experiments/:id/preflight')!
  expect(route.method).toBe('get')
  const response = await route.handler(req)
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('no-store')
  const body = await response.json() as PreflightResult
  expect(Object.keys(body).sort()).toEqual(['baseline', 'checks', 'estimate', 'placements', 'trafficPerDay'])
  expect(body.checks.every(check => check.ok)).toBe(true)
  expect(body.baseline).toEqual({ metricId: 2, value: 0, days: 28 })
  expect(body.trafficPerDay).toBe(100)
  expect(body.estimate).toBeNull()
  expect(body.placements).toEqual([])
  expect(payload.calls.every(call => call.method === 'find' && call.args.overrideAccess === false && call.args.req === req)).toBe(true)
  expect(payload.dbCalls).toEqual([])
})
test('unknown id returns a 404 not-found envelope', async () => {
  const { options, req } = setup()
  req.routeParams = { id: 'missing' }
  const response = await handlePreflight(req, { options })
  expect(response.status).toBe(404)
  expect(await response.json()).toEqual({ errors: [{ code: 'not-found', message: 'Experiment not found' }] })
})

test.each(['primary', 'secondary', 'guardrails'] as const)('preflight and start refuse a removed %s metric source before writing', async role => {
  const { options, req, payload } = setup()
  payload.documents['xp-metrics']!.push({ id: 3, source: 'removed' })
  payload.documents['xp-experiments']![0]!.metrics = role === 'primary' ? { primary: 3 } : { primary: 2, [role]: [3] }
  const response = await handlePreflight(req, { options })
  const body = await response.json() as PreflightResult
  expect(body.checks.find(check => !check.ok)).toEqual({ code: 'unknown-metric-source', ok: false, detail: [{ id: 3, source: 'removed' }] })
  const { start } = await import('../../src/transitions/start.js')
  await expect(start(req, { experimentId: 'one', options })).rejects.toMatchObject({ code: 'unknown-metric-source', status: 422 })
  expect(payload.calls.every(call => call.method === 'find')).toBe(true)
  expect(payload.dbCalls).toEqual([])
})
test('a throwing host placement hook returns a failed check with detail, not 500', async () => {
  const { options, req } = setup('flag')
  options.flagPoints![0]!.placements = async () => { throw new Error('Content adapter unavailable') }
  const response = await handlePreflight(req, { options })
  expect(response.status).toBe(200)
  expect((await response.json()).checks).toContainEqual({ code: 'flag-placement-missing', ok: false, detail: 'placements-failed' })
})
test.each([null, undefined, {}, 'invalid', 42, [null], [{ ok: true }]])('a non-array placement result (%j) reports a failed check instead of 500', async value => {
  const { options, req } = setup('flag')
  options.flagPoints![0]!.placements = vi.fn().mockResolvedValue(value)
  const response = await handlePreflight(req, { options })
  expect(response.status).toBe(200)
  const body = await response.json() as PreflightResult
  expect(body.checks).toContainEqual({ code: 'flag-placement-missing', ok: false, detail: 'placements-failed' })
  expect(body.placements).toEqual([])
})
test.each([null, undefined])('a synchronously returned %j placement result preserves the invalid-result detail', async value => {
  const { options, req } = setup('flag')
  options.flagPoints![0]!.placements = vi.fn().mockReturnValue(value)
  const response = await handlePreflight(req, { options })
  expect(response.status).toBe(200)
  expect((await response.json() as PreflightResult).checks).toContainEqual({ code: 'flag-placement-missing', ok: false, detail: 'placements-failed' })
})
test('flag preflight with a holdout passes when host content covers the non-holdout arms', async () => {
  const { options, req, payload } = setup('flag')
  payload.documents['xp-experiments']![0]!.arms = [
    ...defaultArms('flag').map(arm => ({ ...arm, weight: 45 })),
    { key: 'holdout', kind: 'holdout', label: 'Holdout', weight: 10 },
  ]
  const placements = vi.fn(async () => [{ arm: 'control', ok: true }, { arm: 'variantA', ok: true }])
  options.flagPoints![0]!.placements = placements
  const response = await handlePreflight(req, { options })
  expect(response.status).toBe(200)
  expect(placements).toHaveBeenCalledWith({ experimentId: 'one', arms: ['control', 'variantA'], req })
  expect((await response.json() as PreflightResult).checks.every(check => check.ok)).toBe(true)
})
test('host missing-arm rows remain visible to the Review tab', async () => {
  const { options, req } = setup('flag')
  options.flagPoints![0]!.placements = async () => [{ arm: 'control', ok: true }, { arm: 'variantA', ok: false, detail: 'No published ask' }]
  const response = await handlePreflight(req, { options })
  const body = await response.json() as PreflightResult
  expect(body.checks).toContainEqual(expect.objectContaining({ code: 'flag-placement-missing', ok: false }))
  expect(body.placements).toContainEqual({ collection: 'cta', id: 'variantA', title: 'variantA', ok: false, detail: 'No published ask' })
})
test('block read failure reports a failed placement check', async () => {
  const { options, req, payload } = setup()
  payload.documents['xp-experiments']![0]!.kind = 'block'
  options.puck = { enabled: true, collections: ['pages'] }
  const original = payload.find
  vi.spyOn(payload, 'find').mockImplementation(async args => {
    if (args.collection === 'pages') throw new Error('Page read denied')
    return original(args)
  })
  const response = await handlePreflight(req, { options })
  expect(response.status).toBe(200)
  expect((await response.json()).checks).toContainEqual({ code: 'no-placements', ok: false, detail: 'placements-failed' })
})

test.each([
  [{ attribute: 'undeclared', op: 'eq', value: 'US' }, 'undeclared-targeting-key'],
  [{ attribute: 'age', op: 'eq', value: 'wrong' }, 'invalid-targeting-rule'],
  [{ attribute: 'country', op: 'in', value: [] }, 'invalid-targeting-rule'],
  [{ attribute: 'age', op: 'contains', value: 2 }, 'invalid-targeting-rule'],
] as const)('preflight and start agree on targeting refusal %j', async (rule, code) => {
  const { options, req, payload } = setup()
  payload.documents['xp-experiments']![0]!.targeting = [rule]
  const response = await handlePreflight(req, { options })
  const body = await response.json() as PreflightResult
  expect(body.checks.find(check => !check.ok)?.code).toBe(code)
  const { start } = await import('../../src/transitions/start.js')
  await expect(start(req, { experimentId: 'one', options })).rejects.toMatchObject({ code })
  expect(body.checks).not.toContainEqual(expect.objectContaining({ code: 'invalid-body' }))
})

function blockSetup() {
  const { options, payload, req } = setup()
  const experiment = payload.documents['xp-experiments']![0]!
  Object.assign(experiment, { kind: 'block', arms: defaultArms('block'), exposurePolicy: 'render' })
  options.puck = { enabled: true, collections: ['pages'] }
  payload.documents.pages = [{ id: 10, title: 'Landing', slug: 'landing', _status: 'published', puckData: { content: [{
    type: 'ExperimentSlot', props: { experiment: 'hero', control: [{}], variantA: [{}, {}] },
  }] } }, { id: 11, title: 'Draft landing', slug: 'draft-only', _status: 'draft', puckData: { content: [{
    type: 'ExperimentSlot', props: { experiment: 'hero', control: [{}], variantA: [] },
  }] } }]
  return { options, payload, req }
}

test('block preflight resolves host URLs with publication state and carries every slot count', async () => {
  const { options, req } = blockSetup()
  const previewUrl = vi.fn(({ id }) => `/page/${id}`)
  const editorUrl = vi.fn(({ id, draft }) => `/editor/${id}?draft=${draft}`)
  options.admin = { previewUrl, editorUrl }
  const response = await handlePreflight(req, { options })
  expect(response.status).toBe(200)
  const body = await response.json() as PreflightResult
  expect(body.placements).toEqual([
    { collection: 'pages', id: 10, title: 'Landing', detail: 'Published', ok: true, url: '/page/10', editorUrl: '/editor/10?draft=false', slots: { control: 1, variantA: 2, variantB: 0, variantC: 0 } },
    { collection: 'pages', id: 11, title: 'Draft landing', detail: 'Draft', ok: false, url: '/page/11', editorUrl: '/editor/11?draft=true', slots: { control: 1, variantA: 0, variantB: 0, variantC: 0 } },
  ])
  expect(previewUrl.mock.calls).toEqual([[{ collection: 'pages', id: 10, title: 'Landing', published: true, slug: 'landing' }], [{ collection: 'pages', id: 11, title: 'Draft landing', published: false }]])
  expect(editorUrl.mock.calls).toEqual([[{ collection: 'pages', id: 10, draft: false }], [{ collection: 'pages', id: 11, draft: true }]])
})

test('flag placement rows never get URLs or slots even when host URL options exist', async () => {
  const { options, req } = setup('flag')
  options.flagPoints![0]!.placements = async () => [{ arm: 'control', ok: true }]
  const callback = vi.fn(() => '/link')
  options.admin = { previewUrl: callback, editorUrl: callback }
  const body = await (await handlePreflight(req, { options })).json() as PreflightResult
  expect(body.placements[0]).toEqual({ collection: 'cta', id: 'control', title: 'control', ok: true })
  expect(callback).not.toHaveBeenCalled()
})

test.each(['throws', 'rejects', 'non-string', 'unset'] as const)('optional block URLs tolerate %s independently', async mode => {
  const { options, req, payload } = blockSetup()
  options.admin = mode === 'unset' ? {} : {
    previewUrl: mode === 'throws' ? () => { throw new Error('host unavailable') } : mode === 'rejects' ? async () => { throw new Error('private adapter detail') } : vi.fn().mockReturnValue(12),
    editorUrl: ({ id }) => `/editor/${id}`,
  }
  const response = await handlePreflight(req, { options })
  expect(response.status).toBe(200)
  const body = await response.json() as PreflightResult
  for (const placement of body.placements) {
    expect(placement).not.toHaveProperty('url')
    if (mode === 'unset') expect(placement).not.toHaveProperty('editorUrl')
    else expect(placement.editorUrl).toBe(`/editor/${placement.id}`)
  }
  expect(payload.logs.filter(log => log.level === 'warn')).toHaveLength(mode === 'unset' ? 0 : 1)
  expect(JSON.stringify(payload.logs)).not.toContain('private adapter detail')
})

test('saved duration does not replace the power-derived suggestion', async () => {
  const { options, req, payload } = setup()
  const now = new Date('2026-11-02T12:00:00Z')
  options.metricSources![0]!.query = async () => [{ unitId: 'a', value: 1, ts: new Date('2026-11-01T12:00:00Z') }]
  payload.documents['xp-experiments']![0]!.analysis = { plannedDurationDays: 28, reachPerDay: 100 }
  const estimate = vi.fn(() => ({ weeks: [], sampleSizeAndRuntime: { primary: { weeks: 3, users: 2100 } } }))
  const response = await handlePreflight(req, { options }, { now, estimate })
  expect(response.status).toBe(200)
  const body = await response.json() as PreflightResult
  expect(body.estimate).toEqual({ weeks: 3, plannedDurationDays: 21, sequentialTuningParameter: 2100, feasible: true })
  expect(estimate).toHaveBeenCalledTimes(2)
})


test('placement failures expose closed codes in preflight, start and logs', async () => {
  const { options, req, payload } = setup('flag')
  options.flagPoints![0]!.placements = async () => { throw new Error('secret-value database password') }
  const body = await (await handlePreflight(req, { options })).json()
  expect(body.checks).toContainEqual({ code: 'flag-placement-missing', ok: false, detail: 'placements-failed' })
  const { start } = await import('../../src/transitions/start.js')
  const refusal = await start(req, { experimentId: 'one', options }).catch(error => error)
  expect(refusal).toMatchObject({ code: 'flag-placement-missing', detail: 'placements-failed' })
  expect(JSON.stringify([body, refusal, payload.logs])).not.toContain('secret-value')
  expect(payload.logs).toContainEqual(expect.objectContaining({ level: 'error', args: [expect.objectContaining({ experimentId: 'one', collection: 'cta', id: 'one', err: expect.objectContaining({ name: 'Error' }) }), 'Experiment placement lookup failed'] }))
})

test.each(['Forbidden', 'NotFound'])(`placement %s is classified by name`, async name => {
  const { options, req } = setup('flag')
  options.flagPoints![0]!.placements = async () => { const error = new Error('secret-value'); error.name = name; throw error }
  const body = await (await handlePreflight(req, { options })).json()
  expect(body.checks).toContainEqual({ code: 'flag-placement-missing', ok: false, detail: name === 'Forbidden' ? 'forbidden' : 'not-found' })
  expect(JSON.stringify(body)).not.toContain('secret-value')
})


test.each(['/async-page', null, undefined])('async preview adapter returns %j without blocking preflight', async url => {
  const { options, req } = blockSetup()
  options.admin = { previewUrl: async () => url, editorUrl: ({ id }) => `/editor/${id}` }
  const response = await handlePreflight(req, { options })
  expect(response.status).toBe(200)
  const body = await response.json() as PreflightResult
  for (const placement of body.placements) {
    if (url) expect(placement.url).toBe(url)
    else expect(placement).not.toHaveProperty('url')
    expect(placement.editorUrl).toBe(`/editor/${placement.id}`)
  }
})

test('preview lookups time out after two seconds, log once, and consume late rejection', async () => {
  vi.useFakeTimers()
  const { options, req, payload } = blockSetup()
  let reject!: (cause: Error) => void
  options.admin = {
    previewUrl: () => new Promise<string>((_, fail) => { reject = fail }),
    editorUrl: ({ id }) => `/editor/${id}`,
  }
  let finished = false
  const pending = handlePreflight(req, { options }).then(response => { finished = true; return response })
  await vi.advanceTimersByTimeAsync(1999)
  expect(finished).toBe(false)
  await vi.advanceTimersByTimeAsync(1)
  const response = await pending
  expect(response.status).toBe(200)
  const body = await response.json() as PreflightResult
  expect(body.placements).toHaveLength(2)
  expect(body.placements.every(p => !('url' in p) && p.editorUrl === `/editor/${p.id}`)).toBe(true)
  expect(payload.logs.filter(log => log.level === 'warn')).toHaveLength(1)
  expect(vi.getTimerCount()).toBe(0)
  reject(new Error('late private rejection'))
  await vi.advanceTimersByTimeAsync(0)
  expect(payload.logs.filter(log => log.level === 'warn')).toHaveLength(1)
})

test('at most eight preview adapters run concurrently and placement order survives out-of-order results', async () => {
  vi.useFakeTimers()
  const { options, req, payload } = blockSetup()
  payload.documents.pages = Array.from({ length: 19 }, (_, id) => ({ ...payload.documents.pages![0]!, id }))
  let active = 0, peak = 0
  const previewUrl = vi.fn(async ({ id }: { id: string | number }) => {
    active++
    peak = Math.max(peak, active)
    await new Promise(resolve => setTimeout(resolve, 10 + (19 - Number(id))))
    active--
    return `/page/${id}`
  })
  options.admin = { previewUrl }
  const pending = handlePreflight(req, { options })
  await vi.advanceTimersByTimeAsync(0)
  expect(previewUrl).toHaveBeenCalledTimes(8)
  expect(active).toBe(8)
  await vi.runAllTimersAsync()
  const body = await (await pending).json() as PreflightResult
  expect(peak).toBe(8)
  expect(active).toBe(0)
  expect(previewUrl).toHaveBeenCalledTimes(19)
  expect(body.placements.map(p => p.url)).toEqual(Array.from({ length: 19 }, (_, id) => `/page/${id}`))
  expect(vi.getTimerCount()).toBe(0)
})

test('timed-out host callbacks retain their permits and remaining placements keep editor links', async () => {
  vi.useFakeTimers()
  const { options, req, payload } = blockSetup()
  payload.documents.pages = Array.from({ length: 19 }, (_, id) => ({ ...payload.documents.pages![0]!, id }))
  const rejects: Array<(cause: Error) => void> = []
  const previewUrl = vi.fn(() => new Promise<string>((_, reject) => { rejects.push(reject) }))
  options.admin = { previewUrl, editorUrl: ({ id }) => `/editor/${id}` }
  const pending = handlePreflight(req, { options })
  await vi.advanceTimersByTimeAsync(0)
  expect(previewUrl).toHaveBeenCalledTimes(8)
  await vi.advanceTimersByTimeAsync(2000)
  const response = await pending
  expect(response.status).toBe(200)
  const body = await response.json() as PreflightResult
  expect(body.placements).toHaveLength(19)
  expect(previewUrl).toHaveBeenCalledTimes(8)
  expect(body.placements.every(p => !('url' in p) && p.editorUrl === `/editor/${p.id}`)).toBe(true)
  expect(payload.logs.filter(log => log.level === 'warn')).toHaveLength(1)
  for (const reject of rejects) reject(new Error('late private rejection'))
  await vi.advanceTimersByTimeAsync(0)
  expect(previewUrl).toHaveBeenCalledTimes(8)
  expect(vi.getTimerCount()).toBe(0)
})
