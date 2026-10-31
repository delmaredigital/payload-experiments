import { afterEach, expect, test, vi } from 'vitest'
import './requestHarness.js'
import { experiment, manifest, runtime } from './helpers.js'
import { getFlagPoint } from '../../src/server/getFlagPoint.js'
import * as exposure from '../../src/server/recordExposures.js'
import { XpNotImplemented } from '../../src/errors.js'
import * as requestReader from '../../src/server/request.js'
import { NextRequest } from 'next/server'

const trustedContext = () => vi.spyOn(requestReader, 'serverRequest').mockImplementation(headers => ({ request: new NextRequest('https://example.com/', { headers }), hasContext: true }))

afterEach(() => vi.restoreAllMocks())
test('live experiment beats shipped defaults and registered point defaults', async () => {
  trustedContext()
  const m = manifest([experiment({ kind: 'flag', flagPoint: 'point', exposurePolicy: 'manual' })])
  m.flagDefaults.point = { winnerArm: 'variantB', params: { text: 'shipped' }, experiment: 2, decidedAt: '' }
  const { rt } = runtime(m, {}, {}, { flagPoints: [{ id: 'point', defaultParams: { text: 'registered' } }] })
  expect(await getFlagPoint(rt, 'point')).toMatchObject({ source: 'experiment', arm: 'variantA', experiment: 'hero', experimentId: 7, params: { text: 'winner' } })
})
test('fallback chain is shipped then registered params then empty control', async () => {
  const m = manifest([]); m.flagDefaults.shipped = { winnerArm: 'variantB', params: { text: 'shipped' }, experiment: 2, decidedAt: '' }
  const { rt } = runtime(m, {}, {}, { flagPoints: [{ id: 'registered', defaultParams: { text: 'registered' } }] })
  expect(await getFlagPoint(rt, 'shipped')).toMatchObject({ source: 'default', arm: 'variantB', params: { text: 'shipped' }, exposable: false })
  expect(await getFlagPoint(rt, 'registered')).toMatchObject({ source: 'default', arm: 'control', params: { text: 'registered' } })
  expect(await getFlagPoint(rt, 'missing')).toMatchObject({ source: 'default', arm: 'control', params: {} })
})
test('manual exposes the rendered arm, never implicitly', async () => {
  trustedContext()
  const record = vi.spyOn(exposure, 'recordExposures').mockResolvedValue()
  const { rt } = runtime(manifest([experiment({ kind: 'flag', flagPoint: 'point', exposurePolicy: 'manual' })]))
  const point = await getFlagPoint(rt, 'point')
  expect(record).not.toHaveBeenCalled(); await point.expose('control')
  expect(record).toHaveBeenCalledWith(rt, [{ slug: 'hero', phase: 1, arm: 'control' }], expect.objectContaining({ visitorId: 'visitor' }))
})
test.each(['render', 'viewport', 'pageview', 'unenrolled', 'staff'] as const)('%s cannot manually expose', async mode => {
  trustedContext()
  const record = vi.spyOn(exposure, 'recordExposures').mockResolvedValue()
  const e = experiment({ kind: 'flag', flagPoint: 'point', exposurePolicy: mode === 'unenrolled' || mode === 'staff' ? 'manual' : mode, coverage: mode === 'unenrolled' ? 0 : 1 })
  const { rt } = runtime(manifest([e]), {}, { getUser: async () => ({ id: 1 }), attributesOf: () => ({ staff: mode === 'staff' }) })
  await (await getFlagPoint(rt, 'point')).expose('variantA')
  expect(record).not.toHaveBeenCalled()
})
test('CORE-08a stub failure is caught and logged', async () => {
  trustedContext()
  vi.spyOn(exposure, 'recordExposures').mockRejectedValue(new XpNotImplemented('CORE-08a'))
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  const { rt } = runtime(manifest([experiment({ kind: 'flag', flagPoint: 'point', exposurePolicy: 'manual' })]))
  await expect((await getFlagPoint(rt, 'point')).expose('variantA')).resolves.toBeUndefined()
  expect(log).toHaveBeenCalledTimes(1)
})
