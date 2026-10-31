import { afterEach, expect, test, vi } from 'vitest'
import type { EventBody } from '../../src/types/endpoints.js'
import { __resetBeaconsForTests, registerApiRoute, sendEvent, sendExposure } from '../../src/client/beacon.js'
import { trackConversionBeacon } from '../../src/client/trackConversionBeacon.js'
import manual from '../_fixtures/events/exposure-manual.json'
import viewport from '../_fixtures/events/exposure-viewport.json'
import pageview from '../_fixtures/events/exposure-pageview.json'
import conversion from '../_fixtures/events/conversion.json'

afterEach(__resetBeaconsForTests)
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
const conversionEvent = { type: 'conversion', eventName: 'registration', idempotencyKey: 'event-1' } satisfies EventBody['events'][number]

function transport(result = true) {
  const sendBeacon = vi.fn<(url: string, body: Blob) => boolean>(() => result)
  const fetch = vi.fn(() => Promise.resolve())
  vi.stubGlobal('navigator', { sendBeacon })
  vi.stubGlobal('fetch', fetch)
  return { sendBeacon, fetch }
}

test.each([
  ['manual', manual], ['viewport', viewport], ['pageview', pageview],
] as const)('%s body deep-equals the shared endpoint fixture, with one event and policy', async (policy, fixture) => {
  const { sendBeacon, fetch } = transport()
  const event = fixture.events[0]!
  const exposure = { type: 'exposure', experiment: event.experiment, phase: event.phase, arm: event.arm, policy } satisfies EventBody['events'][number]
  sendExposure('/custom-api', exposure, policy === 'pageview' ? '/landing' : undefined)
  expect(sendBeacon).toHaveBeenCalledTimes(1)
  const [url, blob] = sendBeacon.mock.calls[0]!
  expect(url).toBe('/custom-api/xp/events')
  expect(blob).toBeInstanceOf(Blob)
  expect(blob.type).toBe('text/plain;charset=utf-8')
  expect(JSON.parse(await blob.text())).toEqual(fixture)
  expect(fetch).not.toHaveBeenCalled()
})

test('conversion body equals the shared fixture; no value or attributes; caller key is preserved', async () => {
  const { sendBeacon } = transport()
  registerApiRoute(Symbol(), '/conversions')
  const event = conversion.events[0]!
  trackConversionBeacon(event.eventName, { idempotencyKey: event.idempotencyKey })
  expect(sendBeacon.mock.calls[0]![0]).toBe('/conversions/xp/events')
  expect(JSON.parse(await sendBeacon.mock.calls[0]![1].text())).toEqual(conversion)
})

test.each(['manual', 'viewport', 'pageview'] as const)('%s fetch fallback keeps the exact fixture contract', async policy => {
  const { fetch } = transport(false)
  const fixture = { manual, viewport, pageview }[policy]
  const entry = fixture.events[0]!
  sendExposure('/api-v2', { type: 'exposure', experiment: entry.experiment, phase: entry.phase, arm: entry.arm, policy }, policy === 'pageview' ? '/landing' : undefined)
  expect(fetch).toHaveBeenCalledWith('/api-v2/xp/events', {
    method: 'POST', keepalive: true, credentials: 'same-origin',
    headers: { 'content-type': 'text/plain;charset=UTF-8' }, body: JSON.stringify(fixture),
  })
})

test.each(['missing', 'false', 'throw'])('sendBeacon %s uses fetch with the API base and required flags', state => {
  const { sendBeacon, fetch } = transport(false)
  if (state === 'missing') vi.stubGlobal('navigator', {})
  if (state === 'throw') sendBeacon.mockImplementation(() => { throw new Error('blocked') })
  sendEvent('/fallback', conversionEvent)
  expect(fetch).toHaveBeenCalledWith('/fallback/xp/events', {
    method: 'POST', keepalive: true, credentials: 'same-origin',
    headers: { 'content-type': 'text/plain;charset=UTF-8' }, body: JSON.stringify(conversion),
  })
})

test('both transports throwing or missing, and fetch rejections, never escape', async () => {
  const { sendBeacon } = transport()
  sendBeacon.mockImplementation(() => { throw new Error('blocked') })
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('blocked') }))
  expect(() => trackConversionBeacon('registration')).not.toThrow()
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network'))))
  expect(() => trackConversionBeacon('registration')).not.toThrow()
  await Promise.resolve()
  vi.stubGlobal('navigator', undefined)
  vi.stubGlobal('fetch', undefined)
  expect(() => trackConversionBeacon('registration')).not.toThrow()
})

test('dedupe is per slug/phase/arm, pageviews also key on pathname; test reset clears both', () => {
  const { sendBeacon } = transport()
  const event = { type: 'exposure', experiment: 'test', phase: 1, arm: 'control', policy: 'manual' } satisfies EventBody['events'][number]
  sendExposure('/api', event)
  sendExposure('/api', { ...event, policy: 'viewport' })
  sendExposure('/api', { ...event, arm: 'variantA' })
  sendExposure('/api', { ...event, phase: 2 })
  sendExposure('/api', { ...event, experiment: 'another' })
  const page = { ...event, policy: 'pageview' } satisfies EventBody['events'][number]
  sendExposure('/api', page, '/one')
  sendExposure('/api', page, '/one')
  sendExposure('/api', page, '/two')
  expect(sendBeacon).toHaveBeenCalledTimes(6)
  __resetBeaconsForTests()
  sendExposure('/api', event)
  sendExposure('/api', page, '/one')
  expect(sendBeacon).toHaveBeenCalledTimes(8)
})
